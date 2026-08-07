import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseClient } from "../src/db.ts";
import type { ProviderRow } from "../src/types.ts";

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const { chargeDraftSchema, createCharge } = await import("../src/charge-creation.ts");
const { createMonthlyChargeSeries } = await import("../src/charge-series.ts");

const provider: ProviderRow = {
  id: "5eb8558e-8dd0-43ea-8abc-bd01150ad0d4",
  auth_user_id: "99a05bf2-0735-42a1-822a-a8b0aa9e593f",
  email: "joao@example.com",
  name: "João Jardineiro",
  profession: "Jardinagem",
  photo_url: null,
  city: "São Paulo",
  state: "SP",
  municipality_code: "3550308",
  pix_key: "joao@example.com",
  pix_key_type: "email",
  whatsapp: "11988887777",
  whatsapp_verified_at: "2026-07-27T12:00:00.000Z",
  default_due_days: 0,
  consent_at: "2026-07-27T12:00:00.000Z",
  created_at: "2026-07-27T12:00:00.000Z",
};

test("rascunhos sem preferência explícita continuam salvando o cliente", () => {
  const draft = chargeDraftSchema.parse({
    client: { name: "Maria", whatsapp: "11977776666" },
    description: "Corte de grama",
    amountCents: 15000,
    dueDate: "2026-07-30",
  });

  assert.equal(draft.saveClient, true);
});

test("aceita série mensal com data final inclusiva", () => {
  const draft = chargeDraftSchema.parse({
    client: { name: "Maria", whatsapp: "11977776666" },
    description: "Manutenção mensal",
    amountCents: 15000,
    dueDate: "2027-01-31",
    recurrence: { frequency: "monthly", endDate: "2027-03-31" },
  });

  assert.deepEqual(draft.recurrence, {
    frequency: "monthly",
    endDate: "2027-03-31",
  });
});

test("rejeita série mensal com menos de 2 ou mais de 24 competências", () => {
  const input = {
    client: { name: "Maria", whatsapp: "11977776666" },
    description: "Manutenção mensal",
    amountCents: 15000,
    dueDate: "2027-01-31",
    recurrence: { frequency: "monthly" as const, endDate: "2027-01-31" },
  };

  assert.equal(chargeDraftSchema.safeParse(input).success, false);
  assert.equal(chargeDraftSchema.safeParse({
    ...input,
    recurrence: { ...input.recurrence, endDate: "2030-12-31" },
  }).success, false);
});

test("rejeita série mensal cujo primeiro vencimento já passou", () => {
  assert.equal(chargeDraftSchema.safeParse({
    client: { name: "Maria", whatsapp: "11977776666" },
    description: "Manutenção mensal",
    amountCents: 15000,
    dueDate: "2000-01-31",
    recurrence: { frequency: "monthly", endDate: "2000-03-31" },
  }).success, false);
});

test("cria a série e somente a primeira competência na mesma transação", async () => {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const tx: DatabaseClient = {
    queryAll: async () => [],
    queryOne: async () => undefined,
    execute: async (query, ...params) => {
      calls.push({ query, params });
      return { changes: 1 };
    },
  };

  const created = await createMonthlyChargeSeries(tx, provider, {
    client: { name: "Maria", whatsapp: "11977776666" },
    description: "Manutenção mensal",
    amountCents: 15000,
    dueDate: "2027-01-31",
    recurrence: { frequency: "monthly", endDate: "2027-03-31" },
  }, "form");

  assert.equal(calls.filter(({ query }) => query.includes("INSERT INTO payments")).length, 1);
  assert.equal(calls.filter(({ query }) => query.includes("INSERT INTO charge_series")).length, 1);
  assert.equal(calls.filter(({ query }) => query.includes("UPDATE charges")).length, 1);
  assert.deepEqual(created.recurrence, {
    seriesId: created.recurrence?.seriesId,
    frequency: "monthly",
    endDate: "2027-03-31",
    sequence: 1,
    occurrences: 3,
  });
});

test("cria cliente não reutilizável quando o dashboard não quer salvá-lo", async () => {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const tx: DatabaseClient = {
    queryAll: async () => [],
    queryOne: async () => undefined,
    execute: async (query, ...params) => {
      calls.push({ query, params });
      return { changes: 1 };
    },
  };

  await createCharge(tx, provider, {
    client: { name: "Maria", whatsapp: "11977776666" },
    description: "Corte de grama",
    amountCents: 15000,
    dueDate: "2026-07-30",
    saveClient: false,
  }, "form");

  const insert = calls.find(({ query }) => query.includes("INSERT INTO clients"));
  assert.ok(insert);
  assert.match(insert.query, /saved_for_future/);
  assert.equal(insert.params[4], false);
});

test("promove um cliente histórico quando o prestador decide salvá-lo", async () => {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const tx: DatabaseClient = {
    queryAll: async () => [],
    queryOne: async () => ({
      id: "c9efe6b7-d5ff-4bd8-93e6-d4ca8c2129b2",
      provider_id: provider.id,
      name: "Maria",
      whatsapp: "11977776666",
      saved_for_future: false,
      created_at: "2026-07-27T12:00:00.000Z",
    }),
    execute: async (query, ...params) => {
      calls.push({ query, params });
      return { changes: 1 };
    },
  };

  await createCharge(tx, provider, {
    client: { name: "Maria", whatsapp: "11977776666" },
    description: "Corte de grama",
    amountCents: 15000,
    dueDate: "2026-07-30",
    saveClient: true,
  }, "form");

  const update = calls.find(({ query }) => query.includes("UPDATE clients"));
  assert.ok(update);
  assert.match(update.query, /saved_for_future = true/);
});
