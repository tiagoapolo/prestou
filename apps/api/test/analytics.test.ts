import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseClient } from "../src/db.ts";

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const { track } = await import("../src/analytics.ts");

test("track correlaciona evento de onboarding por jornada e tolera replay", async () => {
  let statement = "";
  let params: unknown[] = [];
  const client = {
    async execute(query: string, ...values: unknown[]) {
      statement = query;
      params = values;
      return { changes: 1 };
    },
  } as unknown as DatabaseClient;

  await track({
    type: "cadastro_entrada_aberta",
    onboardingJourneyId: "550e8400-e29b-41d4-a716-446655440000",
    metadata: { source: "instagram" },
  }, client);

  assert.match(statement, /onboarding_journey_id/);
  assert.match(statement, /ON CONFLICT DO NOTHING/);
  assert.equal(params[5], "550e8400-e29b-41d4-a716-446655440000");
});
