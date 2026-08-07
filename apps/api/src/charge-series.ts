import { track } from "./analytics.js";
import {
  createCharge,
  type ChargeDraftInput,
  type ChargeSource,
  type CreatedCharge,
} from "./charge-creation.js";
import { queryAll, withTransaction, type DatabaseClient } from "./db.js";
import { newId } from "./ids.js";
import { formatBRL } from "./messages.js";
import { notifyProvider } from "./notify.js";
import {
  addDaysISO,
  firstMonthlyDueDateAfter,
  MAX_MONTHLY_OCCURRENCES,
  MIN_MONTHLY_OCCURRENCES,
  monthlyDueDate,
  monthlyDueDateForAnchor,
  monthlyOccurrenceCount,
  monthlySequence,
} from "./recurrence.js";
import { todayISO } from "./state.js";
import type { ProviderRow } from "./types.js";

export type MonthlyChargeDraftInput = ChargeDraftInput & {
  recurrence: {
    frequency: "monthly";
    endDate: string;
  };
};

export interface ChargeSeriesRow {
  id: string;
  provider_id: string;
  client_id: string;
  description: string;
  amount_cents: number;
  first_due_date: string;
  anchor_day: number;
  end_date: string;
  next_due_date: string | null;
  status: "ativa" | "pausada" | "cancelada" | "concluida";
  paused_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type GeneratedSeriesOccurrence = CreatedCharge & { provider: ProviderRow };

function chargeSeriesError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

async function lockedProviderSeries(
  tx: DatabaseClient,
  providerId: string,
  seriesId: string,
): Promise<ChargeSeriesRow> {
  const series = await tx.queryOne<ChargeSeriesRow>(
    `SELECT * FROM charge_series
      WHERE id = ? AND provider_id = ?
      FOR UPDATE`,
    seriesId,
    providerId,
  );
  if (!series) throw chargeSeriesError("Série mensal não encontrada", 404);
  return series;
}

export async function createMonthlyChargeSeries(
  tx: DatabaseClient,
  provider: ProviderRow,
  input: MonthlyChargeDraftInput,
  source: ChargeSource,
  fillMs?: number,
): Promise<CreatedCharge> {
  const created = await createCharge(tx, provider, input, source, fillMs);
  const seriesId = newId();
  const now = new Date().toISOString();
  const occurrences = monthlyOccurrenceCount(input.dueDate, input.recurrence.endDate);
  const nextDueDate = monthlyDueDate(input.dueDate, 1);

  await tx.execute(`
    INSERT INTO charge_series (
      id, provider_id, client_id, description, amount_cents, first_due_date,
      anchor_day, end_date, next_due_date, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativa', ?, ?)
  `,
    seriesId,
    provider.id,
    created.charge.client.id,
    input.description,
    input.amountCents,
    input.dueDate,
    Number(input.dueDate.slice(8, 10)),
    input.recurrence.endDate,
    nextDueDate,
    now,
    now,
  );

  await tx.execute(
    `UPDATE charges
        SET charge_series_id = ?, series_sequence = 1
      WHERE id = ? AND provider_id = ?`,
    seriesId,
    created.charge.id,
    provider.id,
  );

  await track({
    type: "serie_mensal_criada",
    providerId: provider.id,
    chargeId: created.charge.id,
    paymentId: created.payment.id,
    metadata: {
      seriesId,
      endDate: input.recurrence.endDate,
      occurrences,
      source,
    },
  }, tx);

  return {
    ...created,
    recurrence: {
      seriesId,
      frequency: "monthly",
      endDate: input.recurrence.endDate,
      sequence: 1,
      occurrences,
    },
  };
}

export async function generateSeriesOccurrences(
  tx: DatabaseClient,
  seriesId: string,
  horizonDate: string,
): Promise<GeneratedSeriesOccurrence[]> {
  const series = await tx.queryOne<ChargeSeriesRow>(
    `SELECT * FROM charge_series
      WHERE id = ? AND status = 'ativa' AND next_due_date <= ?
      FOR UPDATE`,
    seriesId,
    horizonDate,
  );
  if (!series?.next_due_date) return [];

  const provider = await tx.queryOne<ProviderRow>(
    "SELECT * FROM providers WHERE id = ?",
    series.provider_id,
  );
  if (!provider) throw new Error("Prestador da série mensal não encontrado");

  const occurrences = monthlyOccurrenceCount(
    series.first_due_date,
    series.end_date,
    series.anchor_day,
  );
  const generated: GeneratedSeriesOccurrence[] = [];
  let dueDate: string | null = series.next_due_date;

  while (dueDate && dueDate <= horizonDate && dueDate <= series.end_date) {
    const sequence = monthlySequence(series.first_due_date, dueDate);
    const created = await createCharge(tx, provider, {
      client: { id: series.client_id },
      description: series.description,
      amountCents: series.amount_cents,
      dueDate,
      saveClient: true,
    }, "recurrence");

    await tx.execute(
      `UPDATE charges
          SET charge_series_id = ?, series_sequence = ?
        WHERE id = ? AND provider_id = ?`,
      series.id,
      sequence,
      created.charge.id,
      provider.id,
    );
    await track({
      type: "cobranca_recorrente_gerada",
      providerId: provider.id,
      chargeId: created.charge.id,
      paymentId: created.payment.id,
      metadata: { seriesId: series.id, sequence },
    }, tx);

    generated.push({
      ...created,
      provider,
      recurrence: {
        seriesId: series.id,
        frequency: "monthly",
        endDate: series.end_date,
        sequence,
        occurrences,
      },
    });

    const candidate = monthlyDueDateForAnchor(
      series.first_due_date,
      series.anchor_day,
      sequence,
    );
    dueDate = candidate <= series.end_date ? candidate : null;
  }

  const status = dueDate ? "ativa" : "concluida";
  const now = new Date().toISOString();
  await tx.execute(
    `UPDATE charge_series
        SET next_due_date = ?, status = ?, completed_at = ?, updated_at = ?
      WHERE id = ?`,
    dueDate,
    status,
    status === "concluida" ? now : null,
    now,
    series.id,
  );

  if (status === "concluida") {
    await track({
      type: "serie_mensal_concluida",
      providerId: provider.id,
      metadata: { seriesId: series.id },
    }, tx);
  }

  return generated;
}

export async function runRecurringCharges(today = todayISO()): Promise<{
  checked: number;
  generated: number;
  failed: number;
}> {
  const horizonDate = addDaysISO(today, 7);
  const dueSeries = await queryAll<{ id: string; provider_id: string }>(
    `SELECT id, provider_id FROM charge_series
      WHERE status = 'ativa' AND next_due_date <= ?
      ORDER BY next_due_date, id
      LIMIT 100`,
    horizonDate,
  );

  let generatedCount = 0;
  let failed = 0;

  for (const { id, provider_id: providerId } of dueSeries) {
    try {
      const occurrences = await withTransaction((tx) =>
        generateSeriesOccurrences(tx, id, horizonDate)
      );
      generatedCount += occurrences.length;

      for (const occurrence of occurrences) {
        await notifyProvider({
          provider: occurrence.provider,
          paymentId: occurrence.payment.id,
          kind: "reminder",
          body:
            `A mensalidade de ${formatBRL(occurrence.charge.amountCents)} de ` +
            `${occurrence.charge.client.name} (${occurrence.charge.description}) ` +
            "está pronta. Toque para enviar a cobrança.",
          waDeeplink: occurrence.whatsapp.deeplink,
          template: "lembrete_cobranca_prestador",
          templateParams: [
            occurrence.charge.client.name,
            formatBRL(occurrence.charge.amountCents),
            `vence em ${occurrence.charge.dueDate}`,
          ],
          templateUrlButtonParam: occurrence.payment.id,
        });
      }
    } catch (error) {
      failed++;
      console.error(`[recurrence] série ${id} falhou`, error);
      try {
        await track({
          type: "cobranca_recorrente_falhou",
          providerId,
          metadata: { seriesId: id },
        });
      } catch (trackingError) {
        console.error(`[recurrence] não foi possível registrar a falha da série ${id}`, trackingError);
      }
    }
  }

  return { checked: dueSeries.length, generated: generatedCount, failed };
}

export async function pauseChargeSeries(
  tx: DatabaseClient,
  providerId: string,
  seriesId: string,
): Promise<ChargeSeriesRow> {
  const series = await lockedProviderSeries(tx, providerId, seriesId);
  if (series.status === "pausada") return series;
  if (series.status !== "ativa") {
    throw chargeSeriesError("Somente uma série ativa pode ser pausada", 409);
  }

  const now = new Date().toISOString();
  await tx.execute(
    `UPDATE charge_series
        SET status = 'pausada', paused_at = ?, updated_at = ?
      WHERE id = ? AND provider_id = ?`,
    now,
    now,
    seriesId,
    providerId,
  );
  await track({
    type: "serie_mensal_pausada",
    providerId,
    metadata: { seriesId, before: { status: series.status }, after: { status: "pausada" } },
  }, tx);
  return { ...series, status: "pausada", paused_at: now, updated_at: now };
}

export async function resumeChargeSeries(
  tx: DatabaseClient,
  providerId: string,
  seriesId: string,
  today = todayISO(),
): Promise<ChargeSeriesRow> {
  const series = await lockedProviderSeries(tx, providerId, seriesId);
  if (series.status === "ativa") return series;
  if (series.status !== "pausada") {
    throw chargeSeriesError("Somente uma série pausada pode ser retomada", 409);
  }

  const nextDueDate = firstMonthlyDueDateAfter(
    series.first_due_date,
    series.anchor_day,
    today,
    series.end_date,
  );
  const status = nextDueDate ? "ativa" : "concluida";
  const now = new Date().toISOString();
  await tx.execute(
    `UPDATE charge_series
        SET status = ?, next_due_date = ?, paused_at = NULL,
            completed_at = ?, updated_at = ?
      WHERE id = ? AND provider_id = ?`,
    status,
    nextDueDate,
    status === "concluida" ? now : null,
    now,
    seriesId,
    providerId,
  );
  await track({
    type: status === "ativa" ? "serie_mensal_retomada" : "serie_mensal_concluida",
    providerId,
    metadata: { seriesId, before: { status: series.status }, after: { status } },
  }, tx);
  return {
    ...series,
    status,
    next_due_date: nextDueDate,
    paused_at: null,
    completed_at: status === "concluida" ? now : null,
    updated_at: now,
  };
}

export interface UpdateChargeSeriesInput {
  description?: string;
  amountCents?: number;
  dueDay?: number;
  endDate?: string;
}

export async function updateChargeSeries(
  tx: DatabaseClient,
  providerId: string,
  seriesId: string,
  input: UpdateChargeSeriesInput,
  today = todayISO(),
): Promise<ChargeSeriesRow> {
  const series = await lockedProviderSeries(tx, providerId, seriesId);
  if (series.status === "cancelada") {
    throw chargeSeriesError("Uma série cancelada não pode ser editada", 409);
  }

  const lastGenerated = await tx.queryOne<{
    sequence: number | string | null;
    due_date: string | null;
  }>(
    `SELECT MAX(series_sequence) AS sequence, MAX(due_date) AS due_date
       FROM charges
      WHERE charge_series_id = ? AND provider_id = ?`,
    seriesId,
    providerId,
  );
  const lastSequence = Number(lastGenerated?.sequence ?? 1);
  const anchorDay = input.dueDay ?? series.anchor_day;
  const endDate = input.endDate ?? series.end_date;
  const occurrences = monthlyOccurrenceCount(series.first_due_date, endDate, anchorDay);

  if (lastGenerated?.due_date && endDate < lastGenerated.due_date) {
    throw chargeSeriesError("A data final não pode excluir uma cobrança já gerada", 409);
  }
  if (occurrences < MIN_MONTHLY_OCCURRENCES || occurrences < lastSequence) {
    throw chargeSeriesError("A série mensal deve ter pelo menos 2 cobranças", 422);
  }
  if (occurrences > MAX_MONTHLY_OCCURRENCES) {
    throw chargeSeriesError("A série mensal deve ter no máximo 24 cobranças", 422);
  }

  let nextSequence = series.next_due_date
    ? monthlySequence(series.first_due_date, series.next_due_date)
    : lastSequence + 1;
  let nextDueDate = monthlyDueDateForAnchor(
    series.first_due_date,
    anchorDay,
    nextSequence - 1,
  );
  while (nextDueDate <= today && nextSequence < MAX_MONTHLY_OCCURRENCES) {
    nextSequence++;
    nextDueDate = monthlyDueDateForAnchor(
      series.first_due_date,
      anchorDay,
      nextSequence - 1,
    );
  }
  const hasFutureOccurrence = nextDueDate > today && nextDueDate <= endDate;
  const status = hasFutureOccurrence
    ? series.status === "pausada" ? "pausada" : "ativa"
    : "concluida";
  const now = new Date().toISOString();

  await tx.execute(
    `UPDATE charge_series
        SET description = ?, amount_cents = ?, anchor_day = ?, end_date = ?,
            next_due_date = ?, status = ?, paused_at = ?, completed_at = ?,
            updated_at = ?
      WHERE id = ? AND provider_id = ?`,
    input.description ?? series.description,
    input.amountCents ?? series.amount_cents,
    anchorDay,
    endDate,
    hasFutureOccurrence ? nextDueDate : null,
    status,
    status === "pausada" ? series.paused_at : null,
    status === "concluida" ? now : null,
    now,
    seriesId,
    providerId,
  );
  await track({
    type: "serie_mensal_editada",
    providerId,
    metadata: {
      seriesId,
      before: {
        amountCents: series.amount_cents,
        dueDay: series.anchor_day,
        endDate: series.end_date,
        status: series.status,
      },
      after: {
        amountCents: input.amountCents ?? series.amount_cents,
        dueDay: anchorDay,
        endDate,
        status,
      },
    },
  }, tx);

  return {
    ...series,
    description: input.description ?? series.description,
    amount_cents: input.amountCents ?? series.amount_cents,
    anchor_day: anchorDay,
    end_date: endDate,
    next_due_date: hasFutureOccurrence ? nextDueDate : null,
    status,
    paused_at: status === "pausada" ? series.paused_at : null,
    completed_at: status === "concluida" ? now : null,
    updated_at: now,
  };
}

export async function cancelChargeSeries(
  tx: DatabaseClient,
  providerId: string,
  seriesId: string,
): Promise<ChargeSeriesRow> {
  const series = await lockedProviderSeries(tx, providerId, seriesId);
  if (series.status === "cancelada") return series;
  if (series.status === "concluida") {
    throw chargeSeriesError("Uma série concluída não pode ser cancelada", 409);
  }

  const now = new Date().toISOString();
  await tx.execute(
    `UPDATE charge_series
        SET status = 'cancelada', next_due_date = NULL, cancelled_at = ?,
            paused_at = NULL, updated_at = ?
      WHERE id = ? AND provider_id = ?`,
    now,
    now,
    seriesId,
    providerId,
  );
  await track({
    type: "serie_mensal_cancelada",
    providerId,
    metadata: { seriesId, before: { status: series.status }, after: { status: "cancelada" } },
  }, tx);
  return {
    ...series,
    status: "cancelada",
    next_due_date: null,
    cancelled_at: now,
    paused_at: null,
    updated_at: now,
  };
}
