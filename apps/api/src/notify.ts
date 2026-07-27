import { config } from "./config.js";
import { db } from "./db.js";
import { newId } from "./ids.js";
import type { ProviderRow } from "./types.js";
import { assertWhatsAppServiceWindowOpen } from "./whatsapp-service-window.js";

export type NotificationKind =
  | "client_confirmed" // cliente tocou "já paguei"
  | "reminder" // vencimento / atraso
  | "contest_followup" // prestador contestou, mensagem pronta pro cliente
  | "whatsapp_verification"; // código para vincular o WhatsApp do prestador

export interface NotifyInput {
  provider: ProviderRow;
  paymentId?: string;
  kind: NotificationKind;
  /**
   * Destino explícito em E.164 (sem "+"). Usado na verificação de número, onde
   * o código precisa ir ao número *candidato*, não ao provider.whatsapp atual.
   * Ausente → cai no provider.whatsapp.
   */
  to?: string;
  /**
   * Quando true, uma falha de entrega (cloud-api) é propagada ao chamador em vez
   * de engolida. Usado no OTP: o /start não pode reportar sucesso se o código
   * não saiu.
   */
  required?: boolean;
  /**
   * Corpo legível persistido em `notifications.body` e nos logs. NUNCA deve
   * conter segredos como o código OTP — o código viaja só no template enviado à
   * Meta (templateParams), nunca aqui.
   */
  body: string;
  /** Link wa.me pronto pro prestador reenviar ao cliente em um toque. */
  waDeeplink?: string;
  /** Nome do template aprovado na Meta (modo cloud-api). */
  template?: string;
  /** Parâmetros posicionais do template ({{1}}, {{2}}, ...). */
  templateParams?: string[];
  /** Sufixo dinâmico do primeiro botão de URL do template. */
  templateUrlButtonParam?: string;
}

export function buildWhatsAppTemplatePayload(input: {
  to: string;
  name: string;
  language: string;
  bodyParams?: string[];
  urlButtonParam?: string;
  quickReplyButtonPayload?: string;
}) {
  const components = [];

  if (input.bodyParams?.length) {
    components.push({
      type: "body",
      parameters: input.bodyParams.map((text) => ({ type: "text", text })),
    });
  }

  if (input.urlButtonParam) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: input.urlButtonParam }],
    });
  }

  if (input.quickReplyButtonPayload) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: "0",
      parameters: [{ type: "payload", payload: input.quickReplyButtonPayload }],
    });
  }

  return {
    messaging_product: "whatsapp",
    to: input.to,
    type: "template",
    template: {
      name: input.name,
      language: { code: input.language },
      components: components.length ? components : undefined,
    },
  };
}

export async function sendWhatsAppTemplate(input: {
  to: string;
  name: string;
  bodyParams?: string[];
  urlButtonParam?: string;
  quickReplyButtonPayload?: string;
}): Promise<void> {
  const to = input.to.replace(/\D/g, "");
  if (config.whatsapp.mode === "log") {
    console.info(`[whatsapp:log] template ${input.name} → ${to}`);
    return;
  }

  const { phoneNumberId, accessToken, templateLang } = config.whatsapp;
  if (!phoneNumberId || !accessToken) {
    throw new Error(
      "WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN são obrigatórios no modo cloud-api",
    );
  }
  const payload = buildWhatsAppTemplatePayload({
    ...input,
    to,
    language: templateLang,
  });
  const res = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Cloud API ${res.status}: ${await res.text()}`);
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
      `[notify:log] → ${input.to ?? input.provider.whatsapp} (${input.kind}): ${input.body}`,
    );
    return;
  }

  try {
    await sendViaCloudApi(input);
    await insert("sent", null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await insert("failed", message);
    console.error(`[notify:cloud-api] falhou: ${message}`);
    // Notificações de negócio não podem derrubar a operação; o OTP, sim — se o
    // código não saiu, o chamador precisa saber e não reportar sucesso.
    if (input.required) throw err;
  }
}

/**
 * Envio via Cloud API da Meta (WABA própria, número central, sem BSP).
 * Usa template utility aprovado — nunca marketing (10x mais caro).
 */
async function sendViaCloudApi(input: NotifyInput): Promise<void> {
  const { phoneNumberId, accessToken } = config.whatsapp;
  if (!phoneNumberId || !accessToken) {
    throw new Error(
      "WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN são obrigatórios no modo cloud-api",
    );
  }

  const to = (input.to ?? input.provider.whatsapp).replace(/\D/g, "");
  if (input.template) {
    await sendWhatsAppTemplate({
      to,
      name: input.template,
      bodyParams: input.templateParams,
      urlButtonParam: input.templateUrlButtonParam,
    });
    return;
  }

  await assertWhatsAppServiceWindowOpen(to);

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
      text: { body: input.body },
    }),
  });

  if (!res.ok) {
    throw new Error(`Cloud API ${res.status}: ${await res.text()}`);
  }
}
