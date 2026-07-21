import { createHash } from "node:crypto";
import { z } from "zod";
import { amountCentsSchema, isoDateSchema, mobileSchema, requiredText } from "./validation.js";

const extractedChargeSchema = z.object({
  clientName: z.string().nullable(),
  clientWhatsapp: z.string().nullable(),
  description: z.string().nullable(),
  amountCents: z.number().int().nullable(),
  dueDate: z.string().nullable(),
}).strict();

const openAiResponseSchema = z.object({
  output: z.array(z.object({
    type: z.string(),
    name: z.string().optional(),
    arguments: z.string().optional(),
  }).passthrough()),
}).passthrough();

export interface AssistantClient {
  id: string;
  name: string;
  whatsapp: string;
}

export interface ChargeDraft {
  client: { id?: string; name: string; whatsapp: string };
  description: string;
  amountCents: number;
  dueDate: string;
}

export type AssistantResult =
  | { kind: "draft"; message: string; draft: ChargeDraft }
  | { kind: "clarification"; message: string };

interface InterpretOptions {
  apiKey: string;
  model: string;
  providerId: string;
  clients: AssistantClient[];
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
}

export class AssistantServiceError extends Error {
  statusCode = 502;

  constructor(message: string) {
    super(message);
    this.name = "AssistantServiceError";
  }
}

function saoPauloDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function normalizedName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function validText(value: string | null, label: string, min: number, max: number): string | null {
  if (value === null) return null;
  const parsed = requiredText(label, min, max).safeParse(value);
  return parsed.success ? parsed.data : null;
}

function matchingClients(
  clients: AssistantClient[],
  clientName: string,
): AssistantClient[] {
  const wanted = normalizedName(clientName);
  const exact = clients.filter((client) => normalizedName(client.name) === wanted);
  if (exact.length > 0) return exact;
  return clients.filter((client) => {
    const candidate = normalizedName(client.name);
    return candidate.includes(wanted) || wanted.includes(candidate);
  });
}

function clarification(fields: string[]): AssistantResult {
  const unique = [...new Set(fields)];
  return {
    kind: "clarification",
    message: `Para preparar a cobrança, informe ${unique.join(", ")}.`,
  };
}

function buildDraft(
  extracted: z.infer<typeof extractedChargeSchema>,
  clients: AssistantClient[],
): AssistantResult {
  const missing: string[] = [];
  const clientName = validText(extracted.clientName, "Nome do cliente", 2, 80);
  const description = validText(extracted.description, "Serviço", 2, 120);
  const amount = extracted.amountCents === null
    ? null
    : amountCentsSchema.safeParse(extracted.amountCents);
  const dueDate = extracted.dueDate === null
    ? null
    : isoDateSchema.safeParse(extracted.dueDate);
  const whatsapp = extracted.clientWhatsapp === null
    ? null
    : mobileSchema.safeParse(extracted.clientWhatsapp);

  if (!clientName) missing.push("o cliente");
  if (!description) missing.push("o serviço");
  if (!amount || !amount.success) missing.push("o valor");
  if (!dueDate || !dueDate.success) missing.push("o vencimento");
  if (missing.length > 0) return clarification(missing);
  if (!clientName || !description || !amount?.success || !dueDate?.success) {
    throw new AssistantServiceError("O rascunho não contém todos os campos obrigatórios");
  }

  const byPhone = whatsapp?.success
    ? clients.find((client) => client.whatsapp === whatsapp.data)
    : undefined;
  const byName = matchingClients(clients, clientName);
  if (byPhone && matchingClients([byPhone], clientName).length === 0) {
    return clarification(["o nome e o WhatsApp do cliente, pois correspondem a cadastros diferentes"]);
  }
  if (!byPhone && byName.length > 1 && !whatsapp?.success) {
    return clarification([`o WhatsApp de ${clientName}, pois há clientes com nomes parecidos`]);
  }

  const existing = byPhone ?? (byName.length === 1 ? byName[0] : undefined);
  if (!existing && !whatsapp?.success) {
    return clarification([`o WhatsApp de ${clientName}`]);
  }
  const client = existing
    ? { id: existing.id, name: existing.name, whatsapp: existing.whatsapp }
    : whatsapp?.success
      ? { name: clientName, whatsapp: whatsapp.data }
      : undefined;
  if (!client) throw new AssistantServiceError("O rascunho não identificou o cliente");

  return {
    kind: "draft",
    message: "Rascunho pronto. Revise os dados antes de criar a cobrança.",
    draft: {
      client,
      description,
      amountCents: amount.data,
      dueDate: dueDate.data,
    },
  };
}

export async function interpretChargeMessage(
  message: string,
  options: InterpretOptions,
): Promise<AssistantResult> {
  const today = saoPauloDate(options.now ?? new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      body: JSON.stringify({
        model: options.model,
        store: false,
        parallel_tool_calls: false,
        tool_choice: "required",
        max_output_tokens: 300,
        reasoning: { effort: "low" },
        safety_identifier: createHash("sha256").update(options.providerId).digest("hex"),
        instructions: [
          "Você extrai dados para um rascunho de cobrança do Prestou.",
          `Hoje em America/Sao_Paulo é ${today}.`,
          "Converta valores em reais para centavos inteiros e datas relativas para AAAA-MM-DD.",
          "Extraia somente o que o usuário informou. Não invente cliente, telefone, serviço, valor ou vencimento.",
          "Use null para todo campo ausente. Sempre chame preparar_cobranca uma única vez.",
        ].join(" "),
        input: [{ role: "user", content: message }],
        tools: [{
          type: "function",
          name: "preparar_cobranca",
          description: "Extrai os campos de uma cobrança sem criá-la.",
          strict: true,
          parameters: {
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
          },
        }],
      }),
    });
  } catch (error) {
    throw new AssistantServiceError(
      error instanceof Error && error.name === "TimeoutError"
        ? "O assistente demorou para responder"
        : "Não foi possível consultar o assistente",
    );
  }

  if (!response.ok) {
    throw new AssistantServiceError(`OpenAI respondeu com status ${response.status}`);
  }

  const payload = openAiResponseSchema.safeParse(await response.json());
  if (!payload.success) throw new AssistantServiceError("Resposta inválida do assistente");
  const call = payload.data.output.find(
    (item) => item.type === "function_call" && item.name === "preparar_cobranca",
  );
  if (!call?.arguments) throw new AssistantServiceError("O assistente não preparou a cobrança");

  let argumentsValue: unknown;
  try {
    argumentsValue = JSON.parse(call.arguments);
  } catch {
    throw new AssistantServiceError("Argumentos inválidos do assistente");
  }
  const extracted = extractedChargeSchema.safeParse(argumentsValue);
  if (!extracted.success) throw new AssistantServiceError("Campos inválidos do assistente");
  return buildDraft(extracted.data, options.clients);
}
