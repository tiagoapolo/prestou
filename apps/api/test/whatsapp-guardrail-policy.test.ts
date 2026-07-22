import { test } from "node:test";
import assert from "node:assert/strict";
import {
  whatsappGuardrailReply,
  whatsappMessageFingerprint,
} from "../src/whatsapp-guardrail-policy.ts";

test("fingerprint deduplica variações cosméticas sem armazenar a mensagem", () => {
  const first = whatsappMessageFingerprint({
    id: "wamid.1",
    from: "5511988887777",
    kind: "text",
    text: "  Crie   uma cobrança  ",
  });
  const second = whatsappMessageFingerprint({
    id: "wamid.2",
    from: "5511988887777",
    kind: "text",
    text: "crie uma cobrança",
  });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes("cobrança"), false);
});

test("respostas de bloqueio são fixas e bloqueios silenciosos não respondem", () => {
  assert.match(whatsappGuardrailReply("too_long", 1_000)!, /1000 caracteres/);
  assert.match(whatsappGuardrailReply("rate_minute", 1_000)!, /muitas mensagens/);
  assert.match(whatsappGuardrailReply("global_daily", 1_000)!, /limite de uso de hoje/);
  assert.equal(whatsappGuardrailReply("duplicate", 1_000), undefined);
  assert.equal(whatsappGuardrailReply("duplicate_content", 1_000), undefined);
  assert.equal(whatsappGuardrailReply("busy", 1_000), undefined);
});
