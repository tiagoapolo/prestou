import { z } from "zod";
import { amountCentsSchema, isoDateSchema, mobileSchema, requiredText } from "./validation.js";
import { AssistantServiceError, openAiProvider, type LlmProvider, type LlmTool } from "./llm.js";
import { saoPauloDateISO } from "./dates.js";
import { formatBRL } from "./format.js";
import type { DefaultDueDays, DerivedStatus } from "./types.js";

export { AssistantServiceError };

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
  | { kind: "clarification"; message: string }
  | { kind: "text"; message: string; classification?: "unsupported" };

/** Cobrança em atraso, já resolvida e formatável pelo backend. */
export interface OverdueCharge {
  clientName: string;
  amountCents: number;
  dueDate: string;
}

/** Uma parcela de um cliente, com o status derivado. */
export interface ClientCharge {
  description: string;
  amountCents: number;
  dueDate: string;
  status: DerivedStatus;
}

export interface FinancialSummary {
  aReceberCents: number;
  recebidoMesCents: number;
  atrasadasCount: number;
}

/**
 * Acesso a dados escopado por prestador. O orquestrador nunca envia esses dados
 * ao modelo: a resolução de cliente e as leituras acontecem no backend, com o
 * `providerId` já autorizado pela borda (JWT no Dashboard, número verificado no
 * WhatsApp).
 */
export interface AssistantDeps {
  listClients(providerId: string): Promise<AssistantClient[]>;
  listOverdue(providerId: string): Promise<OverdueCharge[]>;
  clientCharges(providerId: string, clientId: string): Promise<ClientCharge[]>;
  financialSummary(providerId: string): Promise<FinancialSummary>;
}

export interface InterpretMessageInput {
  providerId: string;
  message: string;
  deps: AssistantDeps;
  apiKey: string;
  model: string;
  defaultDueDays?: DefaultDueDays;
  llm?: LlmProvider;
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
}

const extractedChargeSchema = z.object({
  clientName: z.string().nullable(),
  clientWhatsapp: z.string().nullable(),
  description: z.string().nullable(),
  amountCents: z.number().int().nullable(),
  dueDate: z.string().nullable(),
}).strict();

const clientNameArgsSchema = z.object({ clientName: z.string() }).strict();

const chargeTool: LlmTool = {
  name: "preparar_cobranca",
  description: "Extrai os campos de uma cobrança sem criá-la.",
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
};

const readTools: LlmTool[] = [
  {
    name: "listar_inadimplentes",
    description: "Lista quem está em atraso / quem deve. Sem argumentos.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "status_cliente",
    description: "Mostra a situação das cobranças de um cliente específico.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { clientName: { type: "string", description: "Nome do cliente citado." } },
      required: ["clientName"],
    },
  },
  {
    name: "resumo_financeiro",
    description: "Informa se há cobranças em aberto e resume a receber, recebido e atrasadas. Sem argumentos.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "pedido_nao_suportado",
    description: "Use quando o pedido está fora do que o assistente sabe fazer.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
];

const ALL_TOOLS: LlmTool[] = [chargeTool, ...readTools];

const CAPABILITIES =
  "Posso preparar uma cobrança, listar quem está em atraso, mostrar a situação " +
  "de um cliente e resumir o mês.";

function instructions(today: string): string {
  return [
    "Você é o assistente do prestador no Prestou. Escolha exatamente uma ferramenta.",
    `Hoje em America/Sao_Paulo é ${today}.`,
    "Para cobrar, use preparar_cobranca: converta reais em centavos inteiros e datas relativas para AAAA-MM-DD; use null para todo campo ausente e não invente nada.",
    "Para 'quem me deve' / atrasados, use listar_inadimplentes. Para a situação de um cliente citado pelo nome, use status_cliente. Para cobranças em aberto, pendências, 'quanto tenho a receber' ou resumo do mês, use resumo_financeiro.",
    "Se o pedido não se encaixar em nenhuma dessas, use pedido_nao_suportado.",
  ].join(" ");
}

