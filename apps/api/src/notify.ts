import { config } from "./config.js";
import { db } from "./db.js";
import { newId } from "./ids.js";
import type { ProviderRow } from "./types.js";

export type NotificationKind =
  | "client_confirmed" // cliente tocou "já paguei"
  | "reminder" // vencimento / atraso
  | "contest_followup"; // prestador contestou, mensagem pronta pro cliente

export interface NotifyInput {
  provider: ProviderRow;
  paymentId?: string;
  kind: NotificationKind;
  /** Corpo legível (usado no modo log e como fallback). */
  body: string;
  /** Link wa.me pronto pro prestador reenviar ao cliente em um toque. */
  waDeeplink?: string;
  /** Nome do template aprovado na Meta (modo cloud-api). */
  template?: string;
  /** Parâmetros posicionais do template ({{1}}, {{2}}, ...). */
  templateParams?: string[];
}

/**
 * Notificação ao prestador.
 *
 * Decisão 2b do plano: o prestador é avisado por WhatsApp, não por push de PWA.
 * Estritamente unidirecional (Prestou → prestador); o cliente final nunca
 * recebe mensagem automática no MVP.
 *
 * Modo "log" (default) grava no banco sem enviar — permite rodar o MVP inteiro
 * sem credenciais da Meta. Modo "cloud-api" envia de verdade.
 */
export async function notifyProvider(input: NotifyInput): Promise<void> {
  const id = newId();
  const now = new Date().toISOString();

  const insert = (status: string, error: string | null) =>
    db.execute(`
        INSERT INTO notifications (id, provider_id, payment_id, kind, body, wa_deeplink, status, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        id,
        input.provider.id,
        input.paymentId ?? null,
        input.kind,
        input.body,
        input.waDeeplink ?? null,
        status,
        error,
        now,
      );

  if (config.whatsapp.mode === "log") {
    await insert("logged", null);
    console.info(
      `[notify:log] → ${input.provider.whatsapp} (${input.kind}): ${input.body}`,
    );
    return;
  }

  try {
    await sendViaCloudApi(input);
    await insert("sent", null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await insert("failed", message);
    // Falha de notificação não pode derrubar a operação de negócio.
    console.error(`[notify:cloud-api] falhou: ${message}`);
  }
}

/**
 * Envio via Cloud API da Meta (WABA própria, número central, sem BSP).
 * Usa template utility aprovado — nunca marketing (10x mais caro).
 */
async function sendViaCloudApi(input: NotifyInput): Promise<void> {
  const { phoneNumberId, accessToken, templateLang } = config.whatsapp;
  if (!phoneNumberId || !accessToken) {
    throw new Error(
      "WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN são obrigatórios no modo cloud-api",
    );
  }

  const to = input.provider.whatsapp.replace(/\D/g, "");
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  const payload = input.template
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: input.template,
          language: { code: templateLang },
          components: input.templateParams?.length
            ? [
                {
                  type: "body",
                  parameters: input.templateParams.map((text) => ({
                    type: "text",
                    text,
                  })),
                },
              ]
            : undefined,
        },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: input.body } };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Cloud API ${res.status}: ${await res.text()}`);
  }
}
