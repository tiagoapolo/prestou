import { createHmac, timingSafeEqual } from "node:crypto";
import type { AssistantResult } from "../orchestrator.js";

/**
 * Verifica a assinatura `X-Hub-Signature-256` da Meta sobre o corpo cru do
 * webhook. É o "auth" do inbound: prova que o request veio da Meta, antes de o
 * número identificar qual prestador é. Comparação em tempo constante.
 */
export function verifySignature(
  appSecret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/** Mensagem inbound já normalizada para texto ou clique em botão. */
export type InboundMessage = {
  id: string;
  from: string;
  kind: "text";
  text: string;
} | {
  id: string;
  from: string;
  kind: "button";
  buttonId: string;
};

export type WhatsAppChargeAction = "create" | "cancel";

export function whatsappChargeActionId(
  action: WhatsAppChargeAction,
  proposalId: string,
): string {
  return `charge:${action}:${proposalId}`;
}

export function parseWhatsAppChargeAction(
  buttonId: string,
): { action: WhatsAppChargeAction; proposalId: string } | undefined {
  const match = /^charge:(create|cancel):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(buttonId);
  if (!match) return undefined;
  return {
    action: match[1] as WhatsAppChargeAction,
    proposalId: match[2]!,
  };
}

export function chargeConfirmationPayload(
  to: string,
  text: string,
  proposalId: string,
) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: whatsappChargeActionId("create", proposalId),
              title: "Criar cobrança",
            },
          },
          {
            type: "reply",
            reply: {
              id: whatsappChargeActionId("cancel", proposalId),
              title: "Cancelar",
            },
          },
        ],
      },
    },
  };
}

/**
 * A Meta pode entregar o wa_id brasileiro sem o nono dígito, mesmo quando o
 * número autorizado e cadastrado usa o formato móvel atual. Consideramos as
 * duas formas somente para resolver a identidade já verificada no banco.
 */
export function whatsappIdentityCandidates(from: string): [string, string] {
  const digits = from.replace(/\D/g, "");
  if (/^55\d{10}$/.test(digits)) {
    return [digits, `${digits.slice(0, 4)}9${digits.slice(4)}`];
  }
  if (/^55\d{2}9\d{8}$/.test(digits)) {
    return [digits, `${digits.slice(0, 4)}${digits.slice(5)}`];
  }
  return [digits, digits];
}

/**
 * Extrai a primeira mensagem de texto de um payload de webhook da Cloud API.
 * Ignora status updates, reações e tipos não suportados nesta etapa (áudio é V2).
 */
export function parseInboundMessage(payload: unknown): InboundMessage | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return undefined;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const messages = (change as { value?: { messages?: unknown } }).value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        const id = (message as { id?: unknown }).id;
        const from = (message as { from?: unknown }).from;
        const text = (message as { text?: { body?: unknown } }).text?.body;
        if (typeof id === "string" && typeof from === "string" && typeof text === "string" && text.trim()) {
          return { id, from, kind: "text", text: text.trim() };
        }
        const buttonId = (
          message as { interactive?: { button_reply?: { id?: unknown } } }
        ).interactive?.button_reply?.id;
        if (typeof id === "string" && typeof from === "string" && typeof buttonId === "string" && buttonId) {
          return { id, from, kind: "button", buttonId };
        }
      }
    }
  }
  return undefined;
}

/**
 * Renderiza o resultado do orquestrador para o WhatsApp. Nesta etapa (só
 * leitura), todo resultado vira texto — inclusive o rascunho, cuja escrita
 * confirmada por botão é a Fase 2.
 */
export function renderResult(result: AssistantResult): string {
  if (result.kind === "draft") {
    const { draft } = result;
    return (
      `${result.message}\n` +
      `• Cliente: ${draft.client.name}\n` +
      `• Serviço: ${draft.description}\n` +
      `• Valor: ${(draft.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}\n` +
      `• Vencimento: ${draft.dueDate}\n` +
      "Confirme abaixo para criar a cobrança."
    );
  }
  return result.message;
}
