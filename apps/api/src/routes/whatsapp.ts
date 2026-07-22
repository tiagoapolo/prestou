import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireProvider } from "../auth.js";
import { chargeDraftSchema, createCharge } from "../charge-creation.js";
import { config } from "../config.js";
import { execute, queryAll, queryOne, withTransaction } from "../db.js";
import { newId } from "../ids.js";
import { formatBRL } from "../messages.js";
import { notifyProvider } from "../notify.js";
import { interpretMessage } from "../orchestrator.js";
import { dbDeps } from "../assistant-data.js";
import {
  chargeConfirmationPayload,
  parseInboundMessage,
  parseWhatsAppChargeAction,
  renderResult,
  verifySignature,
  whatsappIdentityCandidates,
  type WhatsAppChargeAction,
} from "../channels/whatsapp.js";
import { mobileSchema } from "../validation.js";
import type { ProviderRow } from "../types.js";
import {
  admitWhatsAppMessage,
  finishWhatsAppMessage,
  releaseWhatsAppMessage,
} from "../whatsapp-guardrail.js";
import { whatsappGuardrailReply } from "../whatsapp-guardrail-policy.js";

const VERIFICATION_TTL_MINUTES = 10;
const CHARGE_PROPOSAL_TTL_MINUTES = 10;

const startSchema = z.object({ phone: mobileSchema }).strict();
const confirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

interface NumberRow {
  provider_id: string;
  phone_e164: string;
  verified_at: string | null;
  verification_code: string | null;
  code_expires_at: string | null;
}

interface WhatsAppChargeProposalRow {
  id: string;
  provider_id: string;
  draft: unknown;
  expires_at: string;
  consumed_at: string | null;
  cancelled_at: string | null;
  result: unknown;
  expired?: boolean;
}

const chargeProposalResultSchema = z.object({
  chargeId: z.string().uuid(),
  paymentUrl: z.string().url(),
  clientName: z.string(),
  amountCents: z.number().int().positive(),
}).strict();

type ChargeProposalResult = z.infer<typeof chargeProposalResultSchema>;

/** Celular BR (11 dígitos DDD+número) → E.164 sem "+", como a Meta entrega. */
function toE164(mobile: string): string {
  return `55${mobile}`;
}

function persistedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON.parse(value);
}

async function createChargeProposal(
  providerId: string,
  draft: unknown,
): Promise<string> {
  const validatedDraft = chargeDraftSchema.parse(draft);
  const proposalId = newId();
  await withTransaction(async (tx) => {
    // Somente o rascunho mais recente pode ser confirmado pelo prestador.
    await tx.execute(`
      UPDATE whatsapp_charge_proposals
         SET cancelled_at = CURRENT_TIMESTAMP
       WHERE provider_id = ?
         AND consumed_at IS NULL
         AND cancelled_at IS NULL
    `, providerId);
    await tx.execute(`
      INSERT INTO whatsapp_charge_proposals
        (id, provider_id, draft, expires_at)
      VALUES (?, ?, ?::text::jsonb, CURRENT_TIMESTAMP + INTERVAL '${CHARGE_PROPOSAL_TTL_MINUTES} minutes')
    `, proposalId, providerId, JSON.stringify(validatedDraft));
  });
  return proposalId;
}

function createdChargeMessage(result: ChargeProposalResult, alreadyCreated: boolean): string {
  const prefix = alreadyCreated ? "Esta cobrança já foi criada." : "Cobrança criada com sucesso.";
  return (
    `${prefix}\n` +
    `• Cliente: ${result.clientName}\n` +
    `• Valor: ${formatBRL(result.amountCents)}\n` +
    `• Link para enviar ao cliente: ${result.paymentUrl}`
  );
}

