import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireProvider } from "../auth.js";
import { queryAll, queryOne, withTransaction, type DatabaseClient } from "../db.js";
import { newId } from "../ids.js";
import { todayISO } from "../state.js";
import type { PaymentMethod, PaymentRow } from "../types.js";
import {
  amountCentsSchema,
  isoDateSchema,
  requiredText,
  validationMessage,
} from "../validation.js";

const monthSchema = z.string().regex(
  /^\d{4}-(0[1-9]|1[0-2])$/,
  "Mês deve estar no formato AAAA-MM",
);
const paymentMethodSchema = z.enum([
  "pix",
  "dinheiro",
  "cartao",
  "transferencia",
  "outro",
]);
const optionalNoteSchema = z.string().trim().max(500, "Observação deve ter no máximo 500 caracteres")
  .transform((value) => value || null).nullable().optional();
const monthQuerySchema = z.object({
  month: monthSchema.default(() => todayISO().slice(0, 7)),
});
const entryParamsSchema = z.object({ id: z.string().uuid() });
const receiptBodySchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  description: requiredText("Serviço", 2, 120),
  amountCents: amountCentsSchema,
  receivedDate: isoDateSchema,
  paymentMethod: paymentMethodSchema,
  note: optionalNoteSchema,
}).strict();
const paymentCorrectionSchema = z.object({
  amountCents: amountCentsSchema,
  receivedDate: isoDateSchema,
  paymentMethod: paymentMethodSchema,
  note: optionalNoteSchema,
}).strict();

interface FinancialEntryRow {
  source: "payment" | "manual_receipt";
  source_id: string;
  charge_id: string | null;
  description: string;
  amount_cents: number;
  received_date: string;
  payment_method: PaymentMethod;
  note: string | null;
  client_id: string | null;
  client_name: string | null;
}

interface ManualReceiptRow {
  id: string;
  provider_id: string;
  client_id: string | null;
  description: string;
  amount_cents: number;
  received_date: string;
  payment_method: PaymentMethod;
  note: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
  client_name?: string | null;
}

interface OwnedPayment extends PaymentRow {
  provider_id: string;
  description: string;
  client_id: string;
  client_name: string;
}

function monthRange(month: string): { from: string; to: string; previous: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year!, monthNumber! - 1, 1));
  const next = new Date(Date.UTC(year!, monthNumber!, 1));
  const previous = new Date(Date.UTC(year!, monthNumber! - 2, 1));
  return {
    from: start.toISOString().slice(0, 10),
    to: next.toISOString().slice(0, 10),
    previous: previous.toISOString().slice(0, 7),
  };
}

function publicEntry(row: FinancialEntryRow) {
  return {
    source: row.source,
    sourceId: row.source_id,
    chargeId: row.charge_id,
    description: row.description,
    amountCents: row.amount_cents,
    receivedDate: row.received_date,
    paymentMethod: row.payment_method,
    note: row.note,
    client: row.client_id && row.client_name
      ? { id: row.client_id, name: row.client_name }
      : null,
  };
}

async function loadEntries(providerId: string, month: string): Promise<FinancialEntryRow[]> {
  const range = monthRange(month);
  return queryAll<FinancialEntryRow>(`
    SELECT 'payment'::text AS source,
           p.id AS source_id,
           c.id AS charge_id,
           c.description,
           COALESCE(p.received_amount_cents, p.amount_cents) AS amount_cents,
           (p.paid_at AT TIME ZONE 'America/Sao_Paulo')::date AS received_date,
           COALESCE(p.payment_method, 'pix') AS payment_method,
           p.financial_note AS note,
           cl.id AS client_id,
           cl.name AS client_name
      FROM payments p
      JOIN charges c ON c.id = p.charge_id
      JOIN clients cl ON cl.id = c.client_id
     WHERE c.provider_id = ?
       AND p.status = 'paga'
       AND p.financial_voided_at IS NULL
       AND p.paid_at >= (?::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
       AND p.paid_at < (?::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
    UNION ALL
    SELECT 'manual_receipt'::text AS source,
           mr.id AS source_id,
           NULL::uuid AS charge_id,
           mr.description,
           mr.amount_cents,
           mr.received_date,
           mr.payment_method,
           mr.note,
           cl.id AS client_id,
           cl.name AS client_name
      FROM manual_receipts mr
      LEFT JOIN clients cl ON cl.id = mr.client_id
     WHERE mr.provider_id = ?
       AND mr.voided_at IS NULL
       AND mr.received_date >= ?
       AND mr.received_date < ?
     ORDER BY received_date DESC, source_id DESC
  `, providerId, range.from, range.to, providerId, range.from, range.to);
}

