import { queryAll, queryOne } from "./db.js";
import { track } from "./analytics.js";
import { notifyProvider } from "./notify.js";
import { reminderMessage, waMeLink, formatBRL } from "./messages.js";
import { todayISO } from "./state.js";
import type { PaymentRow, ProviderRow } from "./types.js";

/** Offsets de lembrete a partir do vencimento (F8): no dia, D+2 e D+5. */
export const REMINDER_OFFSETS = [0, 2, 5] as const;

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * F8 — lembrete semiautomático.
 *
 * O Prestou avisa o PRESTADOR (não o cliente) com o link wa.me já montado:
 * ele toca e o chat do cliente abre com o texto pronto, sem sair do WhatsApp.
 * Envio automático ao cliente final é V2 (depende da API do WhatsApp).
 *
 * Idempotente por dia: não dispara duas vezes o mesmo lembrete.
 */
export async function runReminders(today = todayISO()): Promise<{
  checked: number;
  sent: number;
}> {
  const rows = await queryAll<
    PaymentRow & {
      description: string;
      provider_id: string;
      client_name: string;
      client_whatsapp: string;
    }
  >(
    `SELECT p.*, c.description, c.provider_id, cl.name AS client_name, cl.whatsapp AS client_whatsapp
       FROM payments p
       JOIN charges c ON c.id = p.charge_id
       JOIN clients cl ON cl.id = c.client_id
      WHERE p.status = 'em_aberto'
        AND p.due_date <= ?`,
    today,
  );

  let sent = 0;

  for (const row of rows) {
    const overdueDays = daysBetween(row.due_date, today);
    if (!REMINDER_OFFSETS.includes(overdueDays as (typeof REMINDER_OFFSETS)[number])) {
      continue;
    }

    // Idempotência: um lembrete por parcela por dia.
    const already = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM events
        WHERE type = 'lembrete_disparado'
          AND payment_id = ?
          AND substr(created_at, 1, 10) = ?`,
      row.id,
      today,
    );
    if ((already?.n ?? 0) > 0) continue;

    const provider = await queryOne<ProviderRow>(
      "SELECT * FROM providers WHERE id = ?",
      row.provider_id,
    );
    if (!provider) continue;

    const message = reminderMessage({
      clientName: row.client_name,
      providerName: provider.name,
      description: row.description,
      amountCents: row.amount_cents,
      publicToken: row.public_token,
    });

    const label =
      overdueDays === 0 ? "vence hoje" : `está ${overdueDays} dias em atraso`;

    await notifyProvider({
      provider,
      paymentId: row.id,
      kind: "reminder",
      body:
        `A cobrança de ${formatBRL(row.amount_cents)} de ${row.client_name} ` +
        `(${row.description}) ${label}. Toque para enviar o lembrete pronto.`,
      waDeeplink: waMeLink(row.client_whatsapp, message),
      template: "lembrete_cobranca_prestador",
      templateParams: [row.client_name, formatBRL(row.amount_cents), label],
    });

    await track({
      type: "lembrete_disparado",
      providerId: provider.id,
      chargeId: row.charge_id,
      paymentId: row.id,
      metadata: { overdueDays },
    });
    sent++;
  }

  return { checked: rows.length, sent };
}
