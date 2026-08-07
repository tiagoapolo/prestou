import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseClient } from "../src/db.ts";
import type { ProviderRow } from "../src/types.ts";

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const {
  cancelChargeSeries,
  generateSeriesOccurrences,
  pauseChargeSeries,
  resumeChargeSeries,
  updateChargeSeries,
} = await import("../src/charge-series.ts");
const { chargeSeriesUpdateSchema } = await import("../src/routes/charge-series.ts");

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

test("job avança a série e replay não duplica a competência", async () => {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const series = {
    id: "412f03bd-92bd-47de-8534-2e74599095a7",
    provider_id: provider.id,
    client_id: "0db0f0b5-42fe-4d8d-b963-4dfe0a15c3d6",
    description: "Manutenção mensal",
    amount_cents: 15000,
    first_due_date: "2027-01-31",
    anchor_day: 31,
    end_date: "2027-03-31",
    next_due_date: "2027-02-28" as string | null,
    status: "ativa",
    paused_at: null,
    cancelled_at: null,
    completed_at: null,
    created_at: "2027-01-01T12:00:00.000Z",
    updated_at: "2027-01-01T12:00:00.000Z",
  };

  const tx: DatabaseClient = {
    queryAll: async () => [],
    queryOne: async (query) => {
      if (query.includes("FROM charge_series")) {
        return series.status === "ativa" && series.next_due_date === "2027-02-28"
          ? { ...series }
          : undefined;
      }
      if (query.includes("FROM providers")) return provider;
      if (query.includes("FROM clients")) {
        return {
          id: series.client_id,
          provider_id: provider.id,
          name: "Maria",
          whatsapp: "11977776666",
          saved_for_future: true,
          created_at: "2027-01-01T12:00:00.000Z",
        };
      }
      return undefined;
    },
    execute: async (query, ...params) => {
      calls.push({ query, params });
      if (query.includes("UPDATE charge_series")) {
        series.next_due_date = params[0] as string | null;
        series.status = params[1] as string;
      }
      return { changes: 1 };
    },
  };

  const first = await generateSeriesOccurrences(
    tx,
    series.id,
    "2027-02-28",
  );
  const replay = await generateSeriesOccurrences(
    tx,
    series.id,
    "2027-02-28",
  );

  assert.equal(first.length, 1);
  assert.equal(first[0]?.recurrence?.sequence, 2);
  assert.equal(series.next_due_date, "2027-03-31");
  assert.equal(replay.length, 0);
  assert.equal(calls.filter(({ query }) => query.includes("INSERT INTO payments")).length, 1);
});

test("pausa preserva cobranças e retomada pula competências vencidas", async () => {
  const series = {
    id: "412f03bd-92bd-47de-8534-2e74599095a7",
    provider_id: provider.id,
    client_id: "0db0f0b5-42fe-4d8d-b963-4dfe0a15c3d6",
    description: "Manutenção mensal",
    amount_cents: 15000,
    first_due_date: "2027-01-31",
    anchor_day: 31,
    end_date: "2027-04-30",
    next_due_date: "2027-02-28" as string | null,
    status: "ativa",
    paused_at: null,
    cancelled_at: null,
    completed_at: null,
    created_at: "2027-01-01T12:00:00.000Z",
    updated_at: "2027-01-01T12:00:00.000Z",
  };
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const tx: DatabaseClient = {
    queryAll: async () => [],
    queryOne: async (query) => query.includes("FROM charge_series") ? { ...series } : undefined,
    execute: async (query, ...params) => {
      calls.push({ query, params });
      if (query.includes("UPDATE charge_series")) {
        if (query.includes("status = 'pausada'")) series.status = "pausada";
        if (query.includes("status = ?")) {
          series.status = params[0] as string;
          series.next_due_date = params[1] as string | null;
        }
      }
      return { changes: 1 };
    },
  };

  await pauseChargeSeries(tx, provider.id, series.id);
  await resumeChargeSeries(tx, provider.id, series.id, "2027-03-10");

  assert.equal(series.status, "ativa");
  assert.equal(series.next_due_date, "2027-03-31");
  assert.equal(calls.some(({ query }) => query.includes("UPDATE charges")), false);
});

