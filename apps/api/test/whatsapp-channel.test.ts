import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parseInboundMessage, renderResult, verifySignature } from "../src/channels/whatsapp.ts";

const secret = "app-secret";
const body = JSON.stringify({ hello: "world" });
const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

test("verifySignature aceita assinatura válida da Meta", () => {
  assert.equal(verifySignature(secret, body, signature), true);
});

test("verifySignature rejeita corpo adulterado, header ausente e prefixo errado", () => {
  assert.equal(verifySignature(secret, `${body} `, signature), false);
  assert.equal(verifySignature(secret, body, undefined), false);
  assert.equal(verifySignature(secret, body, "abc"), false);
  assert.equal(verifySignature("", body, signature), false);
});

test("parseInboundMessage extrai a primeira mensagem de texto", () => {
  const payload = {
    entry: [{
      changes: [{
        value: {
          messages: [{ from: "5511988887777", type: "text", text: { body: "  quem me deve?  " } }],
        },
      }],
    }],
  };
  assert.deepEqual(parseInboundMessage(payload), { from: "5511988887777", text: "quem me deve?" });
});

test("parseInboundMessage ignora payloads sem mensagem (status update)", () => {
  const payload = { entry: [{ changes: [{ value: { statuses: [{ status: "delivered" }] } }] }] };
  assert.equal(parseInboundMessage(payload), undefined);
  assert.equal(parseInboundMessage({}), undefined);
  assert.equal(parseInboundMessage(null), undefined);
});

test("renderResult transforma texto e rascunho em mensagem", () => {
  assert.equal(renderResult({ kind: "text", message: "olá" }), "olá");
  const draft = renderResult({
    kind: "draft",
    message: "Rascunho pronto.",
    draft: {
      client: { name: "João", whatsapp: "11988887777" },
      description: "Lavagem",
      amountCents: 8000,
      dueDate: "2026-07-23",
    },
  });
  assert.match(draft, /Cliente: João/);
  assert.match(draft, /R\$\s?80,00/);
});