async function handleChargeProposalAction(
  log: FastifyInstance["log"],
  to: string,
  provider: ProviderRow,
  action: WhatsAppChargeAction,
  proposalId: string,
): Promise<void> {
  try {
    const message = await withTransaction(async (tx) => {
      const proposal = await tx.queryOne<WhatsAppChargeProposalRow>(`
        SELECT *, expires_at <= CURRENT_TIMESTAMP AS expired
          FROM whatsapp_charge_proposals
         WHERE id = ? AND provider_id = ?
         FOR UPDATE
      `, proposalId, provider.id);

      if (!proposal) return "Não encontrei esse rascunho. Prepare uma nova cobrança.";
      if (proposal.consumed_at) {
        const result = chargeProposalResultSchema.parse(persistedJson(proposal.result));
        return createdChargeMessage(result, true);
      }
      if (proposal.cancelled_at) return "Esse rascunho já foi cancelado.";
      if (proposal.expired) return "Esse rascunho expirou. Prepare uma nova cobrança.";

      if (action === "cancel") {
        await tx.execute(
          "UPDATE whatsapp_charge_proposals SET cancelled_at = CURRENT_TIMESTAMP WHERE id = ?",
          proposal.id,
        );
        return "Rascunho cancelado. Nenhuma cobrança foi criada.";
      }

      const draft = chargeDraftSchema.parse(persistedJson(proposal.draft));
      const created = await createCharge(tx, provider, draft, "whatsapp");
      const result: ChargeProposalResult = {
        chargeId: created.charge.id,
        paymentUrl: created.payment.paymentUrl,
        clientName: created.charge.client.name,
        amountCents: created.charge.amountCents,
      };
      await tx.execute(`
        UPDATE whatsapp_charge_proposals
           SET consumed_at = CURRENT_TIMESTAMP, result = ?::text::jsonb
         WHERE id = ?
      `, JSON.stringify(result), proposal.id);
      return createdChargeMessage(result, false);
    });
    await deliverReply(log, to, message);
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 400 || statusCode === 422) {
      await deliverReply(log, to, (error as Error).message);
      return;
    }
    throw error;
  }
}

/**
 * Vínculo e verificação do WhatsApp do prestador (Settings). Só um número
 * verificado é atendido pelo inbound; a autoridade continua sendo o JWT.
 */
export async function whatsappSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireProvider);

  app.get("/api/whatsapp/number", async (req) => {
    const row = await queryOne<NumberRow>(
      "SELECT * FROM provider_whatsapp_numbers WHERE provider_id = ?",
      req.provider!.id,
    );
    return {
      phone: row?.phone_e164 ?? null,
      verified: Boolean(row?.verified_at),
    };
  });

  app.post("/api/whatsapp/number/start", async (req, reply) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Informe um celular válido com DDD." });
    }

    const phone = toE164(parsed.data.phone);
    const owner = await queryOne<NumberRow>(
      "SELECT * FROM provider_whatsapp_numbers WHERE phone_e164 = ? AND provider_id <> ?",
      phone,
      req.provider!.id,
    );
    if (owner) {
      return reply.code(409).send({ error: "Este número já está vinculado a outra conta." });
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await execute(
      `INSERT INTO provider_whatsapp_numbers
         (provider_id, phone_e164, verification_code, code_expires_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP + INTERVAL '${VERIFICATION_TTL_MINUTES} minutes')
       ON CONFLICT (provider_id) DO UPDATE SET
         phone_e164 = excluded.phone_e164,
         verification_code = excluded.verification_code,
         code_expires_at = excluded.code_expires_at,
         verified_at = null`,
      req.provider!.id,
      phone,
      code,
    );

    await notifyProvider({
      provider: req.provider!,
      kind: "whatsapp_verification",
      body: `Seu código de verificação do Prestou é ${code}. Ele expira em ${VERIFICATION_TTL_MINUTES} minutos.`,
    });

    return { sent: true };
  });

  app.post("/api/whatsapp/number/confirm", async (req, reply) => {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "O código tem 6 dígitos." });
    }

    const row = await queryOne<NumberRow & { expired: boolean }>(
      `SELECT *, code_expires_at <= CURRENT_TIMESTAMP AS expired
         FROM provider_whatsapp_numbers WHERE provider_id = ?`,
      req.provider!.id,
    );
    if (!row?.verification_code) {
      return reply.code(404).send({ error: "Nenhuma verificação pendente. Solicite um novo código." });
    }
    if (row.expired) {
      return reply.code(410).send({ error: "O código expirou. Solicite um novo." });
    }
    if (row.verification_code !== parsed.data.code) {
      return reply.code(422).send({ error: "Código incorreto." });
    }

    await execute(
      `UPDATE provider_whatsapp_numbers
          SET verified_at = CURRENT_TIMESTAMP, verification_code = null, code_expires_at = null
        WHERE provider_id = ?`,
      req.provider!.id,
    );
    return { verified: true };
  });
}

/**
 * Webhook inbound da Cloud API. Público por natureza: a assinatura da Meta é o
 * "auth"; o número apenas identifica o prestador depois de a origem estar
 * provada. Gated por WHATSAPP_MODE — em "log", a resposta é apenas registrada
 * (inbound simulado), sem chamar a Meta.
 */
