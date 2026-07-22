import { generatePixBrCode } from "@prestou/pix";
import { z } from "zod";
import { track } from "./analytics.js";
import type { DatabaseClient } from "./db.js";
import { newId, newPublicToken } from "./ids.js";
import { chargeMessage, paymentUrl, waMeLink } from "./messages.js";
import type { ClientRow, ProviderRow } from "./types.js";
import { amountCentsSchema, isoDateSchema, mobileSchema, requiredText } from "./validation.js";

export const chargeDraftSchema = z.object({
  client: z.object({
    id: z.string().uuid().optional(),
    name: requiredText("Nome do cliente", 2, 80).optional(),
    whatsapp: mobileSchema.optional(),
  }),
  description: requiredText("Serviço", 2, 120),
  amountCents: amountCentsSchema,
  dueDate: isoDateSchema,
});

export type ChargeDraftInput = z.infer<typeof chargeDraftSchema>;
export type ChargeSource = "form" | "assistant" | "whatsapp";

export interface CreatedCharge {
  charge: {
    id: string;
    description: string;
    amountCents: number;
    dueDate: string;
    client: { id: string; name: string; whatsapp: string };
  };
  payment: {
    id: string;
    status: "em_aberto";
    publicToken: string;
    paymentUrl: string;
  };
  whatsapp: { message: string; deeplink: string };
}

async function findOrCreateClient(
  tx: DatabaseClient,
  provider: ProviderRow,
  input: ChargeDraftInput["client"],
): Promise<ClientRow> {
  if (input.id) {
    const existing = await tx.queryOne<ClientRow>(
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

  const byPhone = await tx.queryOne<ClientRow>(
    "SELECT * FROM clients WHERE provider_id = ? AND whatsapp = ?",
    provider.id,
    input.whatsapp,
  );
  if (byPhone) return byPhone;

  const id = newId();
  const now = new Date().toISOString();
  await tx.execute(
    "INSERT INTO clients (id, provider_id, name, whatsapp, created_at) VALUES (?, ?, ?, ?, ?)",
    id,
    provider.id,
    input.name,
    input.whatsapp,
    now,
  );
  return { id, provider_id: provider.id, name: input.name, whatsapp: input.whatsapp, created_at: now };
}

export async function createCharge(
  tx: DatabaseClient,
  provider: ProviderRow,
  input: ChargeDraftInput,
  source: ChargeSource,
  fillMs?: number,
): Promise<CreatedCharge> {
  const client = await findOrCreateClient(tx, provider, input.client);

  let brCode: string;
  try {
    brCode = generatePixBrCode({
      key: provider.pix_key,
      amount: input.amountCents / 100,
      merchantName: provider.name,
      merchantCity: provider.city ?? "BRASIL",
    }).brCode;
  } catch {
    throw Object.assign(
      new Error("Não foi possível gerar o Pix. Confira sua chave Pix e tente novamente."),
      { statusCode: 422 },
    );
  }

  const now = new Date().toISOString();
  const chargeId = newId();
  const paymentId = newId();
  const token = newPublicToken();

  await tx.execute(`
    INSERT INTO charges (id, provider_id, client_id, description, amount_cents, due_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    chargeId,
    provider.id,
    client.id,
    input.description,
    input.amountCents,
    input.dueDate,
    now,
  );
  await tx.execute(`
    INSERT INTO payments (id, charge_id, seq, amount_cents, due_date, status, public_token, brcode, created_at)
    VALUES (?, ?, 1, ?, ?, 'em_aberto', ?, ?, ?)
  `, paymentId, chargeId, input.amountCents, input.dueDate, token, brCode, now);
  await track({
    type: "cobranca_criada",
    providerId: provider.id,
    chargeId,
    paymentId,
    metadata: { fillMs: fillMs ?? null, amountCents: input.amountCents, source },
  }, tx);

  const message = chargeMessage({
    clientName: client.name,
    providerName: provider.name,
    description: input.description,
    amountCents: input.amountCents,
    publicToken: token,
  });

  return {
    charge: {
      id: chargeId,
      description: input.description,
      amountCents: input.amountCents,
      dueDate: input.dueDate,
      client: { id: client.id, name: client.name, whatsapp: client.whatsapp },
    },
    payment: {
      id: paymentId,
      status: "em_aberto",
      publicToken: token,
      paymentUrl: paymentUrl(token),
    },
    whatsapp: { message, deeplink: waMeLink(client.whatsapp, message) },
  };
}
