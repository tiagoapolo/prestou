import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseClient } from "../src/db.ts";

test("iniciar edição cancela a proposta e semeia a memória no mesmo cliente", async () => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const { startChargeDraftEdit } = await import("../src/charge-memory.ts");

  const calls: Array<{ query: string; params: unknown[] }> = [];
  const client: DatabaseClient = {
    queryAll: async () => [],
    queryOne: async () => undefined,
    execute: async (query, ...params) => {
      calls.push({ query, params });
      return { changes: 1 };
    },
  };
  const providerId = "5eb8558e-8dd0-43ea-8abc-bd01150ad0d4";
  const proposalId = "c9efe6b7-d5ff-4bd8-93e6-d4ca8c2129b2";

  await startChargeDraftEdit(client, providerId, proposalId, {
    client: {
      id: "1a55992e-bb21-4fdf-8b00-065db0f6bd64",
      name: "João da Silva",
      whatsapp: "11988887777",
    },
    description: "Lavagem",
    amountCents: 12000,
    dueDate: "2026-07-30",
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0]!.query, /UPDATE whatsapp_charge_proposals/);
  assert.deepEqual(calls[0]!.params, [proposalId]);
  assert.match(calls[1]!.query, /INSERT INTO whatsapp_pending_charges/);
  assert.deepEqual(calls[1]!.params, [
    providerId,
    JSON.stringify({
      clientName: "João da Silva",
      clientWhatsapp: "11988887777",
      description: "Lavagem",
      amountCents: 12000,
      dueDate: "2026-07-30",
    }),
    "edit",
  ]);
});

test("persiste a confirmação de telefone junto do rascunho pendente", async () => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const { savePendingCharge } = await import("../src/charge-memory.ts");

  const calls: Array<{ query: string; params: unknown[] }> = [];
  const client: DatabaseClient = {
    queryAll: async () => [],
    queryOne: async () => undefined,
    execute: async (query, ...params) => {
      calls.push({ query, params });
      return { changes: 1 };
    },
  };

  await savePendingCharge(client, "5eb8558e-8dd0-43ea-8abc-bd01150ad0d4", {
    mode: "fill",
    partial: {
      clientName: "João",
      clientWhatsapp: "11977776666",
      description: "Lavagem",
      amountCents: 8000,
      dueDate: "2026-07-30",
    },
    phoneConfirmation: {
      clientId: "c9efe6b7-d5ff-4bd8-93e6-d4ca8c2129b2",
      clientName: "Maria",
      whatsapp: "11977776666",
    },
  });

  const persisted = JSON.parse(String(calls[0]!.params[1]));
  assert.deepEqual(persisted._phoneConfirmation, {
    clientId: "c9efe6b7-d5ff-4bd8-93e6-d4ca8c2129b2",
    clientName: "Maria",
    whatsapp: "11977776666",
  });
});
