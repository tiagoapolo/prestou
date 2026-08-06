import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const { publicSignupRoutes } = await import("../src/routes/public-signup.ts");

const secret = "onboarding-secret";
const publicPhone = "5541963491134";

async function buildTestApp(mode: "disabled" | "invite_only" | "public") {
  const events: Array<Record<string, unknown>> = [];
  const app = Fastify();
  await app.register(publicSignupRoutes, {
    mode: () => mode,
    publicPhone,
    onboardingSecret: secret,
    track: async (event) => { events.push(event); },
  });
  return { app, events };
}

test("entrada pública emite somente URL oficial e registra a jornada", async () => {
  const { app, events } = await buildTestApp("public");
  const response = await app.inject({
    method: "POST",
    url: "/public/whatsapp-signup-entries",
    payload: { source: "Instagram", medium: "Paid_Social" },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { whatsappUrl: string };
  const url = new URL(body.whatsappUrl);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "wa.me");
  assert.equal(url.pathname, `/${publicPhone}`);
  assert.match(url.searchParams.get("text") ?? "", /^Quero começar no Prestou /);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0]?.metadata, {
    entryMode: "public",
    source: "instagram",
    medium: "paid_social",
  });
  assert.equal(events[0]?.type, "cadastro_entrada_aberta");
  await app.close();
});

test("entrada pública permanece fechada fora do modo public", async () => {
  const { app } = await buildTestApp("invite_only");
  const status = await app.inject({ method: "GET", url: "/public/whatsapp-signup" });
  const entry = await app.inject({ method: "POST", url: "/public/whatsapp-signup-entries" });

  assert.deepEqual(status.json(), { isAvailable: false });
  assert.equal(entry.statusCode, 404);
  assert.deepEqual(entry.json(), { error: "Cadastro pelo WhatsApp não está disponível." });
  await app.close();
});

test("entrada pública rejeita atribuição fora do contrato", async () => {
  const { app } = await buildTestApp("public");
  const response = await app.inject({
    method: "POST",
    url: "/public/whatsapp-signup-entries",
    payload: { source: "instagram ads" },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "Origem de campanha inválida." });
  await app.close();
});
