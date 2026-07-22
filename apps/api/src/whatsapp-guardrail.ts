import { config } from "./config.js";
import { execute, queryOne } from "./db.js";
import type { InboundMessage } from "./channels/whatsapp.js";
import {
  whatsappMessageFingerprint,
  type WhatsAppGuardrailDecision,
} from "./whatsapp-guardrail-policy.js";

interface GuardrailRow {
  decision: WhatsAppGuardrailDecision;
  allowed: boolean;
  should_notify: boolean;
}

export interface WhatsAppGuardrailAdmission {
  decision: WhatsAppGuardrailDecision;
  allowed: boolean;
  shouldNotify: boolean;
}

export async function admitWhatsAppMessage(
  providerId: string,
  inbound: InboundMessage,
): Promise<WhatsAppGuardrailAdmission> {
  const guardrail = config.whatsapp.guardrail;
  const textLength = inbound.kind === "text" ? [...inbound.text].length : 0;
  const processingLeaseSeconds = Math.max(
    30,
    Math.ceil(config.openai.timeoutMs / 1_000) + 15,
  );
  const row = await queryOne<GuardrailRow>(`
    SELECT * FROM private.admit_whatsapp_message(
      ?::uuid, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `,
  providerId,
  inbound.id,
  whatsappMessageFingerprint(inbound),
  inbound.kind,
  textLength,
  guardrail.maxMessageLength,
  guardrail.perMinute,
  guardrail.perDay,
  guardrail.globalDailyAiLimit,
  guardrail.cooldownMinutes,
  processingLeaseSeconds,
  guardrail.invalidStreakLimit,
  );
  if (!row) throw new Error("Guardrail do WhatsApp não retornou uma decisão");
  return {
    decision: row.decision,
    allowed: row.allowed,
    shouldNotify: row.should_notify,
  };
}

export async function finishWhatsAppMessage(
  providerId: string,
  messageId: string,
  invalid: boolean,
): Promise<void> {
  await execute(
    "SELECT private.finish_whatsapp_message(?::uuid, ?, ?, ?, ?)",
    providerId,
    messageId,
    invalid,
    config.whatsapp.guardrail.invalidStreakLimit,
    config.whatsapp.guardrail.cooldownMinutes,
  );
}

export async function releaseWhatsAppMessage(
  providerId: string,
  messageId: string,
): Promise<void> {
  await execute(
    "SELECT private.release_whatsapp_message(?::uuid, ?)",
    providerId,
    messageId,
  );
}
