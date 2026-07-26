import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireProvider } from "../auth.js";
import { chargeDraftSchema, createCharge } from "../charge-creation.js";
import { config } from "../config.js";
import { execute, queryAll, queryOne, withTransaction } from "../db.js";
import { newId } from "../ids.js";
import { notifyProvider } from "../notify.js";
import { interpretMessage } from "../orchestrator.js";
import { dbDeps } from "../assistant-data.js";
import { dbChargeMemory } from "../charge-memory.js";
import {
  chargeConfirmationPayload,
  createdChargeMessages,
  parseInboundMessage,
  parseWhatsAppChargeAction,
  renderResult,
  verifySignature,
  nationalWhatsAppIdentityCandidates,
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
import {
  invalidateOnboardingToken,
  invitedSignupMessage,
  startInvitedWhatsAppOnboarding,
} from "../whatsapp-onboarding.js";

const CHARGE_PROPOSAL_TTL_MINUTES = 10;

const startSchema = z.object({ phone: mobileSchema }).strict();
const confirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

/** Estado transitório de uma verificação de número pendente (schema private). */
interface VerificationRow {
  provider_id: string;
  candidate_phone: string;
  code_digest: string;
  expires_at: string;
  verify_attempts: number;
  last_sent_at: string;
  blocked_until: string | null;
}

/**
 * Segredo do HMAC dos códigos. Sem env dedicada, deriva do service role key —
 * um segredo forte que já existe e nunca sai do servidor.
 */
const verificationSecret =
  config.whatsapp.verificationSecret || config.supabase.serviceRoleKey;

/** Guarda só o HMAC do código: 6 dígitos são enumeráveis se o banco vazar. */
function codeDigest(code: string): string {
  return createHmac("sha256", verificationSecret).update(code).digest("hex");
}

/** Comparação em tempo constante entre dois digests hex. */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
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
  description: z.string().optional(),
}).strict();

type ChargeProposalResult = z.infer<typeof chargeProposalResultSchema>;

/** Celular BR (11 dígitos DDD+número) → E.164 sem "+", como a Meta entrega. */
function toE164(mobile: string): string {
  return `55${mobile}`;
}

/** Código Postgres de violação de restrição única. */
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === PG_UNIQUE_VIOLATION;
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
        return createdChargeMessages(result, true);
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
        description: created.charge.description,
      };
      await tx.execute(`
        UPDATE whatsapp_charge_proposals
           SET consumed_at = CURRENT_TIMESTAMP, result = ?::text::jsonb
         WHERE id = ?
      `, JSON.stringify(result), proposal.id);
      return createdChargeMessages(result, false);
    });
    const messages = Array.isArray(message) ? message : [message];
    for (const item of messages) await deliverReply(log, to, item);
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
 * Vínculo e verificação do WhatsApp do prestador (Settings).
 *
 * O número canônico é `providers.whatsapp`; ele só é atendido pelo inbound
 * depois de provado (`whatsapp_verified_at`). Trocar o número passa por um OTP
 * enviado ao número *candidato* — até confirmar, o número atual continua
 * valendo. A autoridade da conta continua sendo o JWT do dashboard.
 */