export async function whatsappWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Assinatura é sobre os bytes crus — precisamos do corpo antes do JSON.parse.
  // Encapsulado neste plugin: não afeta as demais rotas.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      (req as { rawBody?: string }).rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (error) {
        done(error as Error);
      }
    },
  );

  // Handshake de verificação do webhook (GET) exigido pela Meta.
  app.get("/api/whatsapp/webhook", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    if (
      query["hub.mode"] === "subscribe" &&
      config.whatsapp.verifyToken &&
      query["hub.verify_token"] === config.whatsapp.verifyToken
    ) {
      return reply.type("text/plain").send(query["hub.challenge"] ?? "");
    }
    return reply.code(403).send({ error: "Verificação inválida" });
  });

  app.post("/api/whatsapp/webhook", async (req, reply) => {
    const rawBody = (req as { rawBody?: string }).rawBody ?? "";
    if (
      config.whatsapp.appSecret &&
      !verifySignature(config.whatsapp.appSecret, rawBody, req.headers["x-hub-signature-256"] as string | undefined)
    ) {
      return reply.code(401).send({ error: "Assinatura inválida" });
    }

    // A Meta reenvia em qualquer resposta != 200; sempre confirmamos o
    // recebimento e tratamos o conteúdo de forma best-effort.
    const inbound = parseInboundMessage(req.body);
    if (inbound) {
      const identityCandidates = whatsappIdentityCandidates(inbound.from);
      const providers = await queryAll<ProviderRow>(
        `SELECT pr.*
           FROM provider_whatsapp_numbers wn
           JOIN providers pr ON pr.id = wn.provider_id
          WHERE wn.phone_e164 IN (?, ?) AND wn.verified_at IS NOT NULL`,
        ...identityCandidates,
      );
      // Número desconhecido, não verificado ou ambíguo nunca é atendido.
      const provider = providers.length === 1 ? providers[0] : undefined;
      if (provider) {
        try {
          const to = toE164(provider.whatsapp);
          if (inbound.kind === "text" && !config.openai.apiKey) {
            return reply.send({ received: true });
          }

          const admission = await admitWhatsAppMessage(provider.id, inbound);
          if (!admission.allowed) {
            req.log.warn(
              { providerId: provider.id, decision: admission.decision },
              "whatsapp inbound blocked by guardrail",
            );
            const guardrailReply = admission.shouldNotify
              ? whatsappGuardrailReply(
                admission.decision,
                config.whatsapp.guardrail.maxMessageLength,
              )
              : undefined;
            if (guardrailReply) await deliverReply(req.log, to, guardrailReply);
            return reply.send({ received: true });
          }

          if (inbound.kind === "button") {
            const action = parseWhatsAppChargeAction(inbound.buttonId);
            if (action) {
              await handleChargeProposalAction(
                req.log,
                to,
                provider,
                action.action,
                action.proposalId,
              );
            }
            return reply.send({ received: true });
          }

          let finished = false;
          try {
            const result = await interpretMessage({
              providerId: provider.id,
              message: inbound.text,
              deps: dbDeps,
              apiKey: config.openai.apiKey,
              model: config.openai.model,
              defaultDueDays: provider.default_due_days,
              timeoutMs: config.openai.timeoutMs,
            });
            if (result.kind === "draft") {
              const proposalId = await createChargeProposal(provider.id, result.draft);
              await deliverChargeConfirmation(req.log, to, renderResult(result), proposalId);
            } else {
              await deliverReply(req.log, to, renderResult(result));
            }
            await finishWhatsAppMessage(
              provider.id,
              inbound.id,
              result.kind === "text" && result.classification === "unsupported",
            );
            finished = true;
          } finally {
            if (!finished) await releaseWhatsAppMessage(provider.id, inbound.id);
          }
        } catch (error) {
          req.log.error({ err: error }, "whatsapp inbound processing failed");
        }
      }
    }

    return reply.send({ received: true });
  });
}

/**
 * Envia a resposta ao prestador. Em WHATSAPP_MODE=log (inbound simulado), apenas
 * registra; em cloud-api, responde via Graph API dentro da janela de 24h.
 */
async function deliverReply(
  log: FastifyInstance["log"],
  to: string,
  text: string,
): Promise<void> {
  await deliverPayload(log, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
}

async function deliverChargeConfirmation(
  log: FastifyInstance["log"],
  to: string,
  text: string,
  proposalId: string,
): Promise<void> {
  await deliverPayload(log, chargeConfirmationPayload(to, text, proposalId));
}

async function deliverPayload(
  log: FastifyInstance["log"],
  payload: object,
): Promise<void> {
  if (config.whatsapp.mode === "log") {
    log.info({ payload }, "[whatsapp:log] resposta simulada");
    return;
  }

  const { phoneNumberId, accessToken } = config.whatsapp;
  if (!phoneNumberId || !accessToken) {
    log.error("WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN ausentes no modo cloud-api");
    return;
  }
  const res = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    log.error({ status: res.status, body: await res.text() }, "[whatsapp:cloud-api] envio falhou");
  }
}
