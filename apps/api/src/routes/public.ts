import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import { config } from "../config.js";
import { queryOne } from "../db.js";
import { newId } from "../ids.js";
import { track } from "../analytics.js";
import { notifyProvider } from "../notify.js";
import { formatBRL } from "../messages.js";
import { TransitionError, getPaymentByToken, transition } from "../state.js";
import { saveReceipt } from "../storage.js";
import type { ChargeRow, ClientRow, PaymentRow, ProviderRow } from "../types.js";

interface PublicCtx {
  payment: PaymentRow;
  charge: ChargeRow;
  client: ClientRow;
  provider: ProviderRow;
}

async function loadByToken(token: string): Promise<PublicCtx | undefined> {
  const payment = await getPaymentByToken(token);
  if (!payment) return undefined;
  const charge = await queryOne<ChargeRow>(
    "SELECT * FROM charges WHERE id = ?",
    payment.charge_id,
  );
  if (!charge) return undefined;
  const client = await queryOne<ClientRow>(
    "SELECT * FROM clients WHERE id = ?",
    charge.client_id,
  );
  const provider = await queryOne<ProviderRow>(
    "SELECT * FROM providers WHERE id = ?",
    charge.provider_id,
  );
  if (!client || !provider) return undefined;
  return { payment, charge, client, provider };
}

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

function extFor(mime: string): string {
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/heic":
      return ".heic";
    case "application/pdf":
      return ".pdf";
    default:
      return ".jpg";
  }
}

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  /**
   * F5 — dados da página de pagamento mínima.
   * Não expõe nada além do necessário: quem cobra, o que é, quanto e o Pix.
   * Nenhum dado do cliente é pedido ou devolvido.
   */
  app.get<{ Params: { token: string } }>(
    "/public/pay/:token",
    async (req, reply) => {
      const ctx = await loadByToken(req.params.token);
      if (!ctx) return reply.code(404).send({ error: "Cobrança não encontrada" });

      // O simples carregamento da página é o evento de funil "link_aberto".
      await track({
        type: "link_aberto",
        providerId: ctx.provider.id,
        chargeId: ctx.charge.id,
        paymentId: ctx.payment.id,
      });

      return {
        provider: {
          name: ctx.provider.name,
          profession: ctx.provider.profession,
          photoUrl: ctx.provider.photo_url,
        },
        description: ctx.charge.description,
        amountCents: ctx.payment.amount_cents,
        amountLabel: formatBRL(ctx.payment.amount_cents),
        dueDate: ctx.payment.due_date,
        status: ctx.payment.status,
        brCode: ctx.payment.brcode,
        alreadyConfirmed: ctx.payment.status !== "em_aberto",
      };
    },
  );

  /** QR Code sob demanda (não é o elemento principal — decisão de produto F5). */
  app.get<{ Params: { token: string } }>(
    "/public/pay/:token/qr.svg",
    async (req, reply) => {
      const ctx = await loadByToken(req.params.token);
      if (!ctx) return reply.code(404).send({ error: "Cobrança não encontrada" });
      const svg = await QRCode.toString(ctx.payment.brcode, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
      });
      return reply.type("image/svg+xml").send(svg);
    },
  );

  /**
   * Evento "codigo_copiado" — é o toque que dispara o prompt "já pagou?".
   * Junto com cliente_confirmou, mede o vazamento que decide o PSP na V2.
   */
  app.post<{ Params: { token: string } }>(
    "/public/pay/:token/copied",
    async (req, reply) => {
      const ctx = await loadByToken(req.params.token);
      if (!ctx) return reply.code(404).send({ error: "Cobrança não encontrada" });
      await track({
        type: "codigo_copiado",
        providerId: ctx.provider.id,
        chargeId: ctx.charge.id,
        paymentId: ctx.payment.id,
      });
      return { ok: true };
    },
  );

  /**
   * F5/F6 — cliente toca "já paguei", opcionalmente anexando o comprovante.
   * Aceita multipart (com arquivo) ou JSON vazio (sem arquivo).
   * Inverte quem faz o trabalho: o comprovante chega sem o prestador pedir.
   */
  app.post<{ Params: { token: string } }>(
    "/public/pay/:token/confirm",
    async (req, reply) => {
      const ctx = await loadByToken(req.params.token);
      if (!ctx) return reply.code(404).send({ error: "Cobrança não encontrada" });
      if (ctx.payment.status !== "em_aberto") {
        return reply.code(200).send({ ok: true, alreadyHandled: true });
      }

      let comprovantePath: string | null = null;

      if (req.isMultipart()) {
        const file = await req.file();
        if (file) {
          if (!ALLOWED_MIME.has(file.mimetype)) {
            return reply
              .code(415)
              .send({ error: "Formato não suportado. Envie imagem ou PDF." });
          }
          const objectPath = `${ctx.provider.id}/${ctx.payment.id}/${newId()}${extFor(file.mimetype)}`;
          const bytes = await file.toBuffer();
          comprovantePath = await saveReceipt(objectPath, bytes, file.mimetype);
        }
      }

      try {
        const updated = await transition({
          payment: ctx.payment,
          to: "cliente_confirmou",
          actor: "client",
          action: "cliente_confirmou",
          patch: {
            client_confirmed_at: new Date().toISOString(),
            comprovante_path: comprovantePath,
          },
        });

        await track({
          type: "cliente_confirmou",
          providerId: ctx.provider.id,
          chargeId: ctx.charge.id,
          paymentId: updated.id,
          metadata: { hasComprovante: Boolean(comprovantePath) },
        });

        // Decisão 2b — o prestador é avisado por WhatsApp, não por push.
        const body =
          `${ctx.client.name} marcou como pago ${formatBRL(updated.amount_cents)} ` +
          `(${ctx.charge.description})` +
          `${comprovantePath ? " e anexou o comprovante" : ""}. ` +
          `Confira na sua conta e confirme no Prestou: ` +
          `${config.publicWebUrl}/cobranca/${ctx.charge.id}`;

        await notifyProvider({
          provider: ctx.provider,
          paymentId: updated.id,
          kind: "client_confirmed",
          body,
          template: "pagamento_confirmado_cliente",
          templateParams: [
            ctx.client.name,
            formatBRL(updated.amount_cents),
            ctx.charge.description,
            `${config.publicWebUrl}/cobranca/${ctx.charge.id}`,
          ],
        });

        return { ok: true, status: updated.status };
      } catch (err) {
        if (err instanceof TransitionError) {
          // Já confirmado ou já pago: para o cliente isso não é erro.
          return reply.code(200).send({ ok: true, alreadyHandled: true });
        }
        throw err;
      }
    },
  );
}