export async function whatsappSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireProvider);

  const verification = config.whatsapp.verification;
  const attemptCooldownMinutes = config.whatsapp.guardrail.cooldownMinutes;

  app.get("/api/whatsapp/number", async (req) => {
    const provider = req.provider!;
    const pending = await queryOne<{ candidate_phone: string }>(
      `SELECT candidate_phone
         FROM private.whatsapp_verifications
        WHERE provider_id = ?
          AND expires_at > now()
          AND (blocked_until IS NULL OR blocked_until <= now())`,
      provider.id,
    );
    return {
      phone: provider.whatsapp,
      verified: Boolean(provider.whatsapp_verified_at),
      pendingCandidate: pending?.candidate_phone ?? null,
    };
  });

  app.post("/api/whatsapp/number/start", async (req, reply) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Informe um celular válido com DDD." });
    }
    const candidate = parsed.data.phone; // nacional, 11 dígitos
    const provider = req.provider!;

    // No modo cloud-api o código só sai por template de autenticação aprovado.
    // Sem ele configurado, falhamos cedo em vez de "vazar" o código em texto.
    if (config.whatsapp.mode === "cloud-api" && !config.whatsapp.authTemplate) {
      req.log.error("WHATSAPP_AUTH_TEMPLATE ausente no modo cloud-api");
      return reply.code(500).send({ error: "Verificação por WhatsApp indisponível no momento." });
    }

    // Checagem-e-reserva do candidato + limites diários (prestador, destinatário
    // e global), tudo atômico no banco. O código nunca entra na função.
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const digest = codeDigest(code);
    const outcome = await queryOne<{ decision: string }>(
      `SELECT private.start_whatsapp_verification(?, ?, ?, ?, ?, ?, ?, ?) AS decision`,
      provider.id,
      candidate,
      digest,
      verification.ttlMinutes,
      verification.resendCooldownSeconds,
      verification.providerDailyLimit,
      verification.candidateDailyLimit,
      verification.globalDailyLimit,
    );
    const decision = outcome?.decision ?? "error";

    if (decision === "taken") {
      // Não revelamos que o número é de outra conta: resposta genérica de
      // sucesso, sem enviar nada.
      req.log.warn({ providerId: provider.id }, "verification candidate unavailable");
      return { sent: true };
    }
    if (decision === "cooldown") {
      return reply.code(429).send({ error: "Aguarde alguns segundos para reenviar o código." });
    }
    if (decision === "rate") {
      return reply.code(429).send({ error: "Muitas solicitações de código. Tente novamente mais tarde." });
    }
    if (decision !== "ok") {
      req.log.error({ decision }, "unexpected verification start decision");
      return reply.code(500).send({ error: "Não foi possível iniciar a verificação." });
    }

    // Entrega do OTP. `required` propaga falha de entrega: se o código não saiu,
    // liberamos a reserva e reportamos erro — nunca `sent: true`.
    try {
      await notifyProvider({
        provider,
        kind: "whatsapp_verification",
        to: toE164(candidate),
        required: config.whatsapp.mode === "cloud-api",
        // Corpo persistido/logado sem o código; o código vai só no template.
        body: "Código de verificação do WhatsApp enviado.",
        template: config.whatsapp.authTemplate || undefined,
        templateParams: [code],
        templateUrlButtonParam: code,
      });
    } catch (error) {
      await execute(
        "DELETE FROM private.whatsapp_verifications WHERE provider_id = ? AND code_digest = ?",
        provider.id,
        digest,
      );
      req.log.error({ err: error }, "verification code delivery failed");
      return reply.code(502).send({ error: "Não foi possível enviar o código agora. Tente novamente." });
    }

    // Modo log não entrega de fato; devolvemos o código só para o dev/testes.
    // Em cloud-api ele nunca aparece na resposta.
    const exposeDevCode =
      config.whatsapp.mode === "log" &&
      (config.nodeEnv === "development" || config.nodeEnv === "test");
    return exposeDevCode ? { sent: true, devCode: code } : { sent: true };
  });

  app.post("/api/whatsapp/number/confirm", async (req, reply) => {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "O código tem 6 dígitos." });
    }
    const provider = req.provider!;
    const blockedUntil = new Date(Date.now() + attemptCooldownMinutes * 60_000).toISOString();

    // Uma transação com a linha travada (FOR UPDATE) serializa confirmações
    // concorrentes do mesmo prestador: validação e incremento de tentativas
    // ficam atômicos, sem corrida de leitura-e-escrita.
    let result: { code: number; error?: string };
    try {
      result = await withTransaction(async (tx) => {
        const row = await tx.queryOne<VerificationRow & { expired: boolean }>(
          `SELECT *, expires_at <= now() AS expired
             FROM private.whatsapp_verifications
            WHERE provider_id = ? FOR UPDATE`,
          provider.id,
        );
        if (!row) {
          return { code: 404, error: "Nenhuma verificação pendente. Solicite um novo código." };
        }
        if (row.blocked_until && new Date(row.blocked_until).getTime() > Date.now()) {
          return { code: 429, error: "Muitas tentativas. Tente novamente mais tarde." };
        }
        if (row.expired) {
          return { code: 410, error: "O código expirou. Solicite um novo." };
        }

        if (!digestsMatch(codeDigest(parsed.data.code), row.code_digest)) {
          const attempts = row.verify_attempts + 1;
          const blocked = attempts >= verification.maxAttempts;
          // Ao esgotar as tentativas, invalida o código (digest vazio) e aplica
          // cooldown — sem revelar que foi isso que aconteceu.
          await tx.execute(
            `UPDATE private.whatsapp_verifications
                SET verify_attempts = ?, code_digest = ?, blocked_until = ?
              WHERE provider_id = ?`,
            attempts,
            blocked ? "" : row.code_digest,
            blocked ? blockedUntil : row.blocked_until,
            provider.id,
          );
          return { code: 422, error: "Código incorreto." };
        }

        // Sucesso: promove o candidato a número canônico e encerra a verificação.
        await tx.execute(
          "UPDATE providers SET whatsapp = ?, whatsapp_verified_at = now() WHERE id = ?",
          row.candidate_phone,
          provider.id,
        );
        await tx.execute(
          "DELETE FROM private.whatsapp_verifications WHERE provider_id = ?",
          provider.id,
        );
        return { code: 200 };
      });
    } catch (error) {
      // Corrida entre contas: o número foi promovido por outra nesse meio-tempo.
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ error: "Este número já está vinculado a outra conta." });
      }
      throw error;
    }

    if (result.code === 200) return { verified: true };
    return reply.code(result.code).send({ error: result.error });
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
    if (!verifySignature(
      config.whatsapp.appSecret,
      rawBody,
      req.headers["x-hub-signature-256"] as string | undefined,
    )) {
      return reply.code(401).send({ error: "Assinatura inválida" });
    }

    // A Meta reenvia em qualquer resposta != 200; sempre confirmamos o
    // recebimento e tratamos o conteúdo de forma best-effort.
    const inbound = parseInboundMessage(req.body);
    if (inbound) {
      const identityCandidates = nationalWhatsAppIdentityCandidates(inbound.from);
      const providers = await queryAll<ProviderRow>(
        `SELECT * FROM providers
          WHERE whatsapp IN (?, ?) AND whatsapp_verified_at IS NOT NULL`,
        ...identityCandidates,
      );
      // Número conhecido segue para o assistente. Um número desconhecido nunca
      // chega à LLM: se estiver convidado, recebe somente o link determinístico.
      const provider = providers.length === 1 ? providers[0] : undefined;
      if (!provider) {
        try {
          const signupToken = await startInvitedWhatsAppOnboarding(inbound);
          if (signupToken) {
            try {
              await deliverReply(
                req.log,
                inbound.from.replace(/\D/g, ""),
                invitedSignupMessage(signupToken),
                true,
              );
            } catch (error) {
              // Se a Meta não recebeu o link, invalida-o para que uma nova
              // mensagem possa emitir outro sem manter uma credencial perdida.
              await invalidateOnboardingToken(signupToken);
              throw error;
            }
          }
        } catch (error) {
          req.log.error({ err: error }, "whatsapp onboarding processing failed");
        }
        return reply.send({ received: true });
      }
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
              memory: dbChargeMemory,
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
  required = false,
): Promise<void> {
  await deliverPayload(log, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  }, required);
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
  required = false,
): Promise<void> {
  if (config.whatsapp.mode === "log") {
    if (required) {
      const redacted = payload as { to?: unknown; type?: unknown };
      log.info(
        { to: redacted.to, type: redacted.type },
        "[whatsapp:log] resposta de onboarding simulada (conteúdo redigido)",
      );
    } else {
      log.info({ payload }, "[whatsapp:log] resposta simulada");
    }
    return;
  }

  const { phoneNumberId, accessToken } = config.whatsapp;
  if (!phoneNumberId || !accessToken) {
    const error = new Error("WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN ausentes no modo cloud-api");
    log.error(error.message);
    if (required) throw error;
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
    const responseBody = await res.text();
    log.error({ status: res.status, body: responseBody }, "[whatsapp:cloud-api] envio falhou");
    if (required) throw new Error(`Cloud API ${res.status}: ${responseBody}`);
  }
}
