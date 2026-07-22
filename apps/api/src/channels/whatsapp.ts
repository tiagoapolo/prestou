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

/** Mensagem inbound já normalizada (só o que o orquestrador precisa). */
export interface InboundMessage {
  from: string;
  text: string;
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
        const from = (message as { from?: unknown }).from;
        const text = (message as { text?: { body?: unknown } }).text?.body;
        if (typeof from === "string" && typeof text === "string" && text.trim()) {
          return { from, text: text.trim() };
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
      "Abra o Prestou para revisar e criar a cobrança."
    );
  }
  return result.message;
}
