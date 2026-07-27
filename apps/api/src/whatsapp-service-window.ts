import { db, type DatabaseClient } from "./db.js";

export interface WhatsAppServiceWindow {
  isOpen: boolean;
  lastInboundAt: string | null;
  expiresAt: string | null;
}

interface ServiceWindowRow {
  last_inbound_at: string;
  expires_at: string;
  is_open: boolean;
}

function normalizedE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) {
    throw new Error("Número do WhatsApp inválido para controle da janela");
  }
  // A Meta pode entregar o wa_id brasileiro sem o nono dígito, enquanto os
  // envios usam o número móvel canônico. Ambos devem apontar para uma janela.
  return /^55\d{10}$/.test(digits)
    ? `${digits.slice(0, 4)}9${digits.slice(4)}`
    : digits;
}

export async function recordWhatsAppInbound(
  phone: string,
  receivedAt: Date,
  client: DatabaseClient = db,
): Promise<void> {
  await client.execute(`
    INSERT INTO private.whatsapp_service_windows (phone_e164, last_inbound_at)
    VALUES (?, ?)
    ON CONFLICT (phone_e164) DO UPDATE
       SET last_inbound_at = GREATEST(
         private.whatsapp_service_windows.last_inbound_at,
         EXCLUDED.last_inbound_at
       )
  `, normalizedE164(phone), receivedAt);
}

export async function getWhatsAppServiceWindow(
  phone: string,
  client: DatabaseClient = db,
): Promise<WhatsAppServiceWindow> {
  const row = await client.queryOne<ServiceWindowRow>(`
    SELECT last_inbound_at::text,
           (last_inbound_at + interval '24 hours')::text AS expires_at,
           last_inbound_at + interval '24 hours' > CURRENT_TIMESTAMP AS is_open
      FROM private.whatsapp_service_windows
     WHERE phone_e164 = ?
  `, normalizedE164(phone));

  return row ? {
    isOpen: row.is_open,
    lastInboundAt: new Date(row.last_inbound_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  } : {
    isOpen: false,
    lastInboundAt: null,
    expiresAt: null,
  };
}

export async function assertWhatsAppServiceWindowOpen(
  phone: string,
  client: DatabaseClient = db,
): Promise<void> {
  const window = await getWhatsAppServiceWindow(phone, client);
  if (!window.isOpen) {
    throw new Error("Janela de atendimento do WhatsApp encerrada; use um template aprovado");
  }
}