async function receivedTotal(providerId: string, month: string): Promise<number> {
  const entries = await loadEntries(providerId, month);
  return entries.reduce((total, entry) => total + entry.amount_cents, 0);
}

async function availableMonths(providerId: string, selectedMonth: string): Promise<string[]> {
  const rows = await queryAll<{ month: string }>(`
    SELECT month
      FROM (
        SELECT to_char(p.paid_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month
          FROM payments p
          JOIN charges c ON c.id = p.charge_id
         WHERE c.provider_id = ?
           AND p.status = 'paga'
           AND p.financial_voided_at IS NULL
           AND p.paid_at IS NOT NULL
        UNION
        SELECT to_char(mr.received_date, 'YYYY-MM') AS month
          FROM manual_receipts mr
         WHERE mr.provider_id = ? AND mr.voided_at IS NULL
      ) months
     ORDER BY month DESC
  `, providerId, providerId);
  return [...new Set([selectedMonth, ...rows.map((row) => row.month)])].sort().reverse();
}

async function loadOwnedClient(
  client: Pick<DatabaseClient, "queryOne">,
  providerId: string,
  clientId: string | null | undefined,
) {
  if (!clientId) return undefined;
  return client.queryOne<{ id: string; name: string }>(
    "SELECT id, name FROM clients WHERE id = ? AND provider_id = ?",
    clientId,
    providerId,
  );
}

async function loadOwnedPayment(
  client: Pick<DatabaseClient, "queryOne">,
  providerId: string,
  paymentId: string,
): Promise<OwnedPayment | undefined> {
  return client.queryOne<OwnedPayment>(`
    SELECT p.*, c.provider_id, c.description, c.client_id, cl.name AS client_name
      FROM payments p
      JOIN charges c ON c.id = p.charge_id
      JOIN clients cl ON cl.id = c.client_id
     WHERE p.id = ? AND c.provider_id = ?
  `, paymentId, providerId);
}

async function recordEvent(
  tx: DatabaseClient,
  input: {
    providerId: string;
    sourceType: "payment" | "manual_receipt";
    sourceId: string;
    action: "created" | "updated" | "voided" | "payment_voided";
    before?: unknown;
    after?: unknown;
  },
) {
  await tx.execute(`
    INSERT INTO financial_entry_events
      (id, provider_id, source_type, source_id, action, before_data, after_data)
    VALUES (?, ?, ?, ?, ?, ?::text::jsonb, ?::text::jsonb)
  `,
    newId(),
    input.providerId,
    input.sourceType,
    input.sourceId,
    input.action,
    input.before === undefined ? null : JSON.stringify(input.before),
    input.after === undefined ? null : JSON.stringify(input.after),
  );
}

function paymentSnapshot(payment: OwnedPayment) {
  return {
    id: payment.id,
    chargeId: payment.charge_id,
    status: payment.status,
    amountCents: payment.amount_cents,
    receivedAmountCents: payment.received_amount_cents,
    paidAt: payment.paid_at,
    paidVia: payment.paid_via,
    paymentMethod: payment.payment_method,
    note: payment.financial_note,
    financialVoidedAt: payment.financial_voided_at,
  };
}

