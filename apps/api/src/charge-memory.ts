import { db, execute, queryOne, type DatabaseClient } from "./db.js";
import type { ChargeDraftInput } from "./charge-creation.js";
import type { ChargeMemory, ChargeMemoryEntry } from "./orchestrator.js";

/**
 * Janela em que um preenchimento de cobrança em andamento continua válido. Curta
 * de propósito: passado esse tempo sem concluir, a próxima mensagem começa do
 * zero. Alinhada ao TTL do rascunho já confirmável (whatsapp_charge_proposals).
 */
const PENDING_CHARGE_TTL_MINUTES = 10;

interface PendingRow {
  partial: unknown;
  mode: string;
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
export async function savePendingCharge(
  client: DatabaseClient,
  providerId: string,
  entry: ChargeMemoryEntry,
): Promise<void> {
  await client.execute(
    `INSERT INTO whatsapp_pending_charges (provider_id, partial, mode, expires_at)
     VALUES (?, ?::text::jsonb, ?, CURRENT_TIMESTAMP + INTERVAL '${PENDING_CHARGE_TTL_MINUTES} minutes')
     ON CONFLICT (provider_id) DO UPDATE SET
       partial = excluded.partial,
       mode = excluded.mode,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP`,
    providerId,
    JSON.stringify(entry.partial),
    entry.mode,
  );
}

export async function startChargeDraftEdit(
  client: DatabaseClient,
  providerId: string,
  proposalId: string,
  draft: ChargeDraftInput,
): Promise<void> {
  await client.execute(
    "UPDATE whatsapp_charge_proposals SET cancelled_at = CURRENT_TIMESTAMP WHERE id = ?",
    proposalId,
  );
  await savePendingCharge(client, providerId, {
    mode: "edit",
    partial: {
      clientName: draft.client.name ?? null,
      clientWhatsapp: draft.client.whatsapp ?? null,
      description: draft.description,
      amountCents: draft.amountCents,
      dueDate: draft.dueDate,
    },
  });
}

export const dbChargeMemory: ChargeMemory = {
  async load(providerId: string): Promise<ChargeMemoryEntry | null> {
    const row = await queryOne<PendingRow>(
      `SELECT partial, mode FROM whatsapp_pending_charges
       WHERE provider_id = ? AND expires_at > CURRENT_TIMESTAMP`,
      providerId,
    );
    if (!row) return null;
    return {
      partial: persistedJson(row.partial) as ChargeMemoryEntry["partial"],
      mode: row.mode === "edit" ? "edit" : "fill",
    };
  },

  async save(providerId: string, entry: ChargeMemoryEntry): Promise<void> {
    await savePendingCharge(db, providerId, entry);
  },

  async clear(providerId: string): Promise<void> {
    await execute("DELETE FROM whatsapp_pending_charges WHERE provider_id = ?", providerId);
  },
};