test("edição da série exige ao menos um campo válido", () => {
  assert.equal(chargeSeriesUpdateSchema.safeParse({}).success, false);
  assert.equal(chargeSeriesUpdateSchema.safeParse({ dueDay: 32 }).success, false);
  assert.deepEqual(chargeSeriesUpdateSchema.parse({
    amountCents: 18000,
    endDate: "2027-05-31",
  }), {
    amountCents: 18000,
    endDate: "2027-05-31",
  });
});

test("edição altera somente a regra futura e preserva cobranças geradas", async () => {
  const series = {
    id: "412f03bd-92bd-47de-8534-2e74599095a7",
    provider_id: provider.id,
    client_id: "0db0f0b5-42fe-4d8d-b963-4dfe0a15c3d6",
    description: "Manutenção mensal",
    amount_cents: 15000,
    first_due_date: "2027-01-31",
    anchor_day: 31,
    end_date: "2027-04-30",
    next_due_date: "2027-02-28",
    status: "ativa",
    paused_at: null,
    cancelled_at: null,
    completed_at: null,
    created_at: "2027-01-01T12:00:00.000Z",
    updated_at: "2027-01-01T12:00:00.000Z",
  };
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const tx: DatabaseClient = {
    queryAll: async () => [],
    queryOne: async (query) => {
      if (query.includes("FROM charge_series")) return { ...series };
      if (query.includes("MAX(series_sequence)")) {
        return { sequence: 1, due_date: "2027-01-31" };
      }
      return undefined;
    },
    execute: async (query, ...params) => {
      calls.push({ query, params });
      return { changes: 1 };
    },
  };

  const updated = await updateChargeSeries(tx, provider.id, series.id, {
    amountCents: 18000,
    dueDay: 15,
    endDate: "2027-05-15",
  }, "2027-01-10");

  assert.equal(updated.amount_cents, 18000);
  assert.equal(updated.anchor_day, 15);
  assert.equal(updated.next_due_date, "2027-02-15");
  assert.equal(calls.some(({ query }) => query.includes("UPDATE charges")), false);
});

test("cancelamento é definitivo para a série e preserva cobranças existentes", async () => {
  const series = {
    id: "412f03bd-92bd-47de-8534-2e74599095a7",
    provider_id: provider.id,
    client_id: "0db0f0b5-42fe-4d8d-b963-4dfe0a15c3d6",
    description: "Manutenção mensal",
    amount_cents: 15000,
    first_due_date: "2027-01-31",
    anchor_day: 31,
    end_date: "2027-04-30",
    next_due_date: "2027-02-28",
    status: "ativa",
    paused_at: null,
    cancelled_at: null,
    completed_at: null,
    created_at: "2027-01-01T12:00:00.000Z",
    updated_at: "2027-01-01T12:00:00.000Z",
  };
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const tx: DatabaseClient = {
    queryAll: async () => [],
    queryOne: async (query, seriesId, providerId) => {
      if (query.includes("FROM charge_series") && seriesId === series.id && providerId === provider.id) {
        return { ...series };
      }
      return undefined;
    },
    execute: async (query, ...params) => {
      calls.push({ query, params });
      return { changes: 1 };
    },
  };

  const cancelled = await cancelChargeSeries(tx, provider.id, series.id);

  assert.equal(cancelled.status, "cancelada");
  assert.equal(cancelled.next_due_date, null);
  assert.equal(calls.some(({ query }) => query.includes("UPDATE charges")), false);
  await assert.rejects(
    () => pauseChargeSeries(tx, "outro-prestador", series.id),
    (error: Error & { statusCode?: number }) => error.statusCode === 404,
  );
});
