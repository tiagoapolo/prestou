import { test } from "node:test";
import assert from "node:assert/strict";
import { AssistantServiceError, interpretChargeMessage } from "../src/assistant.ts";

const clients = [
  { id: "8d7461a2-9c4c-4c2c-9d34-454543e6d474", name: "João da Silva", whatsapp: "11988887777" },
];

function openAiFetch(
  argumentsValue: Record<string, unknown>,
  inspect?: (request: RequestInit) => void,
): typeof fetch {
  return async (_input, init) => {
    inspect?.(init ?? {});
    return new Response(JSON.stringify({
      output: [{
        type: "function_call",
        name: "preparar_cobranca",
        arguments: JSON.stringify(argumentsValue),
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

const complete = {
  clientName: "João",
  clientWhatsapp: null,
  description: "Lavagem do carro",
  amountCents: 8000,
  dueDate: "2026-07-22",
};

test("prepara rascunho para cliente existente sem enviar a agenda ao modelo", async () => {
  let requestBody = "";
  const result = await interpretChargeMessage("cobra 80 do João pela lavagem amanhã", {
    apiKey: "test-key",
    model: "gpt-5.4-nano",
    providerId: "provider-1",
    clients,
    now: new Date("2026-07-21T15:00:00Z"),
    fetchImpl: openAiFetch(complete, (request) => {
      requestBody = String(request.body);
    }),
  });

  assert.equal(result.kind, "draft");
  if (result.kind !== "draft") return;
  assert.deepEqual(result.draft, {
    client: clients[0],
    description: "Lavagem do carro",
    amountCents: 8000,
    dueDate: "2026-07-22",
  });

  const outbound = JSON.parse(requestBody);
  assert.equal(outbound.model, "gpt-5.4-nano");
  assert.equal(outbound.store, false);
  assert.equal(outbound.tools.length, 1);
  assert.equal(requestBody.includes(clients[0]!.whatsapp), false);
  assert.equal(requestBody.includes(clients[0]!.name), false);
  assert.match(outbound.instructions, /2026-07-21/);
});

test("pede WhatsApp quando o cliente ainda não existe", async () => {
  const result = await interpretChargeMessage("cobra 80 da Maria", {
    apiKey: "test-key",
    model: "gpt-5.4-nano",
    providerId: "provider-1",
    clients,
    fetchImpl: openAiFetch({ ...complete, clientName: "Maria" }),
  });

  assert.deepEqual(result, {
    kind: "clarification",
    message: "Para preparar a cobrança, informe o WhatsApp de Maria.",
  });
});

test("aceita cliente novo quando a frase contém WhatsApp válido", async () => {
  const result = await interpretChargeMessage("cobra 80 da Maria no 11977776666", {
    apiKey: "test-key",
    model: "gpt-5.4-nano",
    providerId: "provider-1",
    clients,
    fetchImpl: openAiFetch({
      ...complete,
      clientName: "Maria",
      clientWhatsapp: "(11) 97777-6666",
    }),
  });

  assert.equal(result.kind, "draft");
  if (result.kind !== "draft") return;
  assert.deepEqual(result.draft.client, { name: "Maria", whatsapp: "11977776666" });
});

test("não escolhe um cliente quando nome e WhatsApp apontam para pessoas diferentes", async () => {
  const result = await interpretChargeMessage("cobra 80 do João no 11977776666", {
    apiKey: "test-key",
    model: "gpt-5.4-nano",
    providerId: "provider-1",
    clients: [
      ...clients,
      { id: "38bb7152-38cf-491d-9dc4-d762f59bb4fc", name: "Maria", whatsapp: "11977776666" },
    ],
    fetchImpl: openAiFetch({ ...complete, clientWhatsapp: "11977776666" }),
  });

  assert.deepEqual(result, {
    kind: "clarification",
    message: "Para preparar a cobrança, informe o nome e o WhatsApp do cliente, pois correspondem a cadastros diferentes.",
  });
});

test("usa o vencimento padrão quando a mensagem não informa uma data", async () => {
  const result = await interpretChargeMessage("cobra o João", {
    apiKey: "test-key",
    model: "gpt-5.4-nano",
    providerId: "provider-1",
    clients,
    defaultDueDays: 15,
    now: new Date("2026-07-21T15:00:00Z"),
    fetchImpl: openAiFetch({
      clientName: "João",
      clientWhatsapp: null,
      description: null,
      amountCents: null,
      dueDate: null,
    }),
  });

  assert.deepEqual(result, {
    kind: "clarification",
    message: "Para preparar a cobrança, informe o serviço, o valor.",
  });
});

test("preenche D+15 no rascunho quando os outros campos estão completos", async () => {
  const result = await interpretChargeMessage("cobra 80 do João pela lavagem", {
    apiKey: "test-key",
    model: "gpt-5.4-nano",
    providerId: "provider-1",
    clients,
    defaultDueDays: 15,
    now: new Date("2026-07-21T15:00:00Z"),
    fetchImpl: openAiFetch({ ...complete, dueDate: null }),
  });

  assert.equal(result.kind, "draft");
  if (result.kind !== "draft") return;
  assert.equal(result.draft.dueDate, "2026-08-05");
});

test("falha de forma controlada quando a OpenAI fica indisponível", async () => {
  await assert.rejects(
    interpretChargeMessage("cobra 80 do João", {
      apiKey: "test-key",
      model: "gpt-5.4-nano",
      providerId: "provider-1",
      clients,
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    }),
    (error) => error instanceof AssistantServiceError && error.statusCode === 502,
  );
});
