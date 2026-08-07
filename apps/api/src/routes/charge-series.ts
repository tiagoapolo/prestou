import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireProvider } from "../auth.js";
import {
  cancelChargeSeries,
  pauseChargeSeries,
  resumeChargeSeries,
  updateChargeSeries,
  type ChargeSeriesRow,
} from "../charge-series.js";
import { queryAll, queryOne, withTransaction } from "../db.js";
import { formatBRL } from "../messages.js";
import { monthlyOccurrenceCount } from "../recurrence.js";
import { derivedStatus, todayISO } from "../state.js";
import type { PaymentRow } from "../types.js";
import { amountCentsSchema, isoDateSchema, requiredText, validationMessage } from "../validation.js";

const idSchema = z.object({ id: z.string().uuid() });
const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const chargeSeriesUpdateSchema = z.object({
  description: requiredText("Serviço", 2, 120).optional(),
  amountCents: amountCentsSchema.optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  endDate: isoDateSchema.optional(),
}).refine((input) => Object.keys(input).length > 0, {
  message: "Informe ao menos uma alteração",
});

type SeriesWithClient = ChargeSeriesRow & {
  client_name: string;
  client_whatsapp: string;
  generated_count: number | string;
};

type SeriesPayment = PaymentRow & {
  charge_id: string;
  description: string;
  series_sequence: number;
};

function seriesOutput(row: SeriesWithClient) {
  return {
    id: row.id,
    status: row.status,
    description: row.description,
    amountCents: row.amount_cents,
    amountLabel: formatBRL(row.amount_cents),
    firstDueDate: row.first_due_date,
    dueDay: row.anchor_day,
    endDate: row.end_date,
    nextDueDate: row.next_due_date,
    occurrences: monthlyOccurrenceCount(row.first_due_date, row.end_date, row.anchor_day),
    generatedCount: Number(row.generated_count),
    client: {
      id: row.client_id,
      name: row.client_name,
      whatsapp: row.client_whatsapp,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadSeries(providerId: string, seriesId: string): Promise<SeriesWithClient | undefined> {
  return queryOne<SeriesWithClient>(
    `SELECT s.*, cl.name AS client_name, cl.whatsapp AS client_whatsapp,
            (SELECT COUNT(*) FROM charges c WHERE c.charge_series_id = s.id) AS generated_count
       FROM charge_series s
       JOIN clients cl ON cl.id = s.client_id
      WHERE s.id = ? AND s.provider_id = ?`,
    seriesId,
    providerId,
  );
}

function actionError(reply: FastifyReply, error: unknown) {
  const statusCode = typeof error === "object" && error && "statusCode" in error
    ? Number(error.statusCode)
    : 500;
  if (statusCode === 404 || statusCode === 409 || statusCode === 422) {
    return reply.code(statusCode).send({ error: (error as Error).message });
  }
  throw error;
}

export async function chargeSeriesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireProvider);

  app.get("/api/charge-series", async (req, reply) => {
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: validationMessage(parsed.error) });
    }
    const { page, pageSize } = parsed.data;
    const providerId = req.provider!.id;
    const totalRow = await queryOne<{ total: number | string }>(
      "SELECT COUNT(*) AS total FROM charge_series WHERE provider_id = ?",
      providerId,
    );
    const rows = await queryAll<SeriesWithClient>(
      `SELECT s.*, cl.name AS client_name, cl.whatsapp AS client_whatsapp,
              (SELECT COUNT(*) FROM charges c WHERE c.charge_series_id = s.id) AS generated_count
         FROM charge_series s
         JOIN clients cl ON cl.id = s.client_id
        WHERE s.provider_id = ?
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT ? OFFSET ?`,
      providerId,
      pageSize,
      (page - 1) * pageSize,
    );
    const total = Number(totalRow?.total ?? 0);
    return {
      items: rows.map(seriesOutput),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  });

  app.get<{ Params: { id: string } }>("/api/charge-series/:id", async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "Série mensal inválida" });
    const providerId = req.provider!.id;
    const series = await loadSeries(providerId, params.data.id);
    if (!series) return reply.code(404).send({ error: "Série mensal não encontrada" });

    const payments = await queryAll<SeriesPayment>(
      `SELECT p.*, c.id AS charge_id, c.description, c.series_sequence
         FROM charges c
         JOIN payments p ON p.charge_id = c.id
        WHERE c.charge_series_id = ? AND c.provider_id = ?
        ORDER BY c.series_sequence`,
      series.id,
      providerId,
    );
    const today = todayISO();
    return {
      series: seriesOutput(series),
      charges: payments.map((payment) => ({
        paymentId: payment.id,
        chargeId: payment.charge_id,
        description: payment.description,
        sequence: payment.series_sequence,
        amountCents: payment.amount_cents,
        amountLabel: formatBRL(payment.amount_cents),
        dueDate: payment.due_date,
        status: derivedStatus(payment, today),
      })),
    };
  });

  app.patch<{ Params: { id: string } }>("/api/charge-series/:id", async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    const body = chargeSeriesUpdateSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: body.success ? "Série mensal inválida" : validationMessage(body.error),
      });
    }
    try {
      await withTransaction((tx) =>
        updateChargeSeries(tx, req.provider!.id, params.data.id, body.data)
      );
      const updated = await loadSeries(req.provider!.id, params.data.id);
      return reply.send({ series: seriesOutput(updated!) });
    } catch (error) {
      return actionError(reply, error);
    }
  });

  for (const action of ["pause", "resume", "cancel"] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/charge-series/:id/${action}`,
      async (req, reply) => {
        const params = idSchema.safeParse(req.params);
        if (!params.success) return reply.code(400).send({ error: "Série mensal inválida" });
        try {
          await withTransaction((tx) => {
            if (action === "pause") {
              return pauseChargeSeries(tx, req.provider!.id, params.data.id);
            }
            if (action === "resume") {
              return resumeChargeSeries(tx, req.provider!.id, params.data.id);
            }
            return cancelChargeSeries(tx, req.provider!.id, params.data.id);
          });
          const updated = await loadSeries(req.provider!.id, params.data.id);
          return reply.send({ series: seriesOutput(updated!) });
        } catch (error) {
          return actionError(reply, error);
        }
      },
    );
  }
}
