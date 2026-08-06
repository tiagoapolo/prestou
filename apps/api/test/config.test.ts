import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const { resolveSignupMode } = await import("../src/config.ts");

test("resolveSignupMode preserva o piloto por convite quando só a flag legada está ativa", () => {
  assert.equal(resolveSignupMode({ WHATSAPP_SIGNUP_ENABLED: "true" }), "invite_only");
  assert.equal(resolveSignupMode({ WHATSAPP_SIGNUP_ENABLED: "false" }), "disabled");
});

test("resolveSignupMode aceita os três modos explícitos", () => {
  assert.equal(resolveSignupMode({ WHATSAPP_SIGNUP_MODE: "disabled" }), "disabled");
  assert.equal(resolveSignupMode({ WHATSAPP_SIGNUP_MODE: "invite_only" }), "invite_only");
  assert.equal(resolveSignupMode({ WHATSAPP_SIGNUP_MODE: "public" }), "public");
});

test("resolveSignupMode rejeita modo explícito inválido", () => {
  assert.throws(
    () => resolveSignupMode({ WHATSAPP_SIGNUP_MODE: "open" }),
    /WHATSAPP_SIGNUP_MODE/,
  );
});
