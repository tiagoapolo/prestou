import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireProvider } from "../auth.js";
import { config } from "../config.js";
import { execute, queryOne } from "../db.js";
import { notifyProvider } from "../notify.js";
import { interpretMessage } from "../orchestrator.js";
import { dbDeps } from "../assistant-data.js";
import { parseInboundMessage, renderResult, verifySignature } from "../channels/whatsapp.js";
import { mobileSchema } from "../validation.js";
import type { DefaultDueDays } from "../types.js";

const VERIFICATION_TTL_MINUTES = 10;

const startSchema = z.object({ phone: mobileSchema }).strict();
const confirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

interface NumberRow {
  provider_id: string;
  phone_e164: string;
  verified_at: string | null;
  verification_code: string | null;
  code_expires_at: string | null;
}

/** Celular BR (11 dígitos DDD+número) → E.164 sem "+", como a Meta entrega. */
function toE164(mobile: string): string {
  return `55${mobile}`;
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
    if (inbound && config.openai.apiKey) {
      const provider = await queryOne<{ id: string; default_due_days: DefaultDueDays }>(
        `SELECT pr.id, pr.default_due_days
           FROM provider_whatsapp_numbers wn
           JOIN providers pr ON pr.id = wn.provider_id
          WHERE wn.phone_e164 = ? AND wn.verified_at IS NOT NULL`,
        inbound.from,
      );
      // Número desconhecido ou não verificado nunca é atendido.
      if (provider) {
        try {
          const result = await interpretMessage({
            providerId: provider.id,
            message: inbound.text,
            deps: dbDeps,
            apiKey: config.openai.apiKey,
            model: config.openai.model,
            defaultDueDays: provider.default_due_days,
          });
          await deliverReply(req.log, inbound.from, renderResult(result));
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
  if (config.whatsapp.mode === "log") {
    log.info({ to, text }, "[whatsapp:log] resposta simulada");
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
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    log.error({ status: res.status, body: await res.text() }, "[whatsapp:cloud-api] envio falhou");
  }
}
