import { createHmac, timingSafeEqual } from "node:crypto";
import type { AssistantResult } from "../orchestrator.js";
import { formatBRL } from "../format.js";

interface CreatedChargeMessageInput {
  clientName: string;
  amountCents: number;
  paymentUrl: string;
  description?: string;
}

export function createdChargeMessages(
  result: CreatedChargeMessageInput,
  alreadyCreated: boolean,
): string[] {
  const prefix = alreadyCreated ? "Esta cobrança já foi criada." : "Cobrança criada com sucesso.";
  const summary = (
    `${prefix}\n` +
    `• Cliente: ${result.clientName}\n` +
    `• Valor: ${formatBRL(result.amountCents)}`
  );

  // Propostas consumidas antes deste formato não persistiam a descrição.
  if (!result.description) {
    return [`${summary}\n• Link para enviar ao cliente: ${result.paymentUrl}`];
  }

  return [
    `${summary}\n\nSe quiser, encaminhe a mensagem abaixo para o cliente.`,
    `Oi ${result.clientName}, segue o link de pagamento referente ao serviço ${result.description}.\n${result.paymentUrl}`,
  ];
}

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
  receivedAt?: string;
  kind: "text";
  text: string;
} | {
  id: string;
  from: string;
  receivedAt?: string;
  kind: "button";
  buttonId: string;
};

export type WhatsAppChargeAction = "create" | "edit" | "cancel";

function messageReceivedAt(timestamp: unknown): string | undefined {
  if (typeof timestamp !== "string" || !/^\d+$/.test(timestamp)) return undefined;
  const receivedAt = new Date(Number(timestamp) * 1000);
  return Number.isNaN(receivedAt.getTime()) ? undefined : receivedAt.toISOString();
}

export function whatsappChargeActionId(
  action: WhatsAppChargeAction,
  proposalId: string,
): string {
  return `charge:${action}:${proposalId}`;
}

export function parseWhatsAppChargeAction(
  buttonId: string,
): { action: WhatsAppChargeAction; proposalId: string } | undefined {
  const match = /^charge:(create|edit|cancel):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(buttonId);
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
              id: whatsappChargeActionId("edit", proposalId),
              title: "Editar dados",
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

/** Candidatos nacionais usados nas colunas canônicas do Prestou. */
export function nationalWhatsAppIdentityCandidates(from: string): [string, string] {
  const [first, second] = whatsappIdentityCandidates(from);
  return [first.replace(/^55/, ""), second.replace(/^55/, "")];
}

/** Formato persistido em `providers.whatsapp` e nas sessões: DDD + nono dígito. */
const NATIONAL_MOBILE = /^[1-9][0-9]9[0-9]{8}$/;

/**
 * Forma canônica para gravar identidade nova (sem linha existente para resolver).
 * A ordem dos candidatos depende de a Meta entregar ou não o nono dígito, então
 * escolhemos pelo formato — não pelo índice. Sem candidato válido (número
 * estrangeiro, por exemplo) não há identidade a persistir.
 */
export function canonicalNationalWhatsApp(from: string): string | undefined {
  return nationalWhatsAppIdentityCandidates(from).find((candidate) =>
    NATIONAL_MOBILE.test(candidate)
  );
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
        const receivedAt = messageReceivedAt(
          (message as { timestamp?: unknown }).timestamp,
        );
        const text = (message as { text?: { body?: unknown } }).text?.body;
        if (typeof id === "string" && typeof from === "string" && typeof text === "string" && text.trim()) {
          return {
            id,
            from,
            ...(receivedAt ? { receivedAt } : {}),
            kind: "text",
            text: text.trim(),
          };
        }
        const buttonId = (
          message as { interactive?: { button_reply?: { id?: unknown } } }
        ).interactive?.button_reply?.id;
        if (typeof id === "string" && typeof from === "string" && typeof buttonId === "string" && buttonId) {
          return { id, from, ...(receivedAt ? { receivedAt } : {}), kind: "button", buttonId };
        }
        const templateButtonPayload = (
          message as { button?: { payload?: unknown } }
        ).button?.payload;
        if (
          typeof id === "string" && typeof from === "string" &&
          typeof templateButtonPayload === "string" && templateButtonPayload
        ) {
          return {
            id,
            from,
            ...(receivedAt ? { receivedAt } : {}),
            kind: "button",
            buttonId: templateButtonPayload,
          };
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