function manualEntry(row: ManualReceiptRow): FinancialEntryRow {
  return {
    source: "manual_receipt",
    source_id: row.id,
    charge_id: null,
    description: row.description,
    amount_cents: row.amount_cents,
    received_date: row.received_date,
    payment_method: row.payment_method,
    note: row.note,
    client_id: row.client_id,
    client_name: row.client_name ?? null,
  };
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csv(entries: FinancialEntryRow[]): string {
  const header = [
    "Data do recebimento",
    "Cliente",
    "Serviço",
    "Valor",
    "Forma de pagamento",
    "Origem",
    "Situação",
    "Observação",
  ];
  const methodLabels: Record<PaymentMethod, string> = {
    pix: "Pix",
    dinheiro: "Dinheiro",
    cartao: "Cartão",
    transferencia: "Transferência",
    outro: "Outro",
  };
  const lines = entries.map((entry) => [
    entry.received_date,
    entry.client_name ?? "",
    entry.description,
    (entry.amount_cents / 100).toFixed(2).replace(".", ","),
    methodLabels[entry.payment_method],
    entry.source === "payment" ? "Cobrança Prestou" : "Receita avulsa",
    "Recebido",
    entry.note ?? "",
  ].map(csvCell).join(";"));
  return `\uFEFF${[header.map(csvCell).join(";"), ...lines].join("\r\n")}\r\n`;
}

export async function financialRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireProvider);

  app.get("/api/financial", async (req, reply) => {
    const parsed = monthQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: validationMessage(parsed.error),
        issues: parsed.error.issues,
      });
    }

    const providerId = req.provider!.id;
    const month = parsed.data.month;
    const range = monthRange(month);
    const [entries, previousMonthReceivedCents, months, openTotals] = await Promise.all([
      loadEntries(providerId, month),
      receivedTotal(providerId, range.previous),
      availableMonths(providerId, month),
      queryOne<{
        pending_cents: number | string;
        overdue_cents: number | string;
      }>(`
        SELECT
          COALESCE(SUM(CASE WHEN p.status <> 'paga' THEN p.amount_cents ELSE 0 END), 0) AS pending_cents,
          COALESCE(SUM(CASE WHEN p.status = 'em_aberto' AND p.due_date < ? THEN p.amount_cents ELSE 0 END), 0) AS overdue_cents
          FROM payments p
          JOIN charges c ON c.id = p.charge_id
         WHERE c.provider_id = ?
      `, todayISO(), providerId),
    ]);

    return {
      month,
      availableMonths: months,
      items: entries.map(publicEntry),
      summary: {
        receivedCents: entries.reduce((total, entry) => total + entry.amount_cents, 0),
        previousMonthReceivedCents,
        pendingCents: Number(openTotals?.pending_cents ?? 0),
        overdueCents: Number(openTotals?.overdue_cents ?? 0),
      },
    };
  });

  app.get("/api/financial/export.csv", async (req, reply) => {
    const parsed = monthQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: validationMessage(parsed.error) });
    }
    const entries = await loadEntries(req.provider!.id, parsed.data.month);
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="prestou-financeiro-${parsed.data.month}.csv"`,
      )
      .send(csv(entries));
  });

  app.post("/api/financial/manual-receipts", async (req, reply) => {
    const parsed = receiptBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: validationMessage(parsed.error),
        issues: parsed.error.issues,
      });
    }
    const providerId = req.provider!.id;
    const input = parsed.data;
    const client = await loadOwnedClient({ queryOne }, providerId, input.clientId);
    if (input.clientId && !client) {
      return reply.code(400).send({ error: "Cliente não encontrado" });
    }

    const receipt = await withTransaction(async (tx) => {
      const id = newId();
      await tx.execute(`
        INSERT INTO manual_receipts
          (id, provider_id, client_id, description, amount_cents, received_date, payment_method, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        id,
        providerId,
        input.clientId ?? null,
        input.description,
        input.amountCents,
        input.receivedDate,
        input.paymentMethod,
        input.note ?? null,
      );
      const created = (await tx.queryOne<ManualReceiptRow>(
        "SELECT * FROM manual_receipts WHERE id = ?",
        id,
      ))!;
      await recordEvent(tx, {
        providerId,
        sourceType: "manual_receipt",
        sourceId: id,
        action: "created",
        after: created,
      });
      return { ...created, client_name: client?.name ?? null };
    });

    return reply.code(201).send({ entry: publicEntry(manualEntry(receipt)) });
  });

  app.patch<{ Params: { id: string } }>(
    "/api/financial/manual-receipts/:id",
    async (req, reply) => {
      const params = entryParamsSchema.safeParse(req.params);
      const parsed = receiptBodySchema.safeParse(req.body);
      if (!params.success) {
        return reply.code(400).send({ error: validationMessage(params.error) });
      }
      if (!parsed.success) {
        return reply.code(400).send({ error: validationMessage(parsed.error) });
      }
      const providerId = req.provider!.id;
      const current = await queryOne<ManualReceiptRow>(
        "SELECT * FROM manual_receipts WHERE id = ? AND provider_id = ? AND voided_at IS NULL",
        params.data.id,
        providerId,
      );
      if (!current) return reply.code(404).send({ error: "Receita não encontrada" });
      const input = parsed.data;
      const client = await loadOwnedClient({ queryOne }, providerId, input.clientId);
      if (input.clientId && !client) {
        return reply.code(400).send({ error: "Cliente não encontrado" });
      }

      const updated = await withTransaction(async (tx) => {
        const result = await tx.execute(`
          UPDATE manual_receipts
             SET client_id = ?, description = ?, amount_cents = ?, received_date = ?,
                 payment_method = ?, note = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND provider_id = ? AND voided_at IS NULL
        `,
          input.clientId ?? null,
          input.description,
          input.amountCents,
          input.receivedDate,
          input.paymentMethod,
          input.note ?? null,
          current.id,
          providerId,
        );
        if (result.changes !== 1) {
          throw Object.assign(new Error("Receita atualizada em outra sessão"), { statusCode: 409 });
        }
        const next = (await tx.queryOne<ManualReceiptRow>(
          "SELECT * FROM manual_receipts WHERE id = ?",
          current.id,
        ))!;
        await recordEvent(tx, {
          providerId,
          sourceType: "manual_receipt",
          sourceId: current.id,
          action: "updated",
          before: current,
          after: next,
        });
        return { ...next, client_name: client?.name ?? null };
      });
      return { entry: publicEntry(manualEntry(updated)) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/financial/manual-receipts/:id",
    async (req, reply) => {
      const params = entryParamsSchema.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: "Identificador inválido" });
      const providerId = req.provider!.id;
      const current = await queryOne<ManualReceiptRow>(
        "SELECT * FROM manual_receipts WHERE id = ? AND provider_id = ? AND voided_at IS NULL",
        params.data.id,
        providerId,
      );
      if (!current) return reply.code(404).send({ error: "Receita não encontrada" });

      await withTransaction(async (tx) => {
        const result = await tx.execute(`
          UPDATE manual_receipts
             SET voided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND provider_id = ? AND voided_at IS NULL
        `, current.id, providerId);
        if (result.changes !== 1) {
          throw Object.assign(new Error("Receita atualizada em outra sessão"), { statusCode: 409 });
        }
        await recordEvent(tx, {
          providerId,
          sourceType: "manual_receipt",
          sourceId: current.id,
          action: "voided",
          before: current,
        });
      });
      return reply.code(204).send();
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/financial/payments/:id",
    async (req, reply) => {
      const params = entryParamsSchema.safeParse(req.params);
      const parsed = paymentCorrectionSchema.safeParse(req.body);
      if (!params.success) {
        return reply.code(400).send({ error: validationMessage(params.error) });
      }
      if (!parsed.success) {
        return reply.code(400).send({ error: validationMessage(parsed.error) });
      }
      const providerId = req.provider!.id;
      const current = await loadOwnedPayment({ queryOne }, providerId, params.data.id);
      if (!current) return reply.code(404).send({ error: "Pagamento não encontrado" });
      if (current.status !== "paga" || current.financial_voided_at) {
        return reply.code(409).send({ error: "Somente pagamentos recebidos podem ser corrigidos" });
      }
      const input = parsed.data;

      const updated = await withTransaction(async (tx) => {
        const result = await tx.execute(`
          UPDATE payments
             SET received_amount_cents = ?, payment_method = ?, financial_note = ?,
                 paid_at = (?::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
           WHERE id = ? AND status = 'paga' AND financial_voided_at IS NULL
        `,
          input.amountCents,
          input.paymentMethod,
          input.note ?? null,
          input.receivedDate,
          current.id,
        );
        if (result.changes !== 1) {
          throw Object.assign(new Error("Pagamento atualizado em outra sessão"), { statusCode: 409 });
        }
        const next = (await loadOwnedPayment(tx, providerId, current.id))!;
        await recordEvent(tx, {
          providerId,
          sourceType: "payment",
          sourceId: current.id,
          action: "updated",
          before: paymentSnapshot(current),
          after: paymentSnapshot(next),
        });
        return next;
      });
      return {
        entry: publicEntry({
          source: "payment",
          source_id: updated.id,
          charge_id: updated.charge_id,
          description: updated.description,
          amount_cents: updated.received_amount_cents ?? updated.amount_cents,
          received_date: input.receivedDate,
          payment_method: updated.payment_method ?? "pix",
          note: updated.financial_note,
          client_id: updated.client_id,
          client_name: updated.client_name,
        }),
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/financial/payments/:id",
    async (req, reply) => {
      const params = entryParamsSchema.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: "Identificador inválido" });
      const providerId = req.provider!.id;
      const current = await loadOwnedPayment({ queryOne }, providerId, params.data.id);
      if (!current) return reply.code(404).send({ error: "Pagamento não encontrado" });
      if (current.status !== "paga" || current.financial_voided_at) {
        return reply.code(409).send({ error: "Este recebimento não está disponível no Financeiro" });
      }

      await withTransaction(async (tx) => {
        const result = await tx.execute(`
          UPDATE payments
             SET financial_voided_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'paga' AND financial_voided_at IS NULL
        `, current.id);
        if (result.changes !== 1) {
          throw Object.assign(new Error("Pagamento atualizado em outra sessão"), { statusCode: 409 });
        }
        const next = (await loadOwnedPayment(tx, providerId, current.id))!;
        await recordEvent(tx, {
          providerId,
          sourceType: "payment",
          sourceId: current.id,
          action: "payment_voided",
          before: paymentSnapshot(current),
          after: paymentSnapshot(next),
        });
      });
      return reply.code(204).send();
    },
  );
}
