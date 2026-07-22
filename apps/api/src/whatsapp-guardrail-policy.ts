import { createHash } from "node:crypto";
import type { InboundMessage } from "./channels/whatsapp.js";

export type WhatsAppGuardrailDecision =
  | "allowed"
  | "duplicate"
  | "duplicate_content"
  | "too_long"
  | "rate_minute"
  | "rate_day"
  | "global_daily"
  | "cooldown"
  | "busy";

export function whatsappMessageFingerprint(inbound: InboundMessage): string {
  const content = inbound.kind === "text"
    ? inbound.text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR")
    : inbound.buttonId;
  return createHash("sha256").update(`${inbound.kind}:${content}`).digest("hex");
}

export function whatsappGuardrailReply(
  decision: WhatsAppGuardrailDecision,
  maxMessageLength: number,
): string | undefined {
  if (decision === "too_long") {
    return `Sua mensagem é muito longa. Envie um pedido com até ${maxMessageLength} caracteres.`;
  }
  if (decision === "global_daily") {
    return "O assistente atingiu o limite de uso de hoje. Tente novamente amanhã.";
  }
  if (decision === "rate_minute" || decision === "rate_day" || decision === "cooldown") {
    return "Você enviou muitas mensagens. Aguarde um pouco antes de tentar novamente.";
  }
  return undefined;
}
