import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { track } from "../analytics.js";
import { queryOne, withTransaction, type DatabaseClient } from "../db.js";
import { newId } from "../ids.js";
import { formatBRL } from "../messages.js";
import { TransitionError, transition } from "../state.js";
import type { PaymentRow } from "../types.js";
import { requireProvider } from "../auth.js";

const markPaidArgumentsSchema = z.object({
  paymentId: z.string().uuid(),
}).strict();

const createProposalSchema = z.object({
  tool: z.literal("marcar_pago_manual"),
  arguments: markPaidArgumentsSchema,
  idempotencyKey: z.string().uuid(),
}).strict();

const proposalParamsSchema = z.object({
  proposalId: z.string().uuid(),
});

interface PaymentContext extends PaymentRow {
  description: string;
  provider_id: string;
  client_name: string;
}

interface ProposalRow {
  id: string;
  provider_id: string;
  session_id: string;
  tool: "marcar_pago_manual";
  arguments: unknown;
  summary: string;
  expires_at: string;
  consumed_at: string | null;
  idempotency_key: string;
  result: unknown;
  created_at: string;
  expired?: boolean;
}

async function loadOwnedPayment(
  client: Pick<DatabaseClient, "queryOne">,
  paymentId: string,
  providerId: string,
): Promise<PaymentContext | undefined> {
  return client.queryOne<PaymentContext>(`
    SELECT p.*, c.description, c.provider_id, cl.name AS client_name
      FROM payments p
      JOIN charges c ON c.id = p.charge_id
      JOIN clients cl ON cl.id = c.client_id
     WHERE p.id = ? AND c.provider_id = ?
  `, paymentId, providerId);
}