function normalizedName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function validText(value: string | null, label: string, min: number, max: number): string | null {
  if (value === null) return null;
  const parsed = requiredText(label, min, max).safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function matchingClients(
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

export function buildDraft(
  extracted: z.infer<typeof extractedChargeSchema>,
  clients: AssistantClient[],
  defaultDueDate: string,
): AssistantResult {
  const missing: string[] = [];
  const clientName = validText(extracted.clientName, "Nome do cliente", 2, 80);
  const description = validText(extracted.description, "Serviço", 2, 120);
  const amount = extracted.amountCents === null
    ? null
    : amountCentsSchema.safeParse(extracted.amountCents);
  const dueDate = extracted.dueDate === null
    ? isoDateSchema.safeParse(defaultDueDate)
    : isoDateSchema.safeParse(extracted.dueDate);
  const whatsapp = extracted.clientWhatsapp === null
    ? null
    : mobileSchema.safeParse(extracted.clientWhatsapp);

  if (!clientName) missing.push("o cliente");
  if (!description) missing.push("o serviço");
  if (!amount || !amount.success) missing.push("o valor");
  if (!dueDate.success) missing.push("o vencimento");
  if (missing.length > 0) return clarification(missing);
  if (!clientName || !description || !amount?.success || !dueDate.success) {
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

function formatShortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

const STATUS_LABEL: Record<DerivedStatus, string> = {
  em_aberto: "em aberto",
  atrasada: "atrasada",
  cliente_confirmou: "aguardando validação",
  paga: "paga",
};

const OVERDUE_LIMIT = 10;

function renderOverdue(items: OverdueCharge[]): AssistantResult {
  if (items.length === 0) {
    return { kind: "text", message: "Ninguém está em atraso por aqui. 🎉" };
  }
  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const shown = items.slice(0, OVERDUE_LIMIT);
  const lines = shown.map(
    (item) => `• ${item.clientName} · ${formatBRL(item.amountCents)} · venceu em ${formatShortDate(item.dueDate)}`,
  );
  if (items.length > OVERDUE_LIMIT) {
    lines.push(`…e mais ${items.length - OVERDUE_LIMIT}.`);
  }
  const header = items.length === 1
    ? `1 cobrança em atraso, somando ${formatBRL(totalCents)}:`
    : `${items.length} cobranças em atraso, somando ${formatBRL(totalCents)}:`;
  return { kind: "text", message: [header, ...lines].join("\n") };
}

async function handleClientStatus(
  input: InterpretMessageInput,
  clientName: string,
): Promise<AssistantResult> {
  const clients = await input.deps.listClients(input.providerId);
  const matches = matchingClients(clients, clientName);
  if (matches.length === 0) {
    return { kind: "text", message: `Não encontrei um cliente com o nome "${clientName}".` };
  }
  if (matches.length > 1) {
    const names = matches.map((client) => client.name).join(", ");
    return {
      kind: "clarification",
      message: `Há mais de um cliente parecido com "${clientName}": ${names}. Qual deles?`,
    };
  }

  const client = matches[0]!;
  const charges = await input.deps.clientCharges(input.providerId, client.id);
  if (charges.length === 0) {
    return { kind: "text", message: `${client.name} não tem cobranças registradas.` };
  }
  // Sem PSP no MVP: "pagou?" reflete o estado da cobrança, não o extrato bancário.
  const lines = charges.map(
    (charge) => `• ${charge.description} · ${formatBRL(charge.amountCents)} · vence ${formatShortDate(charge.dueDate)} · ${STATUS_LABEL[charge.status]}`,
  );
  return {
    kind: "text",
    message: [`Situação de ${client.name} (pelo registro no Prestou):`, ...lines].join("\n"),
  };
}

async function handleFinancialSummary(input: InterpretMessageInput): Promise<AssistantResult> {
  const summary = await input.deps.financialSummary(input.providerId);
  const atrasadas = summary.atrasadasCount === 1
    ? "1 cobrança atrasada"
    : `${summary.atrasadasCount} cobranças atrasadas`;
  return {
    kind: "text",
    message: [
      `A receber: ${formatBRL(summary.aReceberCents)}.`,
      `Recebido no mês: ${formatBRL(summary.recebidoMesCents)}.`,
      `${atrasadas}.`,
    ].join("\n"),
  };
}

function addDaysISO(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Cérebro único do assistente, agnóstico de canal. Recebe o `providerId` já
 * resolvido pela borda (nunca confia em identidade externa) e devolve uma união
 * discriminada que cada canal renderiza como quiser (cards no Dashboard,
 * texto/botões no WhatsApp).
 */
export async function interpretMessage(input: InterpretMessageInput): Promise<AssistantResult> {
  const today = saoPauloDateISO(input.now ?? new Date());
  const llm = input.llm ?? openAiProvider;

  const call = await llm.interpret({
    apiKey: input.apiKey,
    model: input.model,
    providerId: input.providerId,
    instructions: instructions(today),
    tools: ALL_TOOLS,
    message: input.message,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  switch (call.name) {
    case "preparar_cobranca": {
      const extracted = extractedChargeSchema.safeParse(call.arguments);
      if (!extracted.success) throw new AssistantServiceError("Campos inválidos do assistente");
      const clients = await input.deps.listClients(input.providerId);
      const defaultDueDate = addDaysISO(today, input.defaultDueDays ?? 0);
      return buildDraft(extracted.data, clients, defaultDueDate);
    }
    case "listar_inadimplentes":
      return renderOverdue(await input.deps.listOverdue(input.providerId));
    case "status_cliente": {
      const args = clientNameArgsSchema.safeParse(call.arguments);
      if (!args.success) throw new AssistantServiceError("Cliente não informado pelo assistente");
      return handleClientStatus(input, args.data.clientName);
    }
    case "resumo_financeiro":
      return handleFinancialSummary(input);
    case "pedido_nao_suportado":
      return {
        kind: "text",
        message: `Ainda não sei fazer isso. ${CAPABILITIES}`,
        classification: "unsupported",
      };
    default:
      return {
        kind: "text",
        message: `Ainda não sei fazer isso. ${CAPABILITIES}`,
        classification: "unsupported",
      };
  }
}
