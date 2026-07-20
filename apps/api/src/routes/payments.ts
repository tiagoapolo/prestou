import type { FastifyInstance } from "fastify";
import { queryAll, queryOne } from "../db.js";
import { requireProvider } from "../auth.js";
import { track } from "../analytics.js";
import { contestMessage, waMeLink } from "../messages.js";
import { TransitionError, getPayment, transition } from "../state.js";
import { signedReceiptUrl } from "../storage.js";
import type { ChargeRow, ClientRow, PaymentRow, ProviderRow } from "../types.js";

interface Ctx {
  payment: PaymentRow;
  charge: ChargeRow;
  client: ClientRow;
}

/** Carrega a parcela garantindo que ela pertence ao prestador autenticado. */
async function loadOwned(paymentId: string, provider: ProviderRow): Promise<Ctx | undefined> {
  const payment = await getPayment(paymentId);
  if (!payment) return undefined;
  const charge = await queryOne<ChargeRow>(
    "SELECT * FROM charges WHERE id = ?",
    payment.charge_id,
  );
  if (!charge || charge.provider_id !== provider.id) return undefined;
  const client = await queryOne<ClientRow>(
    "SELECT * FROM clients WHERE id = ?",
    charge.client_id,
  );
  if (!client) return undefined;
  return { payment, charge, client };
}

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireProvider);

  /** F6 — prestador confirma que o dinheiro caiu (cliente_confirmou → paga). */
  app.post<{ Params: { id: string } }>(
    "/api/payments/:id/confirm",
    async (req, reply) => {
      const ctx = await loadOwned(req.params.id, req.provider!);
      if (!ctx) return reply.code(404).send({ error: "Parcela não encontrada" });

      try {
        const updated = await transition({
          payment: ctx.payment,
          to: "paga",
          actor: "provider",
          action: "prestador_confirmou",
          patch: { paid_via: "client_confirmed" },
        });
        await track({
          type: "prestador_confirmou",
          providerId: req.provider!.id,
          chargeId: ctx.charge.id,
          paymentId: updated.id,
        });
        return { payment: { id: updated.id, status: updated.status, paidAt: updated.paid_at } };
      } catch (err) {
        if (err instanceof TransitionError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  /**
   * F6 — prestador marca pago manualmente, sem confirmação do cliente
   * (em_aberto → paga). Pagamento "por fora" acontece e é dado de funil.
   */
  app.post<{ Params: { id: string } }>(
    "/api/payments/:id/mark-paid",
    async (req, reply) => {
      const ctx = await loadOwned(req.params.id, req.provider!);
      if (!ctx) return reply.code(404).send({ error: "Parcela não encontrada" });

      try {
        const updated = await transition({
          payment: ctx.payment,
          to: "paga",
          actor: "provider",
          action: "marcado_pago_manual",
          patch: { paid_via: "manual" },
        });
        await track({
          type: "marcado_pago_manual",
          providerId: req.provider!.id,
          chargeId: ctx.charge.id,
          paymentId: updated.id,
        });
        return { payment: { id: updated.id, status: updated.status, paidAt: updated.paid_at } };
      } catch (err) {
        if (err instanceof TransitionError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  /**
   * F7 — contestação "não recebi" (cliente_confirmou → em_aberto).
   * Devolve a mensagem pronta, em tom de dúvida, para envio em um toque.
   */
  app.post<{ Params: { id: string } }>(
    "/api/payments/:id/contest",
    async (req, reply) => {
      const ctx = await loadOwned(req.params.id, req.provider!);
      if (!ctx) return reply.code(404).send({ error: "Parcela não encontrada" });

      try {
        const updated = await transition({
          payment: ctx.payment,
          to: "em_aberto",
          actor: "provider",
          action: "contestacao_aberta",
        });

        await track({
          type: "contestacao_aberta",
          providerId: req.provider!.id,
          chargeId: ctx.charge.id,
          paymentId: updated.id,
        });

        const message = contestMessage({
          clientName: ctx.client.name,
          providerName: req.provider!.name,
          description: ctx.charge.description,
          amountCents: updated.amount_cents,
          publicToken: updated.public_token,
        });

        return {
          payment: { id: updated.id, status: updated.status },
          whatsapp: {
            message,
            deeplink: waMeLink(ctx.client.whatsapp, message),
          },
        };
      } catch (err) {
        if (err instanceof TransitionError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  /** Comprovante anexado pelo cliente — visível só para o dono da cobrança. */
  app.get<{ Params: { id: string } }>(
    "/api/payments/:id/comprovante",
    async (req, reply) => {
      const ctx = await loadOwned(req.params.id, req.provider!);
      if (!ctx?.payment.comprovante_path) {
        return reply.code(404).send({ error: "Comprovante não encontrado" });
      }
      return reply.redirect(
        await signedReceiptUrl(ctx.payment.comprovante_path),
      );
    },
  );

  /** Registro do envio da mensagem pelo prestador (evento de funil F4). */
  app.post<{ Params: { id: string } }>(
    "/api/payments/:id/sent",
    async (req, reply) => {
      const ctx = await loadOwned(req.params.id, req.provider!);
      if (!ctx) return reply.code(404).send({ error: "Parcela não encontrada" });
      await track({
        type: "mensagem_enviada",
        providerId: req.provider!.id,
        chargeId: ctx.charge.id,
        paymentId: ctx.payment.id,
      });
      return { ok: true };
    },
  );

  /** Notificações recebidas pelo prestador (no modo log, é o "inbox" do piloto). */
  app.get("/api/notifications", async (req) => {
    const rows = await queryAll<{
      id: string;
      kind: string;
      body: string;
      wa_deeplink: string | null;
      status: string;
      created_at: string;
      payment_id: string | null;
    }>(
      "SELECT * FROM notifications WHERE provider_id = ? ORDER BY created_at DESC LIMIT 50",
      req.provider!.id,
    );
    return {
      notifications: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        body: n.body,
        waDeeplink: n.wa_deeplink,
        status: n.status,
        paymentId: n.payment_id,
        createdAt: n.created_at,
      })),
    };
  });
}
