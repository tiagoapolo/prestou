import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { queryAll, queryOne, withTransaction } from "../db.js";
import { requireProvider } from "../auth.js";
import { chargeDraftSchema, createCharge } from "../charge-creation.js";
import { chargeMessage, paymentUrl, waMeLink, formatBRL } from "../messages.js";
import { derivedStatus, todayISO } from "../state.js";
import type { ChargeRow, ClientRow, PaymentRow } from "../types.js";
import { isoDateSchema, validationMessage } from "../validation.js";

const createChargeSchema = chargeDraftSchema.extend({
  /** Duração do preenchimento no cliente, para medir a meta de 60s (F2). */
  fillMs: z.number().int().nonnegative().optional(),
  source: z.enum(["form", "assistant"]).default("form"),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const chargeListQuerySchema = paginationSchema.extend({
  clientId: z.string().uuid().optional(),
  /** Busca por nome de cliente (server-side, ADR-009). */
  q: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["em_aberto", "cliente_confirmou", "paga", "atrasada"]).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
}).refine(({ from, to }) => !from || !to || from <= to, {
  message: "O início do período deve ser anterior ao fim",
  path: ["from"],
});

const financialSummaryQuerySchema = paginationSchema.extend({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês deve estar no formato AAAA-MM")
    .default(() => todayISO().slice(0, 7)),
});

type ChargeListRow = PaymentRow & {
  description: string;
  client_id: string;
  client_name: string;
  client_whatsapp: string;
  charge_id: string;
};

function pagination(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

function monthRange(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year!, monthNumber!, 1));
  return { from: `${month}-01`, to: next.toISOString().slice(0, 10) };
}

