import { queryAll, queryOne } from "./db.js";
import { derivedStatus, todayISO } from "./state.js";
import type {
  AssistantClient,
  AssistantDeps,
  ClientCharge,
  FinancialSummary,
  OverdueCharge,
} from "./orchestrator.js";
import type { PaymentRow } from "./types.js";

function monthRange(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year!, monthNumber!, 1));
  return { from: `${month}-01`, to: next.toISOString().slice(0, 10) };
}

/**
 * Implementação real do `AssistantDeps`: leituras diretas no banco, sempre
 * escopadas por `provider_id`. Nenhum desses dados chega ao modelo — o
 * orquestrador só os usa para responder depois de a intenção estar resolvida.
 */
export const dbDeps: AssistantDeps = {
  async listClients(providerId: string): Promise<AssistantClient[]> {
    return queryAll<AssistantClient>(
      "SELECT id, name, whatsapp FROM clients WHERE provider_id = ? ORDER BY name",
      providerId,
    );
  },

  async listOverdue(providerId: string): Promise<OverdueCharge[]> {
    const rows = await queryAll<{ client_name: string; amount_cents: number; due_date: string }>(
      `SELECT cl.name AS client_name, p.amount_cents, p.due_date
         FROM payments p
         JOIN charges c ON c.id = p.charge_id
         JOIN clients cl ON cl.id = c.client_id
        WHERE c.provider_id = ? AND p.status = 'em_aberto' AND p.due_date < ?
        ORDER BY p.due_date ASC`,
      providerId,
      todayISO(),
    );
    return rows.map((row) => ({
      clientName: row.client_name,
      amountCents: row.amount_cents,
      dueDate: row.due_date,
    }));
  },

  async clientCharges(providerId: string, clientId: string): Promise<ClientCharge[]> {
    const today = todayISO();
    const rows = await queryAll<PaymentRow & { description: string }>(
      `SELECT p.*, c.description
         FROM payments p
         JOIN charges c ON c.id = p.charge_id
        WHERE c.provider_id = ? AND c.client_id = ?
        ORDER BY p.due_date DESC, p.id DESC`,
      providerId,
      clientId,
    );
    return rows.map((row) => ({
      description: row.description,
      amountCents: row.amount_cents,
      dueDate: row.due_date,
      status: derivedStatus(row, today),
    }));
  },

  async financialSummary(providerId: string): Promise<FinancialSummary> {
    const today = todayISO();
    const month = monthRange(today.slice(0, 7));
    const totals = await queryOne<{
      a_receber_cents: number | string;
      recebido_mes_cents: number | string;
      atrasadas_count: number | string;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN p.status <> 'paga' THEN p.amount_cents ELSE 0 END), 0) AS a_receber_cents,
         COALESCE(SUM(CASE WHEN p.status = 'paga' AND p.due_date >= ? AND p.due_date < ? THEN p.amount_cents ELSE 0 END), 0) AS recebido_mes_cents,
         COUNT(*) FILTER (WHERE p.status = 'em_aberto' AND p.due_date < ?) AS atrasadas_count
       FROM payments p
       JOIN charges c ON c.id = p.charge_id
      WHERE c.provider_id = ?`,
      month.from,
      month.to,
      today,
      providerId,
    );
    return {
      aReceberCents: Number(totals?.a_receber_cents ?? 0),
      recebidoMesCents: Number(totals?.recebido_mes_cents ?? 0),
      atrasadasCount: Number(totals?.atrasadas_count ?? 0),
    };
  },
};
