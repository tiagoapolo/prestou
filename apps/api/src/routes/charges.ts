import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { generatePixBrCode } from "@prestou/pix";
import { execute, queryAll, queryOne, withTransaction } from "../db.js";
import { newId, newPublicToken } from "../ids.js";
import { requireProvider } from "../auth.js";
import { track } from "../analytics.js";
import { chargeMessage, paymentUrl, waMeLink, formatBRL } from "../messages.js";
import { derivedStatus, todayISO } from "../state.js";
import type { ChargeRow, ClientRow, PaymentRow, ProviderRow } from "../types.js";
import { amountCentsSchema, isoDateSchema, mobileSchema, requiredText, validationMessage } from "../validation.js";

const createChargeSchema = z.object({
  client: z.object({
    /** Reaproveita cliente existente (critério F2: não redigitar). */
    id: z.string().uuid().optional(),
    name: requiredText("Nome do cliente", 2, 80).optional(),
    whatsapp: mobileSchema.optional(),
  }),
  description: requiredText("Serviço", 2, 120),
  amountCents: amountCentsSchema,
  dueDate: isoDateSchema,
  /** Duração do preenchimento no cliente, para medir a meta de 60s (F2). */
  fillMs: z.number().int().nonnegative().optional(),
});

async function findOrCreateClient(
  provider: ProviderRow,
  input: z.infer<typeof createChargeSchema>["client"],
): Promise<ClientRow> {
  if (input.id) {
    const existing = await queryOne<ClientRow>(
      "SELECT * FROM clients WHERE id = ? AND provider_id = ?",
      input.id,
      provider.id,
    );
    if (existing) return existing;
  }

  if (!input.name || !input.whatsapp) {
    throw Object.assign(new Error("Nome e WhatsApp do cliente são obrigatórios"), {
      statusCode: 400,
    });
  }

  const byPhone = await queryOne<ClientRow>(
    "SELECT * FROM clients WHERE provider_id = ? AND whatsapp = ?",
    provider.id,
    input.whatsapp,
  );
  if (byPhone) return byPhone;

  const id = newId();
  await execute(
    "INSERT INTO clients (id, provider_id, name, whatsapp, created_at) VALUES (?, ?, ?, ?, ?)",
    id,
    provider.id,
    input.name,
    input.whatsapp,
    new Date().toISOString(),
  );
  return (await queryOne<ClientRow>("SELECT * FROM clients WHERE id = ?", id))!;
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

    let client: ClientRow;
    try {
      client = await findOrCreateClient(provider, body.client);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      return reply.code(status).send({ error: (err as Error).message });
    }

    // BR Code é gerado uma vez e congelado na parcela: o valor e a chave não
    // podem mudar depois que o link foi enviado ao cliente.
    let brCode: string;
    try {
      brCode = generatePixBrCode({
        key: provider.pix_key,
        amount: body.amountCents / 100,
        merchantName: provider.name,
        merchantCity: provider.city ?? "BRASIL",
      }).brCode;
    } catch (err) {
      return reply.code(422).send({
        error: `Não foi possível gerar o Pix: ${(err as Error).message}`,
      });
    }

    const now = new Date().toISOString();
    const chargeId = newId();
    const paymentId = newId();
    const token = newPublicToken();

    await withTransaction(async (tx) => {
      await tx.execute(`
        INSERT INTO charges (id, provider_id, client_id, description, amount_cents, due_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        chargeId,
        provider.id,
        client.id,
        body.description,
        body.amountCents,
        body.dueDate,
        now,
      );

      // MVP: 1 parcela por cobrança. O schema já suporta N (seq).
      await tx.execute(`
        INSERT INTO payments (id, charge_id, seq, amount_cents, due_date, status, public_token, brcode, created_at)
        VALUES (?, ?, 1, ?, ?, 'em_aberto', ?, ?, ?)
      `, paymentId, chargeId, body.amountCents, body.dueDate, token, brCode, now);
    });

    await track({
      type: "cobranca_criada",
      providerId: provider.id,
      chargeId,
      paymentId,
      metadata: { fillMs: body.fillMs ?? null, amountCents: body.amountCents },
    });

    const message = chargeMessage({
      clientName: client.name,
      providerName: provider.name,
      description: body.description,
      amountCents: body.amountCents,
      publicToken: token,
    });

    return reply.code(201).send({
      charge: {
        id: chargeId,
        description: body.description,
        amountCents: body.amountCents,
        dueDate: body.dueDate,
        client: { id: client.id, name: client.name, whatsapp: client.whatsapp },
      },
      payment: {
        id: paymentId,
        status: "em_aberto",
        publicToken: token,
        paymentUrl: paymentUrl(token),
      },
      // F4 — o prestador só toca e envia.
      whatsapp: { message, deeplink: waMeLink(client.whatsapp, message) },
    });
  });

  /** F9 — painel "quem me deve". */
  app.get("/api/charges", async (req) => {
    const provider = req.provider!;
    const rows = await queryAll<
      PaymentRow & {
        description: string;
        client_name: string;
        client_whatsapp: string;
        charge_id: string;
      }
    >(
      `SELECT p.*, c.description, cl.name AS client_name, cl.whatsapp AS client_whatsapp, c.id AS charge_id
         FROM payments p
         JOIN charges c ON c.id = p.charge_id
         JOIN clients cl ON cl.id = c.client_id
        WHERE c.provider_id = ?
        ORDER BY p.created_at DESC`,
      provider.id,
    );

    const today = todayISO();
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
        client: { name: r.client_name, whatsapp: r.client_whatsapp },
        paymentUrl: paymentUrl(r.public_token),
        hasComprovante: Boolean(r.comprovante_path),
        clientConfirmedAt: r.client_confirmed_at,
        paidAt: r.paid_at,
        paidVia: r.paid_via,
        whatsappDeeplink: waMeLink(r.client_whatsapp, message),
      };
    });

    const monthPrefix = today.slice(0, 7);
    const inMonth = items.filter((i) => i.dueDate.startsWith(monthPrefix));
    const sum = (list: typeof items) =>
      list.reduce((acc, i) => acc + i.amountCents, 0);

    return {
      items: items.slice(0, 10),
      totals: {
        aReceberCents: sum(items.filter((i) => i.status !== "paga")),
        recebidoMesCents: sum(inMonth.filter((i) => i.status === "paga")),
        atrasadasCount: items.filter((i) => i.status === "atrasada").length,
        aguardandoValidacaoCount: items.filter(
          (i) => i.status === "cliente_confirmou",
        ).length,
      },
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