export async function chargeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireProvider);

  /** Clientes já cadastrados (para reaproveitar no cadastro de cobrança). */
  app.get("/api/clients", async (req) => {
    const rows = await queryAll<ClientRow>(
      "SELECT * FROM clients WHERE provider_id = ? ORDER BY name",
      req.provider!.id,
    );
    return {
      clients: rows.map((c) => ({
        id: c.id,
        name: c.name,
        whatsapp: c.whatsapp,
      })),
    };
  });

  /** F2 + F3 — cria a cobrança, a parcela única e congela o BR Code. */
  app.post("/api/charges", async (req, reply) => {
    const parsed = createChargeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: validationMessage(parsed.error), issues: parsed.error.issues });
    }
    const body = parsed.data;
    const provider = req.provider!;

    let created;
    try {
      created = await withTransaction((tx) =>
        createCharge(tx, provider, body, body.source, body.fillMs)
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      if (status === 400 || status === 422) {
        return reply.code(status).send({ error: (err as Error).message });
      }
      throw err;
    }
    return reply.code(201).send(created);
  });

  /** F9 — painel "quem me deve". */
  app.get("/api/charges", async (req, reply) => {
    const parsed = chargeListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: validationMessage(parsed.error),
        issues: parsed.error.issues,
      });
    }

    const provider = req.provider!;
    const { page, pageSize, clientId, q, status, from, to } = parsed.data;
    const today = todayISO();
    const conditions = ["c.provider_id = ?"];
    const params: Array<string | number> = [provider.id];

    if (clientId) {
      conditions.push("c.client_id = ?");
      params.push(clientId);
    }
    if (q) {
      conditions.push("cl.name ILIKE ?");
      params.push(`%${q}%`);
    }
    if (status === "atrasada") {
      conditions.push("p.status = 'em_aberto'", "p.due_date < ?");
      params.push(today);
    } else if (status === "em_aberto") {
      conditions.push("p.status = 'em_aberto'", "p.due_date >= ?");
      params.push(today);
    } else if (status) {
      conditions.push("p.status = ?");
      params.push(status);
    }
    if (from) {
      conditions.push("p.due_date >= ?");
      params.push(from);
    }
    if (to) {
      conditions.push("p.due_date <= ?");
      params.push(to);
    }

    const where = conditions.join(" AND ");
    const totalRow = await queryOne<{ total: number | string }>(
      `SELECT COUNT(*) AS total
         FROM payments p
         JOIN charges c ON c.id = p.charge_id
         JOIN clients cl ON cl.id = c.client_id
        WHERE ${where}`,
      ...params,
    );
    const total = Number(totalRow?.total ?? 0);
    const rows = await queryAll<ChargeListRow>(
      `SELECT p.*, c.description, c.client_id, cl.name AS client_name,
              cl.whatsapp AS client_whatsapp, c.id AS charge_id
         FROM payments p
         JOIN charges c ON c.id = p.charge_id
         JOIN clients cl ON cl.id = c.client_id
        WHERE ${where}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );

    const items = rows.map((r) => {
      const status = derivedStatus(r, today);
      const message = chargeMessage({
        clientName: r.client_name,
        providerName: provider.name,
        description: r.description,
        amountCents: r.amount_cents,
        publicToken: r.public_token,
      });
      return {
        paymentId: r.id,
        chargeId: r.charge_id,
        description: r.description,
        amountCents: r.amount_cents,
        amountLabel: formatBRL(r.amount_cents),
        dueDate: r.due_date,
        status,
        client: { id: r.client_id, name: r.client_name, whatsapp: r.client_whatsapp },
        paymentUrl: paymentUrl(r.public_token),
        hasComprovante: Boolean(r.comprovante_path),
        clientConfirmedAt: r.client_confirmed_at,
        paidAt: r.paid_at,
        paidVia: r.paid_via,
        whatsappDeeplink: waMeLink(r.client_whatsapp, message),
      };
    });

    const currentMonth = monthRange(today.slice(0, 7));
    const totals = await queryOne<{
      a_receber_cents: number | string;
      recebido_mes_cents: number | string;
      atrasadas_count: number | string;
      aguardando_validacao_count: number | string;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN p.status <> 'paga' THEN p.amount_cents ELSE 0 END), 0) AS a_receber_cents,
         COALESCE(SUM(CASE
           WHEN p.status = 'paga'
            AND p.financial_voided_at IS NULL
            AND p.paid_at >= (?::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
            AND p.paid_at < (?::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
           THEN COALESCE(p.received_amount_cents, p.amount_cents)
           ELSE 0
         END), 0)
         + COALESCE((
           SELECT SUM(mr.amount_cents)
             FROM manual_receipts mr
            WHERE mr.provider_id = ?
              AND mr.voided_at IS NULL
              AND mr.received_date >= ?
              AND mr.received_date < ?
         ), 0) AS recebido_mes_cents,
         COUNT(*) FILTER (WHERE p.status = 'em_aberto' AND p.due_date < ?) AS atrasadas_count,
         COUNT(*) FILTER (WHERE p.status = 'cliente_confirmou') AS aguardando_validacao_count
       FROM payments p
       JOIN charges c ON c.id = p.charge_id
      WHERE c.provider_id = ?`,
      currentMonth.from,
      currentMonth.to,
      provider.id,
      currentMonth.from,
      currentMonth.to,
      today,
      provider.id,
    );

    return {
      items,
      pagination: pagination(page, pageSize, total),
      totals: {
        aReceberCents: Number(totals?.a_receber_cents ?? 0),
        recebidoMesCents: Number(totals?.recebido_mes_cents ?? 0),
        atrasadasCount: Number(totals?.atrasadas_count ?? 0),
        aguardandoValidacaoCount: Number(totals?.aguardando_validacao_count ?? 0),
      },
    };
  });

  /** Resumo financeiro das cobranças com vencimento em um mês. */
  app.get("/api/financial-summary", async (req, reply) => {
    const parsed = financialSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: validationMessage(parsed.error),
        issues: parsed.error.issues,
      });
    }

    const { month, page, pageSize } = parsed.data;
    const range = monthRange(month);
    const provider = req.provider!;
    const params = [provider.id, range.from, range.to];
    const totalRow = await queryOne<{ total: number | string }>(
      `SELECT COUNT(*) AS total
         FROM payments p
         JOIN charges c ON c.id = p.charge_id
        WHERE c.provider_id = ?
          AND p.financial_voided_at IS NULL
          AND p.due_date >= ? AND p.due_date < ?`,
      ...params,
    );
    const total = Number(totalRow?.total ?? 0);
    const rows = await queryAll<ChargeListRow>(
      `SELECT p.*, c.description, c.client_id, cl.name AS client_name,
              cl.whatsapp AS client_whatsapp, c.id AS charge_id
         FROM payments p
         JOIN charges c ON c.id = p.charge_id
         JOIN clients cl ON cl.id = c.client_id
        WHERE c.provider_id = ?
          AND p.financial_voided_at IS NULL
          AND p.due_date >= ? AND p.due_date < ?
        ORDER BY p.due_date DESC, p.created_at DESC, p.id DESC
        LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );
    const totals = await queryOne<{
      total_cents: number | string;
      received_cents: number | string;
      pending_cents: number | string;
      overdue_cents: number | string;
    }>(
      `SELECT
         COALESCE(SUM(p.amount_cents), 0) AS total_cents,
         COALESCE(SUM(CASE WHEN p.status = 'paga' THEN p.amount_cents ELSE 0 END), 0) AS received_cents,
         COALESCE(SUM(CASE WHEN p.status <> 'paga' THEN p.amount_cents ELSE 0 END), 0) AS pending_cents,
         COALESCE(SUM(CASE WHEN p.status = 'em_aberto' AND p.due_date < ? THEN p.amount_cents ELSE 0 END), 0) AS overdue_cents
       FROM payments p
       JOIN charges c ON c.id = p.charge_id
      WHERE c.provider_id = ?
        AND p.financial_voided_at IS NULL
        AND p.due_date >= ? AND p.due_date < ?`,
      todayISO(),
      ...params,
    );

    return {
      month,
      items: rows.map((row) => ({
        paymentId: row.id,
        chargeId: row.charge_id,
        description: row.description,
        amountCents: row.amount_cents,
        dueDate: row.due_date,
        status: derivedStatus(row),
        client: {
          id: row.client_id,
          name: row.client_name,
          whatsapp: row.client_whatsapp,
        },
        paidAt: row.paid_at,
      })),
      summary: {
        totalCents: Number(totals?.total_cents ?? 0),
        receivedCents: Number(totals?.received_cents ?? 0),
        pendingCents: Number(totals?.pending_cents ?? 0),
        overdueCents: Number(totals?.overdue_cents ?? 0),
      },
      pagination: pagination(page, pageSize, total),
    };
  });

  /** Detalhe de uma cobrança (tela de validação do comprovante). */
  app.get<{ Params: { id: string } }>("/api/charges/:id", async (req, reply) => {
    const row = await queryOne<
      PaymentRow & {
        description: string;
        client_name: string;
        client_whatsapp: string;
      }
    >(
      `SELECT p.*, c.description, cl.name AS client_name, cl.whatsapp AS client_whatsapp
         FROM payments p
         JOIN charges c ON c.id = p.charge_id
         JOIN clients cl ON cl.id = c.client_id
        WHERE c.id = ? AND c.provider_id = ?`,
      req.params.id,
      req.provider!.id,
    );

    if (!row) return reply.code(404).send({ error: "Cobrança não encontrada" });

    return {
      paymentId: row.id,
      description: row.description,
      amountCents: row.amount_cents,
      amountLabel: formatBRL(row.amount_cents),
      dueDate: row.due_date,
      status: derivedStatus(row),
      client: { name: row.client_name, whatsapp: row.client_whatsapp },
      paymentUrl: paymentUrl(row.public_token),
      brCode: row.brcode,
      comprovanteUrl: row.comprovante_path
        ? `/api/payments/${row.id}/comprovante`
        : null,
      clientConfirmedAt: row.client_confirmed_at,
      paidAt: row.paid_at,
      paidVia: row.paid_via,
    };
  });
}
