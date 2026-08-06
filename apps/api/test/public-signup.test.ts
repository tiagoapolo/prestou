import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_SIGNUP_MESSAGE,
  createPublicSignupMessage,
  parsePublicSignupIntent,
  signupAttributionSchema,
} from "../src/public-signup.ts";

const secret = "onboarding-secret";
const now = new Date("2026-08-06T12:00:00.000Z").getTime();
const journeyId = "550e8400-e29b-41d4-a716-446655440000";

test("atribuição normaliza valores canônicos e rejeita caracteres fora da allowlist", () => {
  assert.deepEqual(signupAttributionSchema.parse({
    source: "Instagram",
    medium: "Paid_Social",
    campaign: "Lanca-2026",
    content: "Reel.01",
  }), {
    source: "instagram",
    medium: "paid_social",
    campaign: "lanca-2026",
    content: "reel.01",
  });
  assert.equal(signupAttributionSchema.safeParse({ source: "instagram ads" }).success, false);
});

test("mensagem assinada preserva a jornada e a atribuição", () => {
  const message = createPublicSignupMessage({
    journeyId,
    attribution: { source: "instagram", medium: "paid_social" },
    secret,
    now,
  });

  assert.match(message, new RegExp(`^${PUBLIC_SIGNUP_MESSAGE} `));
  assert.deepEqual(parsePublicSignupIntent(message, { secret, now }), {
    type: "public",
    journeyId,
    attribution: { source: "instagram", medium: "paid_social" },
  });
});

test("token adulterado ou expirado degrada para atribuição direta sem autorizar outra intenção", () => {
  const message = createPublicSignupMessage({
    journeyId,
    attribution: { source: "instagram" },
    secret,
    now,
  });
  const tampered = `${message.slice(0, -1)}x`;

  assert.deepEqual(parsePublicSignupIntent(tampered, { secret, now }), {
    type: "public",
    attribution: { source: "direct", medium: "unknown" },
  });
  assert.deepEqual(parsePublicSignupIntent(message, { secret, now: now + 24 * 60 * 60 * 1_000 + 1 }), {
    type: "public",
    attribution: { source: "direct", medium: "unknown" },
  });
  assert.equal(parsePublicSignupIntent("Oi", { secret, now }), undefined);
});
