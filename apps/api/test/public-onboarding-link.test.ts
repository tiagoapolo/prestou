import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseClient } from "../src/db.ts";

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.DATABASE_SSL = "false";
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.WHATSAPP_SIGNUP_MODE = "public";
process.env.WHATSAPP_ONBOARDING_SECRET = "onboarding-secret";
process.env.WHATSAPP_SIGNUP_PHONE_DAILY_LIMIT = "3";

const {
  startPublicWhatsAppOnboarding,
  startInvitedWhatsAppOnboarding,
  markOnboardingLinkDelivered,
} = await import("../src/whatsapp-onboarding.ts");
const { PUBLIC_SIGNUP_MESSAGE } = await import("../src/public-signup.ts");

const SESSION = {
  id: "3f1d6f2a-1f0e-4a6d-9a1c-2b4c8d0e5f11",
  invite_id: null,
  phone: "41998826061",
  phone_verified_at: "2026-08-07T12:00:00.000Z",
  auth_user_id: null,
  requested_email: null,
  email_requested_at: null,
  expires_at: "2026-08-08T12:00:00.000Z",
  consumed_at: null,
  onboarding_journey_id: "f56c71d1-7121-4907-82c8-d4d5acd544ad",
};

interface FakeState {
  /** Sessão pública viva já existente para o telefone. */
  session?: typeof SESSION;
  /** Token vivo e com entrega confirmada. */
  deliveredToken?: boolean;
  /** Links já entregues hoje para o telefone. */
  phoneDayCount?: number;
}

function fakeDatabase(state: FakeState = {}) {
  const queries: string[] = [];
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const tx: DatabaseClient = {
    async queryAll() { return []; },
    async queryOne(query: string, ...params: unknown[]) {
      queries.push(query);
      calls.push({ query, params });
      if (query.includes("INSERT INTO private.whatsapp_onboarding_counters")) {
        return { count: 1 } as never;
      }
      if (query.includes("SELECT count FROM private.whatsapp_onboarding_counters")) {
        return (state.phoneDayCount === undefined
          ? undefined
          : { count: state.phoneDayCount }) as never;
      }
      // A busca por telefone decide se há sessão a reaproveitar; a releitura por
      // id acontece logo após o INSERT e sempre devolve a sessão recém-criada.
      if (query.includes("FROM private.whatsapp_onboarding_sessions")) {
        return (query.includes("WHERE id = ?") ? SESSION : state.session) as never;
      }
      if (query.includes("FROM private.whatsapp_onboarding_tokens")) {
        return (state.deliveredToken ? { id: "token-vivo" } : undefined) as never;
      }
      return undefined as never;
    },
    async execute(query: string, ...params: unknown[]) {
      queries.push(query);
      calls.push({ query, params });
      return { changes: 1 };
    },
  };
  return {
    queries,
    calls,
    deps: { runTransaction: <T>(fn: (c: DatabaseClient) => Promise<T>) => fn(tx) },
  };
}

// wa_id entregue pela Meta sem o nono dígito, como no número que ficou mudo.
const inbound = {
  id: "wamid.TESTE",
  from: "554198826061",
  kind: "text" as const,
  text: PUBLIC_SIGNUP_MESSAGE,
  receivedAt: "2026-08-07T12:00:00.000Z",
};

test("wa_id sem o nono dígito grava o telefone no formato aceito pelo CHECK da sessão", async () => {
  const { calls, deps } = fakeDatabase();
  const token = await startPublicWhatsAppOnboarding(inbound, deps);

  assert.ok(token, "deveria emitir um link");
  const insertSession = calls.find(({ query }) =>
    query.includes("INSERT INTO private.whatsapp_onboarding_sessions"));
  assert.ok(insertSession, "deveria criar a sessão");

  // whatsapp_onboarding_sessions_phone_check: 11 dígitos com o nono. Gravar o
  // candidato entregue pela Meta (10 dígitos) derrubava a transação inteira e o
  // número ficava mudo, sem sessão, sem token e sem rastro.
  const persistedPhone = insertSession.params.find(
    (param) => typeof param === "string" && /^\d{10,11}$/.test(param));
  assert.equal(persistedPhone, "41998826061");
  assert.match(String(persistedPhone), /^[1-9][0-9]9[0-9]{8}$/);

  // O lock por telefone precisa usar a mesma identidade canônica, senão duas
  // mensagens simultâneas escapariam da serialização.
  const lock = calls.find(({ query }) => query.includes("pg_advisory_xact_lock"));
  assert.deepEqual(lock?.params, ["41998826061"]);
});

