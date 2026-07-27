import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseClient } from "../src/db.ts";

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.DATABASE_SSL = "false";
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const {
  assertWhatsAppServiceWindowOpen,
  getWhatsAppServiceWindow,
  recordWhatsAppInbound,
} = await import("../src/whatsapp-service-window.ts");

function fakeDatabase(row?: {
  last_inbound_at: string;
  expires_at: string;
  is_open: boolean;
}) {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const client: DatabaseClient = {
    async queryAll() { return []; },
    async queryOne() { return row; },
    async execute(query, ...params) {
      calls.push({ query, params });
      return { changes: 1 };
    },
  };
  return { client, calls };
}

test("registra o timestamp oficial do inbound sem permitir regressão no upsert", async () => {
  const { client, calls } = fakeDatabase();
  const receivedAt = new Date("2026-07-27T16:00:00.000Z");

  await recordWhatsAppInbound("+55 (11) 98888-7777", receivedAt, client);

  assert.deepEqual(calls[0]?.params, ["5511988887777", receivedAt]);
  assert.match(calls[0]?.query ?? "", /GREATEST/);
});

test("normaliza o wa_id brasileiro antigo para o mesmo número móvel", async () => {
  const { client, calls } = fakeDatabase();
  await recordWhatsAppInbound("554199735882", new Date("2026-07-27T16:00:00.000Z"), client);
  assert.equal(calls[0]?.params[0], "5541999735882");
});

test("retorna janela fechada quando o número nunca enviou mensagem", async () => {
  const { client } = fakeDatabase();
  assert.deepEqual(await getWhatsAppServiceWindow("5511988887777", client), {
    isOpen: false,
    lastInboundAt: null,
    expiresAt: null,
  });
});

test("retorna os limites da janela e bloqueia mensagem livre quando encerrada", async () => {
  const closed = fakeDatabase({
    last_inbound_at: "2026-07-26 16:00:00+00",
    expires_at: "2026-07-27 16:00:00+00",
    is_open: false,
  });

  assert.deepEqual(await getWhatsAppServiceWindow("5511988887777", closed.client), {
    isOpen: false,
    lastInboundAt: "2026-07-26T16:00:00.000Z",
    expiresAt: "2026-07-27T16:00:00.000Z",
  });
  await assert.rejects(
    assertWhatsAppServiceWindowOpen("5511988887777", closed.client),
    /use um template aprovado/,
  );
});

test("permite mensagem livre enquanto a janela está aberta", async () => {
  const open = fakeDatabase({
    last_inbound_at: "2026-07-27 16:00:00+00",
    expires_at: "2026-07-28 16:00:00+00",
    is_open: true,
  });
  await assert.doesNotReject(
    assertWhatsAppServiceWindowOpen("5511988887777", open.client),
  );
});
