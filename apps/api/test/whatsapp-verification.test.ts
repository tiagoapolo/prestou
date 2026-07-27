import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { seedInvitedOnboarding } from "./onboarding-fixture.ts";

// Testes de integração da verificação de número. Exigem um Supabase de teste,
// como o fluxo principal — pulados quando as variáveis TEST_* não existem.
const integrationEnv = {
  databaseUrl: process.env.TEST_DATABASE_URL,
  supabaseUrl: process.env.TEST_SUPABASE_URL,
  anonKey: process.env.TEST_SUPABASE_ANON_KEY,
  serviceRoleKey: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
};

if (Object.values(integrationEnv).some((value) => !value)) {
  test("verificação de número requer projeto Supabase de teste", {
    skip: "Configure as variáveis TEST_* documentadas em apps/api/.env.example",
  }, () => {});
} else {
process.env.DATABASE_URL = integrationEnv.databaseUrl;
process.env.SUPABASE_URL = integrationEnv.supabaseUrl;
process.env.SUPABASE_ANON_KEY = integrationEnv.anonKey;
process.env.SUPABASE_SERVICE_ROLE_KEY = integrationEnv.serviceRoleKey;
// Modo cloud-api + fetch instrumentado: exercita a entrega real do OTP por
// template, a propagação de falha e a redação do código.
process.env.WHATSAPP_MODE = "cloud-api";
process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
process.env.WHATSAPP_AUTH_TEMPLATE = "prestou_codigo_verificacao";
process.env.WHATSAPP_APP_SECRET = "test-app-secret";
process.env.WHATSAPP_SIGNUP_ENABLED = "true";
process.env.WHATSAPP_SIGNUP_TEMPLATE = "convite_prestador";
process.env.WHATSAPP_VERIFICATION_RESEND_SECONDS = "60";
process.env.WHATSAPP_VERIFICATION_PROVIDER_DAILY = "3";
process.env.LOG_LEVEL = "silent";
process.env.NODE_ENV = "test";

const { buildServer } = await import("../src/server.ts");
const { db, execute, queryOne } = await import("../src/db.ts");
const { purgeExpiredWhatsAppOnboarding } = await import("../src/whatsapp-onboarding.ts");

const admin = createClient(integrationEnv.supabaseUrl!, integrationEnv.serviceRoleKey!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const authClient = createClient(integrationEnv.supabaseUrl!, integrationEnv.anonKey!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let app: Awaited<ReturnType<typeof buildServer>>;
const authUserIds: string[] = [];
const providerIds: string[] = [];
const candidatePhones = new Set<string>();

// Instrumentação do fetch: só intercepta a Graph API da Meta; todo o resto
// (Supabase) passa direto. Captura o código enviado por número de destino e
// permite simular falha de entrega.
const realFetch = globalThis.fetch;
const sentCodes = new Map<string, string>();
const sentTexts = new Map<string, string[]>();
const sentTemplates = new Map<string, unknown[]>();
let failDelivery = false;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  if (!url.includes("graph.facebook.com")) return realFetch(input, init);

  if (failDelivery) {
    return new Response("meta unavailable", { status: 503 });
  }
  const payload = JSON.parse(String(init?.body ?? "{}"));
  if (payload.to && payload.template) {
    const templates = sentTemplates.get(payload.to) ?? [];
    templates.push(payload.template);
    sentTemplates.set(payload.to, templates);
  }
  const bodyComponent = payload.template?.components?.find(
    (component: { type: string }) => component.type === "body",
  );
  const code = bodyComponent?.parameters?.[0]?.text;
  if (payload.to && code) sentCodes.set(payload.to, code);
  if (payload.to && payload.text?.body) {
    const messages = sentTexts.get(payload.to) ?? [];
    messages.push(payload.text.body);
    sentTexts.set(payload.to, messages);
  }
  return new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), { status: 200 });
}) as typeof fetch;