test("sessão viva sem link entregue emite um novo token em vez de silenciar", async () => {
  const { queries, deps } = fakeDatabase({ session: SESSION });
  const token = await startPublicWhatsAppOnboarding(inbound, deps);

  assert.ok(token, "link expirado ou não entregue deve ser rotacionado");
  assert.ok(
    !queries.some((q) => q.includes("INSERT INTO private.whatsapp_onboarding_sessions")),
    "a sessão existente deve ser reaproveitada, preservando jornada e atribuição",
  );
  assert.ok(
    queries.some((q) => q.includes("UPDATE private.whatsapp_onboarding_tokens")),
    "o token anterior precisa ser consumido antes de emitir o novo",
  );
  assert.ok(queries.some((q) => q.includes("INSERT INTO private.whatsapp_onboarding_tokens")));
});

test("link entregue e ainda válido não é rotacionado, para não derrubar a página aberta", async () => {
  const { queries, deps } = fakeDatabase({ session: SESSION, deliveredToken: true });
  const token = await startPublicWhatsAppOnboarding(inbound, deps);

  assert.equal(token, undefined);
  assert.ok(!queries.some((q) => q.includes("INSERT INTO private.whatsapp_onboarding_tokens")));
});

test("cota por telefone conta links entregues, não tentativas", async () => {
  const noQuota = fakeDatabase({ phoneDayCount: 3 });
  assert.equal(await startPublicWhatsAppOnboarding(inbound, noQuota.deps), undefined);

  // Duas falhas de envio não gastam cota: o contador só sobe na confirmação.
  const withQuota = fakeDatabase({ phoneDayCount: 2 });
  assert.ok(await startPublicWhatsAppOnboarding(inbound, withQuota.deps));
  assert.ok(
    !withQuota.queries.some((q) =>
      q.includes("INSERT INTO private.whatsapp_onboarding_counters") && q.includes("phone_day")),
    "a emissão não deve cobrar a cota do telefone",
  );
});

test("confirmação de entrega marca o token e só então cobra a cota do telefone", async () => {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const tx: DatabaseClient = {
    async queryAll() { return []; },
    async queryOne(query: string, ...params: unknown[]) {
      calls.push({ query, params });
      return { phone: "41998826061", entry_mode: "public" } as never;
    },
    async execute() { return { changes: 1 }; },
  };
  const deps = { runTransaction: <T>(fn: (c: DatabaseClient) => Promise<T>) => fn(tx) };

  await markOnboardingLinkDelivered("a".repeat(43), deps);

  assert.match(calls[0]?.query ?? "", /SET delivered_at = now\(\)/);
  assert.match(calls[0]?.query ?? "", /delivered_at IS NULL/);
  assert.match(calls[1]?.query ?? "", /INSERT INTO private\.whatsapp_onboarding_counters/);
  assert.deepEqual(calls[1]?.params, ["phone_day", "41998826061"]);
});

test("convite também rotaciona link não entregue, mesma regra da entrada pública", async () => {
  function fakeInviteDatabase(deliveredToken: boolean) {
    const queries: string[] = [];
    const tx: DatabaseClient = {
      async queryAll() { return []; },
      async queryOne(query: string) {
        queries.push(query);
        if (query.includes("whatsapp_signup_invites")) {
          return { id: "convite", phone: "41998826061", status: "claimed" } as never;
        }
        if (query.includes("INSERT INTO private.whatsapp_onboarding_counters")) {
          return { count: 1 } as never;
        }
        if (query.includes("FROM private.whatsapp_onboarding_sessions")) {
          return { ...SESSION, invite_id: "convite" } as never;
        }
        if (query.includes("FROM private.whatsapp_onboarding_tokens")) {
          return (deliveredToken ? { id: "token-vivo" } : undefined) as never;
        }
        return undefined as never;
      },
      async execute(query: string) {
        queries.push(query);
        return { changes: 1 };
      },
    };
    return {
      queries,
      deps: { runTransaction: <T>(fn: (c: DatabaseClient) => Promise<T>) => fn(tx) },
    };
  }

  const naoEntregue = fakeInviteDatabase(false);
  assert.ok(
    await startInvitedWhatsAppOnboarding({ ...inbound, text: "Oi" }, naoEntregue.deps),
    "link que nunca chegou deve ser reemitido",
  );
  assert.ok(
    naoEntregue.queries.some((q) =>
      q.includes("INSERT INTO private.whatsapp_onboarding_tokens")),
  );

  const entregue = fakeInviteDatabase(true);
  assert.equal(
    await startInvitedWhatsAppOnboarding({ ...inbound, text: "Oi" }, entregue.deps),
    undefined,
    "link entregue e válido continua preservando a página aberta",
  );
});

test("token fora do formato não chega ao banco", async () => {
  let touched = false;
  await markOnboardingLinkDelivered("curto-demais", {
    runTransaction: async () => { touched = true; return undefined as never; },
  });
  assert.equal(touched, false);
});
