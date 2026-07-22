import { z } from "zod";
import { openAiProvider } from "./llm.js";
import {
  AssistantServiceError,
  buildDraft,
  type AssistantClient,
  type AssistantResult,
  type ChargeDraft,
} from "./orchestrator.js";
import { saoPauloDateISO } from "./dates.js";
import type { DefaultDueDays } from "./types.js";

export { AssistantServiceError };
export type { AssistantClient, AssistantResult, ChargeDraft };

interface InterpretOptions {
  apiKey: string;
  model: string;
  providerId: string;
  clients: AssistantClient[];
  defaultDueDays?: DefaultDueDays;
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
}

const chargeToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    clientName: { type: ["string", "null"], description: "Nome do cliente ou null." },
    clientWhatsapp: { type: ["string", "null"], description: "WhatsApp com DDD ou null." },
    description: { type: ["string", "null"], description: "Serviço cobrado ou null." },
    amountCents: { type: ["integer", "null"], description: "Valor em centavos ou null." },
    dueDate: { type: ["string", "null"], description: "Vencimento AAAA-MM-DD ou null." },
  },
  required: ["clientName", "clientWhatsapp", "description", "amountCents", "dueDate"],
} as const;

/**
 * Caso particular do orquestrador: extração de cobrança com a lista de clientes
 * já em mãos (usado por `POST /api/assistant/interpret`, o assistente single-shot
 * do Dashboard). O orquestrador completo (`interpretMessage`) cobre também as
 * intenções de leitura e é servido por `POST /api/assistant/chat`.
 */
export async function interpretChargeMessage(
  message: string,
  options: InterpretOptions,
): Promise<AssistantResult> {
  const today = saoPauloDateISO(options.now ?? new Date());
  const defaultDueDate = addDaysISO(today, options.defaultDueDays ?? 0);

  const call = await openAiProvider.interpret({
    apiKey: options.apiKey,
    model: options.model,
    providerId: options.providerId,
    instructions: [
      "Você extrai dados para um rascunho de cobrança do Prestou.",
      `Hoje em America/Sao_Paulo é ${today}.`,
      "Converta valores em reais para centavos inteiros e datas relativas para AAAA-MM-DD.",
      "Extraia somente o que o usuário informou. Não invente cliente, telefone, serviço, valor ou vencimento.",
      "Use null para todo campo ausente. Sempre chame preparar_cobranca uma única vez.",
    ].join(" "),
    tools: [{
      name: "preparar_cobranca",
      description: "Extrai os campos de uma cobrança sem criá-la.",
      parameters: chargeToolParameters,
    }],
    message,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });

  if (call.name !== "preparar_cobranca") {
    throw new AssistantServiceError("O assistente não preparou a cobrança");
  }
  const extracted = extractedChargeSchema.safeParse(call.arguments);
  if (!extracted.success) throw new AssistantServiceError("Campos inválidos do assistente");
  return buildDraft(extracted.data, options.clients, defaultDueDate);
}

const extractedChargeSchema = z.object({
  clientName: z.string().nullable(),
  clientWhatsapp: z.string().nullable(),
  description: z.string().nullable(),
  amountCents: z.number().int().nullable(),
  dueDate: z.string().nullable(),
}).strict();

function addDaysISO(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}
