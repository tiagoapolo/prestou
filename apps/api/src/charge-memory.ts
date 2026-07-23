import { execute, queryOne } from "./db.js";
import type { ChargeMemory, PartialCharge } from "./orchestrator.js";

/**
 * Janela em que um preenchimento de cobrança em andamento continua válido. Curta
 * de propósito: passado esse tempo sem concluir, a próxima mensagem começa do
 * zero. Alinhada ao TTL do rascunho já confirmável (whatsapp_charge_proposals).
 */
const PENDING_CHARGE_TTL_MINUTES = 10;

interface PendingRow {
  partial: unknown;
}

/** jsonb já vem desserializado do driver, mas normalizamos por segurança. */
function persistedJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

/**
 * Memória real do preenchimento de cobrança: um único rascunho parcial por
 * prestador, com TTL. Nenhum desses dados chega ao modelo — o orquestrador só o
 * usa para mesclar com a mensagem seguinte.
 */
export const dbChargeMemory: ChargeMemory = {
  async load(providerId: string): Promise<PartialCharge | null> {
    const row = await queryOne<PendingRow>(
      `SELECT partial FROM whatsapp_pending_charges
        WHERE provider_id = ? AND expires_at > CURRENT_TIMESTAMP`,
      providerId,
    );
    return row ? (persistedJson(row.partial) as PartialCharge) : null;
  },

  async save(providerId: string, partial: PartialCharge): Promise<void> {
    await execute(
      `INSERT INTO whatsapp_pending_charges (provider_id, partial, expires_at)
       VALUES (?, ?::text::jsonb, CURRENT_TIMESTAMP + INTERVAL '${PENDING_CHARGE_TTL_MINUTES} minutes')
       ON CONFLICT (provider_id) DO UPDATE SET
         partial = excluded.partial,
         expires_at = excluded.expires_at,
         updated_at = CURRENT_TIMESTAMP`,
      providerId,
      JSON.stringify(partial),
    );
  },

  async clear(providerId: string): Promise<void> {
    await execute("DELETE FROM whatsapp_pending_charges WHERE provider_id = ?", providerId);
  },
};
