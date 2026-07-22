import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretMessage, type AssistantDeps } from "../src/orchestrator.ts";
import type { LlmProvider, LlmToolCall } from "../src/llm.ts";

function fixedLlm(call: LlmToolCall): LlmProvider {
  return { interpret: async () => call };
}

const clients = [
  { id: "8d7461a2-9c4c-4c2c-9d34-454543e6d474", name: "João da Silva", whatsapp: "11988887777" },
];

function deps(overrides: Partial<AssistantDeps> = {}): AssistantDeps {
  return {
    listClients: async () => clients,
    listOverdue: async () => [],
    clientCharges: async () => [],
    financialSummary: async () => ({ aReceberCents: 0, recebidoMesCents: 0, atrasadasCount: 0 }),
    ...overrides,
  };
}

function run(call: LlmToolCall, override: Partial<AssistantDeps> = {}) {
  return interpretMessage({
    providerId: "provider-1",
    message: "qualquer coisa",
    deps: deps(override),
    apiKey: "test-key",
    model: "gpt-5.4-nano",
    llm: fixedLlm(call),
    now: new Date("2026-07-22T12:00:00Z"),
  });
}

test("listar_inadimplentes formata total e linhas", async () => {
  const result = await run({ name: "listar_inadimplentes", arguments: {} }, {
    listOverdue: async () => [
      { clientName: "João", amountCents: 8000, dueDate: "2026-07-10" },
      { clientName: "Maria", amountCents: 12000, dueDate: "2026-07-15" },
    ],
  });
  assert.equal(result.kind, "text");
  assert.match(result.message, /2 cobranças em atraso/);
  assert.match(result.message, /R\$\s?200,00/);
  assert.match(result.message, /João · R\$\s?80,00 · venceu em 10\/07/);
});

test("listar_inadimplentes sem atrasos responde positivo", async () => {
  const result = await run({ name: "listar_inadimplentes", arguments: {} });
  assert.equal(result.kind, "text");
  assert.match(result.message, /Ninguém está em atraso/);
});

test("status_cliente com um match lista as cobranças", async () => {
  const result = await run({ name: "status_cliente", arguments: { clientName: "João" } }, {
    clientCharges: async () => [
      { description: "Lavagem", amountCents: 8000, dueDate: "2026-07-20", status: "paga" },
    ],
  });
  assert.equal(result.kind, "text");
  assert.match(result.message, /Situação de João da Silva/);
  assert.match(result.message, /Lavagem · R\$\s?80,00 · vence 20\/07 · paga/);
});

test("status_cliente ambíguo pede desambiguação", async () => {
  const result = await run({ name: "status_cliente", arguments: { clientName: "a" } }, {
    listClients: async () => [
      { id: "1", name: "Ana", whatsapp: "11900000001" },
      { id: "2", name: "Aline", whatsapp: "11900000002" },
    ],
  });
  assert.equal(result.kind, "clarification");
  assert.match(result.message, /Ana, Aline/);
});

test("status_cliente sem match avisa que não encontrou", async () => {
  const result = await run({ name: "status_cliente", arguments: { clientName: "Fulano" } });
  assert.equal(result.kind, "text");
  assert.match(result.message, /Não encontrei um cliente/);
});

test("resumo_financeiro reporta os três números", async () => {
  const result = await run({ name: "resumo_financeiro", arguments: {} }, {
    financialSummary: async () => ({ aReceberCents: 50000, recebidoMesCents: 30000, atrasadasCount: 2 }),
  });
  assert.equal(result.kind, "text");
  assert.match(result.message, /A receber: R\$\s?500,00/);
  assert.match(result.message, /Recebido no mês: R\$\s?300,00/);
  assert.match(result.message, /2 cobranças atrasadas/);
});

test("pedido_nao_suportado devolve o escopo", async () => {
  const result = await run({ name: "pedido_nao_suportado", arguments: {} });
  assert.equal(result.kind, "text");
  assert.match(result.message, /Ainda não sei fazer isso/);
});

test("preparar_cobranca reaproveita cliente existente", async () => {
  const result = await run({
    name: "preparar_cobranca",
    arguments: {
      clientName: "João",
      clientWhatsapp: null,
      description: "Lavagem do carro",
      amountCents: 8000,
      dueDate: "2026-07-23",
    },
  });
  assert.equal(result.kind, "draft");
  if (result.kind !== "draft") return;
  assert.deepEqual(result.draft.client, clients[0]);
  assert.equal(result.draft.dueDate, "2026-07-23");
});