async function createProvider(label: string, whatsapp: string): Promise<{ token: string; id: string }> {
  const email = `prestou-verif-${label}-${crypto.randomUUID()}@example.com`;
  const password = `T3st-${crypto.randomUUID()}!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  authUserIds.push(created.data.user!.id);
  const signedIn = await authClient.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  const token = signedIn.data.session!.access_token;
  const onboardingToken = await seedInvitedOnboarding(db, {
    authUserId: created.data.user!.id,
    phone: whatsapp,
    secret: integrationEnv.serviceRoleKey!,
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/providers",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: `Prestador ${label}`,
      profession: "Testes",
      onboardingToken,
      pixKey: `${label}@prestou.com`,
      consent: true,
    },
  });
  assert.equal(res.statusCode, 201);
  providerIds.push(res.json().provider.id);
  return { token, id: res.json().provider.id };
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function start(token: string, phone: string) {
  candidatePhones.add(phone);
  return app.inject({
    method: "POST",
    url: "/api/whatsapp/number/start",
    headers: authHeader(token),
    payload: { phone },
  });
}

async function confirm(token: string, code: string) {
  return app.inject({
    method: "POST",
    url: "/api/whatsapp/number/confirm",
    headers: authHeader(token),
    payload: { code },
  });
}

before(async () => {
  app = await buildServer();
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const id of providerIds) {
    await execute(
      "DELETE FROM private.whatsapp_verification_sends WHERE scope = 'provider_day' AND scope_id = ?",
      id,
    );
  }
  for (const phone of candidatePhones) {
    await execute(
      "DELETE FROM private.whatsapp_verification_sends WHERE scope = 'candidate_day' AND scope_id = ?",
      phone,
    );
  }
  await execute(
    "DELETE FROM private.whatsapp_verification_sends WHERE scope = 'global_day' AND scope_id = 'all' AND window_start = date_trunc('day', now())",
  );
  for (const id of authUserIds) {
    await execute("DELETE FROM private.whatsapp_signup_invites WHERE created_by = ?", id);
  }
  await Promise.all(authUserIds.map((id) => admin.auth.admin.deleteUser(id)));
  await app.close();
});

test("falha de entrega da Meta não confirma envio nem reserva o candidato", async () => {
  const { token } = await createProvider("meta-fail", "11930000001");
  const candidate = "11931110001";

  failDelivery = true;
  const res = await start(token, candidate);
  failDelivery = false;

  assert.equal(res.statusCode, 502);
  assert.notEqual(res.json().sent, true);

  // A reserva foi liberada: nada pendente e o candidato pode ser usado de novo.
  const status = await app.inject({
    method: "GET",
    url: "/api/whatsapp/number",
    headers: authHeader(token),
  });
  assert.equal(status.json().pendingCandidate, null);
});

test("o código não é persistido em texto puro em notifications.body", async () => {
  const { id, token } = await createProvider("redaction", "11930000002");
  const candidate = "11931110002";

  const res = await start(token, candidate);
  assert.equal(res.statusCode, 200);

  const code = sentCodes.get(`55${candidate}`);
  assert.match(code ?? "", /^\d{6}$/); // o código real saiu no template

  const note = await queryOne<{ body: string }>(
    `SELECT body FROM notifications
      WHERE provider_id = ? AND kind = 'whatsapp_verification'
      ORDER BY created_at DESC LIMIT 1`,
    id,
  );
  assert.ok(note);
  assert.doesNotMatch(note!.body, /\d{6}/); // corpo redigido, sem o código
});

test("código expirado é rejeitado e o número volta a ficar disponível", async () => {
  const first = await createProvider("expire-a", "11930000003");
  const candidate = "11931110003";

  const started = await start(first.token, candidate);
  assert.equal(started.statusCode, 200);

  // Expira a verificação como o tempo faria.
  await execute(
    "UPDATE private.whatsapp_verifications SET expires_at = now() - interval '1 minute' WHERE provider_id = ?",
    first.id,
  );
  const expired = await confirm(first.token, sentCodes.get(`55${candidate}`)!);
  assert.equal(expired.statusCode, 410);

  // Outro prestador consegue verificar o mesmo número (reserva foi liberada).
  const second = await createProvider("expire-b", "11930000004");
  const reused = await start(second.token, candidate);
  assert.equal(reused.statusCode, 200);
  const ok = await confirm(second.token, sentCodes.get(`55${candidate}`)!);
  assert.equal(ok.statusCode, 200);
});

test("reenvio dentro do cooldown é bloqueado", async () => {
  const { token } = await createProvider("cooldown", "11930000005");
  const candidate = "11931110005";

  assert.equal((await start(token, candidate)).statusCode, 200);
  const again = await start(token, candidate);
  assert.equal(again.statusCode, 429);
});

test("teto diário de envio por prestador é aplicado atomicamente", async () => {
  const { id, token } = await createProvider("rate", "11930000006");
  const candidate = "11931110006";

  // Semeia o contador do dia no limite configurado (3); o próximo envio estoura.
  await execute(
    `INSERT INTO private.whatsapp_verification_sends (scope, scope_id, window_start, count)
     VALUES ('provider_day', ?, date_trunc('day', now()), 3)`,
    id,
  );
  const res = await start(token, candidate);
  assert.equal(res.statusCode, 429);
});

test("confirmações concorrentes promovem o número uma única vez", async () => {
  const { id, token } = await createProvider("concurrent", "11930000007");
  const candidate = "11931110007";

  assert.equal((await start(token, candidate)).statusCode, 200);
  const code = sentCodes.get(`55${candidate}`)!;

  const [a, b] = await Promise.all([confirm(token, code), confirm(token, code)]);
  const codes = [a.statusCode, b.statusCode].sort();
  assert.deepEqual(codes, [200, 404]); // um confirma, o outro não acha mais a verificação

  const provider = await queryOne<{ whatsapp: string }>(
    "SELECT whatsapp FROM providers WHERE id = ?",
    id,
  );
  assert.equal(provider!.whatsapp, candidate);
});

test("promoção perde a corrida para outra conta e retorna 409", async () => {
  const racer = await createProvider("promote-a", "11930000008");
  const candidate = "11931110008";

  assert.equal((await start(racer.token, candidate)).statusCode, 200);
  const code = sentCodes.get(`55${candidate}`)!;

  // Outra conta assume o número antes de a confirmação promover.
  const owner = await createProvider("promote-b", "11930000009");
  await execute(
    "UPDATE providers SET whatsapp = ?, whatsapp_verified_at = now() WHERE id = ?",
    candidate,
    owner.id,
  );

  const res = await confirm(racer.token, code);
  assert.equal(res.statusCode, 409);
});

test("administrador cria, lista e revoga convite para um número", async () => {
  const inviter = await createProvider("invite-admin", "11930000010");
  const authUser = await queryOne<{ auth_user_id: string }>(
    "SELECT auth_user_id FROM providers WHERE id = ?",
    inviter.id,
  );
  assert.ok(authUser);

  const forbidden = await app.inject({
    method: "POST",
    url: "/api/admin/whatsapp-invites",
    headers: authHeader(inviter.token),
    payload: { phone: "11932220002", expiresInDays: 7 },
  });
  assert.equal(forbidden.statusCode, 403);

  await execute(
    "INSERT INTO private.app_admins (auth_user_id) VALUES (?) ON CONFLICT DO NOTHING",
    authUser!.auth_user_id,
  );

  const failedPhone = "11932220004";
  failDelivery = true;
  const failed = await app.inject({
    method: "POST",
    url: "/api/admin/whatsapp-invites",
    headers: authHeader(inviter.token),
    payload: { phone: failedPhone, expiresInDays: 7 },
  });
  failDelivery = false;
  assert.equal(failed.statusCode, 502);
  const compensated = await queryOne<{ status: string }>(
    `SELECT status FROM private.whatsapp_signup_invites
      WHERE phone = ? ORDER BY created_at DESC LIMIT 1`,
    failedPhone,
  );
  assert.equal(compensated?.status, "revoked");

  const phone = "11932220002";
  const created = await app.inject({
    method: "POST",
    url: "/api/admin/whatsapp-invites",
    headers: authHeader(inviter.token),
    payload: { phone, expiresInDays: 7 },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().invite.phone, phone);
  assert.equal(created.json().invite.status, "pending");
  assert.deepEqual(sentTemplates.get(`55${phone}`)?.at(-1), {
    name: "convite_prestador",
    language: { code: "pt_BR" },
    components: [{
      type: "button",
      sub_type: "quick_reply",
      index: "0",
      parameters: [{ type: "payload", payload: "signup:confirm" }],
    }],
  });

  const listed = await app.inject({
    method: "GET",
    url: "/api/admin/whatsapp-invites",
    headers: authHeader(inviter.token),
  });
  assert.equal(listed.statusCode, 200);
  assert.ok(listed.json().invites.some(
    (invite: { id: string }) => invite.id === created.json().invite.id,
  ));

  const revoked = await app.inject({
    method: "POST",
    url: `/api/admin/whatsapp-invites/${created.json().invite.id}/revoke`,
    headers: authHeader(inviter.token),
  });
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.json().revoked, true);
});

test("somente administrador lista prestadores registrados", async () => {
  const viewer = await createProvider("provider-list-admin", "11930000011");

  const forbidden = await app.inject({
    method: "GET",
    url: "/api/admin/providers",
    headers: authHeader(viewer.token),
  });
  assert.equal(forbidden.statusCode, 403);

  const authUser = await queryOne<{ auth_user_id: string }>(
    "SELECT auth_user_id FROM providers WHERE id = ?",
    viewer.id,
  );
  assert.ok(authUser);
  await execute(
    "INSERT INTO private.app_admins (auth_user_id) VALUES (?) ON CONFLICT DO NOTHING",
    authUser!.auth_user_id,
  );

  const listed = await app.inject({
    method: "GET",
    url: "/api/admin/providers?q=provider-list-admin",
    headers: authHeader(viewer.token),
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().providers.length, 1);
  assert.equal(listed.json().providers[0].name, "Prestador provider-list-admin");
  assert.equal(listed.json().providers[0].whatsapp, "11930000011");
  assert.equal(listed.json().nextCursor, null);
});

test("retenção remove somente usuário Auth provisório abandonado", async () => {
  const created = await admin.auth.admin.createUser({
    email: `prestou-abandoned-${crypto.randomUUID()}@example.com`,
    email_confirm: false,
  });
  assert.ifError(created.error);
  const userId = created.data.user!.id;
  await execute(
    `INSERT INTO private.whatsapp_onboarding_auth_users (auth_user_id, created_at)
     VALUES (?, now() - interval '2 days')`,
    userId,
  );

  const result = await purgeExpiredWhatsAppOnboarding();
  assert.equal(result.authUserDeleteFailures, 0);
  assert.ok(result.authUsersDeleted >= 1);
  const lookup = await admin.auth.admin.getUserById(userId);
  assert.ok(lookup.error);
});

test("número desconhecido sem convite não recebe resposta nem cria onboarding", async () => {
  const phone = "11932220003";
  const messageId = `wamid.${crypto.randomUUID()}`;
  const payload = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{
      id: messageId,
      from: `55${phone}`,
      text: { body: "Quero me cadastrar" },
    }] } }] }],
  });
  const signature = `sha256=${createHmac("sha256", "test-app-secret").update(payload).digest("hex")}`;
  const response = await app.inject({
    method: "POST",
    url: "/api/whatsapp/webhook",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    payload,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(sentTexts.has(`55${phone}`), false);
  const persisted = await queryOne<{ message_id: string }>(
    "SELECT message_id FROM private.whatsapp_onboarding_messages WHERE message_id = ?",
    messageId,
  );
  assert.equal(persisted, undefined);
});

test("número convidado recebe link pelo webhook assinado sem passar pela LLM", async () => {
  const created = await admin.auth.admin.createUser({
    email: `prestou-invite-${crypto.randomUUID()}@example.com`,
    email_confirm: true,
  });
  assert.ifError(created.error);
  const creatorId = created.data.user!.id;
  authUserIds.push(creatorId);
  const inviteId = crypto.randomUUID();
  const phone = "11932220001";
  await execute(
    `INSERT INTO private.whatsapp_signup_invites
       (id, phone, created_by, expires_at)
     VALUES (?, ?, ?, now() + interval '1 day')`,
    inviteId,
    phone,
    creatorId,
  );

  const payload = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{
      id: `wamid.${crypto.randomUUID()}`,
      from: `55${phone}`,
      text: { body: "Quero me cadastrar" },
    }] } }] }],
  });
  const signature = `sha256=${createHmac("sha256", "test-app-secret").update(payload).digest("hex")}`;
  const unsigned = await app.inject({
    method: "POST",
    url: "/api/whatsapp/webhook",
    headers: { "content-type": "application/json" },
    payload,
  });
  assert.equal(unsigned.statusCode, 401);

  const first = await app.inject({
    method: "POST",
    url: "/api/whatsapp/webhook",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    payload,
  });
  assert.equal(first.statusCode, 200);
  assert.match(sentTexts.get(`55${phone}`)?.[0] ?? "", /\/cadastro\?token=/);

  const session = await queryOne<{ phone_verified_at: string }>(
    "SELECT phone_verified_at FROM private.whatsapp_onboarding_sessions WHERE invite_id = ?",
    inviteId,
  );
  assert.ok(session?.phone_verified_at);

  const replay = await app.inject({
    method: "POST",
    url: "/api/whatsapp/webhook",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    payload,
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(sentTexts.get(`55${phone}`)?.length, 1);

  // Uma mensagem nova durante a validade do link também fica silenciosa: não
  // gira o token que o usuário pode já ter aberto e não amplifica respostas.
  const secondPayload = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{
      id: `wamid.${crypto.randomUUID()}`,
      from: `55${phone}`,
      text: { body: "Manda o link de novo" },
    }] } }] }],
  });
  const secondSignature = `sha256=${createHmac("sha256", "test-app-secret").update(secondPayload).digest("hex")}`;
  const second = await app.inject({
    method: "POST",
    url: "/api/whatsapp/webhook",
    headers: { "content-type": "application/json", "x-hub-signature-256": secondSignature },
    payload: secondPayload,
  });
  assert.equal(second.statusCode, 200);
  assert.equal(sentTexts.get(`55${phone}`)?.length, 1);
});
}