function persistedJson(value: unknown, proposalId: string, field: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${field} persistido inválido na proposta ${proposalId}`);
  }
}

function proposalArguments(proposal: ProposalRow): z.infer<typeof markPaidArgumentsSchema> {
  const parsed = markPaidArgumentsSchema.safeParse(
    persistedJson(proposal.arguments, proposal.id, "Argumentos"),
  );
  if (!parsed.success) {
    throw new Error(`Argumentos persistidos inválidos na proposta ${proposal.id}`);
  }
  return parsed.data;
}

function proposalResult(proposal: ProposalRow): Record<string, unknown> {
  const result = persistedJson(proposal.result, proposal.id, "Resultado");
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`Resultado persistido inválido na proposta ${proposal.id}`);
  }
  return result as Record<string, unknown>;
}

function publicProposal(proposal: ProposalRow) {
  return {
    proposalId: proposal.id,
    tool: proposal.tool,
    arguments: proposalArguments(proposal),
    summary: proposal.summary,
    expiresAt: proposal.expires_at,
    idempotencyKey: proposal.idempotency_key,
  };
}

function sameProposal(
  proposal: ProposalRow,
  input: z.infer<typeof createProposalSchema>,
  sessionId: string,
): boolean {
  return proposal.session_id === sessionId
    && proposal.tool === input.tool
    && JSON.stringify(proposalArguments(proposal)) === JSON.stringify(input.arguments);
}

async function executeMarkPaid(
  tx: DatabaseClient,
  proposal: ProposalRow,
): Promise<Record<string, unknown>> {
  const args = proposalArguments(proposal);

  const ctx = await loadOwnedPayment(
    tx,
    args.paymentId,
    proposal.provider_id,
  );
  if (!ctx) {
    throw Object.assign(new Error("Parcela não encontrada"), { statusCode: 404 });
  }
  if (ctx.status !== "em_aberto") {
    throw new TransitionError("A cobrança mudou de estado depois da proposta");
  }

  const updated = await transition({
    payment: ctx,
    to: "paga",
    actor: "provider",
    action: "marcado_pago_manual",
    patch: { paid_via: "manual" },
  }, tx);

  await track({
    type: "marcado_pago_manual",
    providerId: proposal.provider_id,
    chargeId: ctx.charge_id,
    paymentId: updated.id,
    metadata: {
      source: "assistant",
      proposalId: proposal.id,
      idempotencyKey: proposal.idempotency_key,
    },
  }, tx);

  return {
    payment: { id: updated.id, status: updated.status, paidAt: updated.paid_at },
  };
}

export async function actionProposalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireProvider);

  app.post("/api/action-proposals", async (req, reply) => {
    const parsed = createProposalSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Proposta inválida",
        issues: parsed.error.issues,
      });
    }

    const providerId = req.provider!.id;
    const sessionId = req.authUser!.sessionId;
    const input = parsed.data;
    const existing = await queryOne<ProposalRow>(
      "SELECT * FROM assistant_action_proposals WHERE provider_id = ? AND idempotency_key = ?",
      providerId,
      input.idempotencyKey,
    );
    if (existing) {
      if (!sameProposal(existing, input, sessionId)) {
        return reply.code(409).send({
          error: "A chave de idempotência já pertence a outra proposta.",
        });
      }
      return reply.send({ proposal: publicProposal(existing), alreadyProposed: true });
    }

    const payment = await loadOwnedPayment(
      { queryOne },
      input.arguments.paymentId,
      providerId,
    );
    if (!payment) return reply.code(404).send({ error: "Parcela não encontrada" });
    if (payment.status !== "em_aberto") {
      const concurrent = await queryOne<ProposalRow>(
        "SELECT * FROM assistant_action_proposals WHERE provider_id = ? AND idempotency_key = ?",
        providerId,
        input.idempotencyKey,
      );
      if (concurrent && sameProposal(concurrent, input, sessionId)) {
        return reply.send({ proposal: publicProposal(concurrent), alreadyProposed: true });
      }
      return reply.code(409).send({ error: "Somente cobranças em aberto podem ser marcadas manualmente." });
    }

    const id = newId();
    const summary = `Marcar definitivamente como paga a cobrança de ${formatBRL(payment.amount_cents)} de ${payment.client_name}, referente a ${payment.description}? Esta ação não pode ser desfeita.`;
    const result = await withTransaction(async (tx) => {
      const inserted = await tx.execute(`
        INSERT INTO assistant_action_proposals
          (id, provider_id, session_id, tool, arguments, summary, expires_at, idempotency_key)
        VALUES (?, ?, ?, ?, ?::text::jsonb, ?, CURRENT_TIMESTAMP + INTERVAL '5 minutes', ?)
        ON CONFLICT (provider_id, idempotency_key) DO NOTHING
      `,
        id,
        providerId,
        sessionId,
        input.tool,
        JSON.stringify(input.arguments),
        summary,
        input.idempotencyKey,
      );

      const proposal = await tx.queryOne<ProposalRow>(
        "SELECT * FROM assistant_action_proposals WHERE provider_id = ? AND idempotency_key = ?",
        providerId,
        input.idempotencyKey,
      );
      if (!proposal) throw new Error("Não foi possível persistir a proposta");
      return { proposal, inserted: inserted.changes === 1 };
    });

    if (!result.inserted && !sameProposal(result.proposal, input, sessionId)) {
      return reply.code(409).send({
        error: "A chave de idempotência já pertence a outra proposta.",
      });
    }

    return reply.code(result.inserted ? 201 : 200).send({
      proposal: publicProposal(result.proposal),
      alreadyProposed: !result.inserted,
    });
  });

  app.post<{ Params: { proposalId: string } }>(
    "/api/action-proposals/:proposalId/confirm",
    async (req, reply) => {
      const params = proposalParamsSchema.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: "Identificador de proposta inválido" });

      try {
        const confirmation = await withTransaction(async (tx) => {
          const proposal = await tx.queryOne<ProposalRow>(`
            SELECT *, expires_at <= CURRENT_TIMESTAMP AS expired
              FROM assistant_action_proposals
             WHERE id = ? AND provider_id = ? AND session_id = ?
             FOR UPDATE
          `, params.data.proposalId, req.provider!.id, req.authUser!.sessionId);

          if (!proposal) {
            throw Object.assign(new Error("Proposta não encontrada"), { statusCode: 404 });
          }
          if (proposal.consumed_at) {
            return { result: proposalResult(proposal), alreadyConfirmed: true };
          }
          if (proposal.expired) {
            throw Object.assign(new Error("A proposta expirou. Solicite uma nova confirmação."), {
              statusCode: 410,
            });
          }

          const result = await executeMarkPaid(tx, proposal);
          await tx.execute(`
            UPDATE assistant_action_proposals
               SET consumed_at = ?, result = ?::text::jsonb
             WHERE id = ?
          `, new Date().toISOString(), JSON.stringify(result), proposal.id);

          return { result, alreadyConfirmed: false };
        });

        return reply.send({
          ...confirmation.result,
          proposalId: params.data.proposalId,
          alreadyConfirmed: confirmation.alreadyConfirmed,
        });
      } catch (error) {
        if (error instanceof TransitionError) {
          return reply.code(409).send({
            error: "Esta cobrança foi atualizada depois da proposta. Solicite uma nova confirmação.",
          });
        }
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          return reply.code(statusCode).send({ error: (error as Error).message });
        }
        throw error;
      }
    },
  );
}
