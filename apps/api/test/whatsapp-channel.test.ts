import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  chargeConfirmationPayload,
  parseInboundMessage,
  parseWhatsAppChargeAction,
  renderResult,
  verifySignature,
  whatsappChargeActionId,
  whatsappIdentityCandidates,
} from "../src/channels/whatsapp.ts";

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
          messages: [{ id: "wamid.text-1", from: "5511988887777", type: "text", text: { body: "  quem me deve?  " } }],
        },
      }],
    }],
  };
  assert.deepEqual(parseInboundMessage(payload), {
    id: "wamid.text-1",
    from: "5511988887777",
    kind: "text",
    text: "quem me deve?",
  });
});

test("parseInboundMessage extrai clique em botão interativo", () => {
  const id = "charge:create:550e8400-e29b-41d4-a716-446655440000";
  const payload = {
    entry: [{ changes: [{ value: { messages: [{
      id: "wamid.button-1",
      from: "5511988887777",
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id, title: "Criar cobrança" } },
    }] } }] }],
  };
  assert.deepEqual(parseInboundMessage(payload), {
    id: "wamid.button-1",
    from: "5511988887777",
    kind: "button",
    buttonId: id,
  });
});

test("parseInboundMessage ignora payloads sem mensagem (status update)", () => {
  const payload = { entry: [{ changes: [{ value: { statuses: [{ status: "delivered" }] } }] }] };
  assert.equal(parseInboundMessage(payload), undefined);
  assert.equal(parseInboundMessage({}), undefined);
  assert.equal(parseInboundMessage(null), undefined);
});

test("parseInboundMessage exige o ID da Meta para permitir deduplicação", () => {
  const payload = {
    entry: [{ changes: [{ value: { messages: [{
      from: "5511988887777",
      type: "text",
      text: { body: "mensagem sem id" },
    }] } }] }],
  };
  assert.equal(parseInboundMessage(payload), undefined);
});

test("whatsappIdentityCandidates considera o nono dígito brasileiro", () => {
  assert.deepEqual(
    whatsappIdentityCandidates("554199735882"),
    ["554199735882", "5541999735882"],
  );
  assert.deepEqual(
    whatsappIdentityCandidates("5541999735882"),
    ["5541999735882", "554199735882"],
  );
  assert.deepEqual(
    whatsappIdentityCandidates("15551234567"),
    ["15551234567", "15551234567"],
  );
});

test("ação e payload dos botões usam somente o ID da proposta", () => {
  const proposalId = "550e8400-e29b-41d4-a716-446655440000";
  const createId = whatsappChargeActionId("create", proposalId);
  assert.deepEqual(parseWhatsAppChargeAction(createId), {
    action: "create",
    proposalId,
  });
  assert.equal(parseWhatsAppChargeAction("charge:create:inválido"), undefined);

  const payload = chargeConfirmationPayload("5511988887777", "Confirme", proposalId);
  assert.equal(payload.type, "interactive");
  assert.deepEqual(
    payload.interactive.action.buttons.map((button) => button.reply.title),
    ["Criar cobrança", "Cancelar"],
  );
  assert.equal(JSON.stringify(payload).includes("amountCents"), false);
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
