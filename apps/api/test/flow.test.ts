import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const integrationEnv = {
  databaseUrl: process.env.TEST_DATABASE_URL,
  supabaseUrl: process.env.TEST_SUPABASE_URL,
  anonKey: process.env.TEST_SUPABASE_ANON_KEY,
  serviceRoleKey: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
};

if (Object.values(integrationEnv).some((value) => !value)) {
  test("fluxo integrado da API requer projeto Supabase de teste", {
    skip: "Configure as variáveis TEST_* documentadas em apps/api/.env.example",
  }, () => {});
} else {
process.env.DATABASE_URL = integrationEnv.databaseUrl;
process.env.SUPABASE_URL = integrationEnv.supabaseUrl;
process.env.SUPABASE_ANON_KEY = integrationEnv.anonKey;
process.env.SUPABASE_SERVICE_ROLE_KEY = integrationEnv.serviceRoleKey;
process.env.WHATSAPP_MODE = "log";
process.env.LOG_LEVEL = "silent";
process.env.NODE_ENV = "test";

const { buildServer } = await import("../src/server.ts");
const admin = createClient(integrationEnv.supabaseUrl!, integrationEnv.serviceRoleKey!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const authClient = createClient(integrationEnv.supabaseUrl!, integrationEnv.anonKey!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let app: Awaited<ReturnType<typeof buildServer>>;
let token: string;
let primaryIdentity: AuthIdentity;
const authUserIds: string[] = [];

interface AuthIdentity {
  token: string;
  email: string;
  password: string;
}

async function createAuthIdentity(label: string): Promise<AuthIdentity> {
  const email = `prestou-test-${label}-${crypto.randomUUID()}@example.com`;
  const password = `T3st-${crypto.randomUUID()}!`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(created.error);
  authUserIds.push(created.data.user!.id);
  const signedIn = await authClient.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  return { token: signedIn.data.session!.access_token, email, password };
}

async function createAuthUser(label: string): Promise<string> {
  return (await createAuthIdentity(label)).token;
}

before(async () => {
  app = await buildServer();
  primaryIdentity = await createAuthIdentity("primary");
  token = primaryIdentity.token;
  const res = await app.inject({
    method: "POST",
    url: "/api/providers",
    headers: auth(),
    payload: {
      name: "João Jardineiro",
      profession: "Jardinagem",
      whatsapp: "11988887777",
      pixKey: "11999998888",
      municipality: { name: "São Paulo", state: "SP", ibgeCode: "3550308" },
      consent: true,
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.provider.pixKeyType, "phone");
});

after(async () => {
  await app.close();
  await Promise.all(
    authUserIds.map((id) => admin.auth.admin.deleteUser(id)),
  );
});

function auth() {
  return { authorization: `Bearer ${token}` };
}

async function createCharge(amountCents = 15007, dueDate = "2026-07-20") {
  const res = await app.inject({
    method: "POST",
    url: "/api/charges",
    headers: auth(),
    payload: {
      client: { name: "Maria Cliente", whatsapp: "11977776666" },
      description: "Corte de grama",
      amountCents,
      dueDate,
      fillMs: 42_000,
    },
  });
  assert.equal(res.statusCode, 201);
  return res.json();
}

test("rejeita acesso sem token", async () => {
  const res = await app.inject({ method: "GET", url: "/api/charges" });
  assert.equal(res.statusCode, 401);
});

test("F1 — rejeita onboarding com chave Pix inválida", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/providers",
    headers: auth(),
    payload: {
      name: "Teste",
      profession: "Teste",
      whatsapp: "11988887777",
      pixKey: "chave-invalida",
      consent: true,
    },
  });
  assert.equal(res.statusCode, 400);
});

test("prestador consulta e altera apenas suas configurações de recebimento", async () => {
  const current = await app.inject({
    method: "GET",
    url: "/api/providers/me/settings",
    headers: auth(),
  });
  assert.equal(current.statusCode, 200);
  assert.equal(current.json().settings.pixKey, "+5511999998888");

  const updated = await app.inject({
    method: "PATCH",
    url: "/api/providers/me/settings",
    headers: auth(),
    payload: {
      pixKey: "joao@prestou.com",
      whatsapp: "(11) 97777-6655",
    },
  });
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(updated.json().settings, {
    pixKey: "joao@prestou.com",
    whatsapp: "11977776655",
  });

  const provider = await app.inject({
    method: "GET",
    url: "/api/providers/me",
    headers: auth(),
  });
  assert.equal(provider.json().provider.pixKeyType, "email");
  assert.equal(provider.json().provider.whatsapp, "11977776655");

  const invalid = await app.inject({
    method: "PATCH",
    url: "/api/providers/me/settings",
    headers: auth(),
    payload: { pixKey: "inválida", whatsapp: "11977776655" },
  });
  assert.equal(invalid.statusCode, 400);
});

test("F2/F3 — cria cobrança com BR Code e mensagem pronta", async () => {
  const body = await createCharge();
  assert.equal(body.payment.status, "em_aberto");
  assert.ok(body.payment.publicToken);
  assert.match(body.payment.paymentUrl, /\/pay\//);
  // F4: deeplink wa.me com a mensagem pré-preenchida
  assert.match(body.whatsapp.deeplink, /^https:\/\/wa\.me\/5511977776666\?text=/);
  assert.match(body.whatsapp.message, /R\$\s?150,07/);
});

test("F5 — página pública expõe só o necessário e não vaza dados do cliente", async () => {
  const charge = await createCharge();
  const res = await app.inject({
    method: "GET",
    url: `/public/pay/${charge.payment.publicToken}`,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.provider.name, "João Jardineiro");
  assert.equal(body.description, "Corte de grama");
  assert.ok(body.brCode.startsWith("000201"));
  // Nenhum dado do cliente final na resposta pública.
  assert.equal(JSON.stringify(body).includes("Maria"), false);
  assert.equal(JSON.stringify(body).includes("11977776666"), false);
});

test("QR sob demanda devolve SVG", async () => {
  const charge = await createCharge();
  const res = await app.inject({
    method: "GET",
    url: `/public/pay/${charge.payment.publicToken}/qr.svg`,
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] as string, /svg/);
});

test("caso 1 do QA — fluxo feliz completo até paga", async () => {
  const charge = await createCharge();
  const t = charge.payment.publicToken;

  await app.inject({ method: "POST", url: `/public/pay/${t}/copied` });

  const confirm = await app.inject({
    method: "POST",
    url: `/public/pay/${t}/confirm`,
    payload: {},
  });
  assert.equal(confirm.statusCode, 200);
  assert.equal(confirm.json().status, "cliente_confirmou");

  // O prestador foi notificado por WhatsApp (modo log grava no banco).
  const notifs = await app.inject({
    method: "GET",
    url: "/api/notifications",
    headers: auth(),
  });
  const list = notifs.json().notifications;
  assert.ok(list.some((n: { kind: string }) => n.kind === "client_confirmed"));

  const done = await app.inject({
    method: "POST",
    url: `/api/payments/${charge.payment.id}/confirm`,
    headers: auth(),
  });
  assert.equal(done.statusCode, 200);
  assert.equal(done.json().payment.status, "paga");
});

test("caso 2 do QA — contestação reabre a cobrança e devolve mensagem educada", async () => {
  const charge = await createCharge();
  const t = charge.payment.publicToken;

  await app.inject({ method: "POST", url: `/public/pay/${t}/confirm`, payload: {} });

  const contest = await app.inject({
    method: "POST",
    url: `/api/payments/${charge.payment.id}/contest`,
    headers: auth(),
  });
  assert.equal(contest.statusCode, 200);
  const body = contest.json();
  assert.equal(body.payment.status, "em_aberto");
  // Tom de dúvida, nunca acusação (regra de produto).
  assert.match(body.whatsapp.message, /não identifiquei o pagamento/i);
  assert.doesNotMatch(body.whatsapp.message, /não pagou|devendo|inadimplente/i);

  // Cliente pode confirmar de novo após a reabertura.
  const again = await app.inject({
    method: "POST",
    url: `/public/pay/${t}/confirm`,
    payload: {},
  });
  assert.equal(again.json().status, "cliente_confirmou");
});

test("marcação manual direta é bloqueada sem proposta confirmada", async () => {
  const charge = await createCharge();
  const res = await app.inject({
    method: "POST",
    url: `/api/payments/${charge.payment.id}/mark-paid`,
    headers: auth(),
  });
  assert.equal(res.statusCode, 428);
  assert.equal(res.json().code, "ACTION_PROPOSAL_REQUIRED");
});

test("caso 4 do QA — proposta persiste parâmetros exatos e é executada uma vez", async () => {
  const charge = await createCharge();
  const idempotencyKey = crypto.randomUUID();
  const payload = {
    tool: "marcar_pago_manual",
    arguments: { paymentId: charge.payment.id },
    idempotencyKey,
  };

  const proposed = await app.inject({
    method: "POST",
    url: "/api/action-proposals",
    headers: auth(),
    payload,
  });
  assert.equal(proposed.statusCode, 201);
  const proposal = proposed.json().proposal;
  assert.deepEqual(proposal.arguments, payload.arguments);
  assert.equal(proposal.idempotencyKey, idempotencyKey);
  assert.match(proposal.summary, /R\$\s?150,07/);
  assert.match(proposal.summary, /Maria Cliente/);
  assert.match(proposal.summary, /não pode ser desfeita/i);
  assert.ok(new Date(proposal.expiresAt).getTime() > Date.now());

  const { queryOne } = await import("../src/db.ts");
  const storedProposal = await queryOne<{ arguments_type: string }>(
    "SELECT jsonb_typeof(arguments) AS arguments_type FROM assistant_action_proposals WHERE id = ?",
    proposal.proposalId,
  );
  assert.equal(storedProposal?.arguments_type, "object");

  const duplicate = await app.inject({
    method: "POST",
    url: "/api/action-proposals",
    headers: auth(),
    payload,
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().proposal.proposalId, proposal.proposalId);
  assert.equal(duplicate.json().alreadyProposed, true);

  const otherCharge = await createCharge(9900);
  const conflicting = await app.inject({
    method: "POST",
    url: "/api/action-proposals",
    headers: auth(),
    payload: {
      ...payload,
      arguments: { paymentId: otherCharge.payment.id },
    },
  });
  assert.equal(conflicting.statusCode, 409);

  const confirmations = await Promise.all([
    app.inject({
      method: "POST",
      url: `/api/action-proposals/${proposal.proposalId}/confirm`,
      headers: auth(),
    }),
    app.inject({
      method: "POST",
      url: `/api/action-proposals/${proposal.proposalId}/confirm`,
      headers: auth(),
    }),
  ]);
  assert.ok(confirmations.every((response) => response.statusCode === 200));
  assert.deepEqual(
    confirmations.map((response) => response.json().alreadyConfirmed).sort(),
    [false, true],
  );
  assert.ok(confirmations.every((response) => response.json().payment.status === "paga"));

  const storedConfirmation = await queryOne<{ result_type: string }>(
    "SELECT jsonb_typeof(result) AS result_type FROM assistant_action_proposals WHERE id = ?",
    proposal.proposalId,
  );
  assert.equal(storedConfirmation?.result_type, "object");

  const repeatedAfterExecution = await app.inject({
    method: "POST",
    url: "/api/action-proposals",
    headers: auth(),
    payload,
  });
  assert.equal(repeatedAfterExecution.statusCode, 200);
  assert.equal(repeatedAfterExecution.json().proposal.proposalId, proposal.proposalId);
});

test("proposta criada com argumentos duplamente serializados continua confirmável", async () => {
  const charge = await createCharge();
  const proposed = await app.inject({
    method: "POST",
    url: "/api/action-proposals",
    headers: auth(),
    payload: {
      tool: "marcar_pago_manual",
      arguments: { paymentId: charge.payment.id },
      idempotencyKey: crypto.randomUUID(),
    },
  });
  assert.equal(proposed.statusCode, 201);

  const { execute } = await import("../src/db.ts");
  await execute(
    "UPDATE assistant_action_proposals SET arguments = to_jsonb(?::text) WHERE id = ?",
    JSON.stringify({ paymentId: charge.payment.id }),
    proposed.json().proposal.proposalId,
  );

  const confirmed = await app.inject({
    method: "POST",
    url: `/api/action-proposals/${proposed.json().proposal.proposalId}/confirm`,
    headers: auth(),
  });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.json().payment.status, "paga");
});

test("proposta só pode ser confirmada pela sessão que a criou", async () => {
  const charge = await createCharge();
  const proposed = await app.inject({
    method: "POST",
    url: "/api/action-proposals",
    headers: auth(),
    payload: {
      tool: "marcar_pago_manual",
      arguments: { paymentId: charge.payment.id },
      idempotencyKey: crypto.randomUUID(),
    },
  });
  assert.equal(proposed.statusCode, 201);

  const secondSession = await authClient.auth.signInWithPassword({
    email: primaryIdentity.email,
    password: primaryIdentity.password,
  });
  assert.ifError(secondSession.error);
  const res = await app.inject({
    method: "POST",
    url: `/api/action-proposals/${proposed.json().proposal.proposalId}/confirm`,
    headers: { authorization: `Bearer ${secondSession.data.session!.access_token}` },
  });
  assert.equal(res.statusCode, 404);

  const ownerConfirmation = await app.inject({
    method: "POST",
    url: `/api/action-proposals/${proposed.json().proposal.proposalId}/confirm`,
    headers: auth(),
  });
  assert.equal(ownerConfirmation.statusCode, 200);
});

test("proposta expirada não altera a cobrança", async () => {
  const charge = await createCharge();
  const proposed = await app.inject({
    method: "POST",
    url: "/api/action-proposals",
    headers: auth(),
    payload: {
      tool: "marcar_pago_manual",
      arguments: { paymentId: charge.payment.id },
      idempotencyKey: crypto.randomUUID(),
    },
  });
  assert.equal(proposed.statusCode, 201);

  const { execute } = await import("../src/db.ts");
  await execute(
    "UPDATE assistant_action_proposals SET expires_at = ? WHERE id = ?",
    "2020-01-01T00:00:00.000Z",
    proposed.json().proposal.proposalId,
  );

  const expired = await app.inject({
    method: "POST",
    url: `/api/action-proposals/${proposed.json().proposal.proposalId}/confirm`,
    headers: auth(),
  });
  assert.equal(expired.statusCode, 410);

  const detail = await app.inject({
    method: "GET",
    url: `/api/charges/${charge.charge.id}`,
    headers: auth(),
  });
  assert.notEqual(detail.json().status, "paga");
});

test("mudança de estado invalida a proposta antes da execução", async () => {
  const charge = await createCharge();
  const proposed = await app.inject({
    method: "POST",
    url: "/api/action-proposals",
    headers: auth(),
    payload: {
      tool: "marcar_pago_manual",
      arguments: { paymentId: charge.payment.id },
      idempotencyKey: crypto.randomUUID(),
    },
  });
  assert.equal(proposed.statusCode, 201);

  const clientConfirmation = await app.inject({
    method: "POST",
    url: `/public/pay/${charge.payment.publicToken}/confirm`,
    payload: {},
  });
  assert.equal(clientConfirmation.statusCode, 200);

  const stale = await app.inject({
    method: "POST",
    url: `/api/action-proposals/${proposed.json().proposal.proposalId}/confirm`,
    headers: auth(),
  });
  assert.equal(stale.statusCode, 409);

  const detail = await app.inject({
    method: "GET",
    url: `/api/charges/${charge.charge.id}`,
    headers: auth(),
  });
  assert.equal(detail.json().status, "cliente_confirmou");
});

test("máquina de estados — transição inválida a partir de paga retorna 409", async () => {
  const charge = await createCharge();
  const proposed = await app.inject({
    method: "POST",
    url: "/api/action-proposals",
    headers: auth(),
    payload: {
      tool: "marcar_pago_manual",
      arguments: { paymentId: charge.payment.id },
      idempotencyKey: crypto.randomUUID(),
    },
  });
  await app.inject({
    method: "POST",
    url: `/api/action-proposals/${proposed.json().proposal.proposalId}/confirm`,
    headers: auth(),
  });
  // paga é terminal: contestar deve falhar.
  const res = await app.inject({
    method: "POST",
    url: `/api/payments/${charge.payment.id}/contest`,
    headers: auth(),
  });
  assert.equal(res.statusCode, 409);
});

test("cliente confirmando duas vezes não quebra nem duplica estado", async () => {
  const charge = await createCharge();
  const t = charge.payment.publicToken;
  const first = await app.inject({
    method: "POST",
    url: `/public/pay/${t}/confirm`,
    payload: {},
  });
  const second = await app.inject({
    method: "POST",
    url: `/public/pay/${t}/confirm`,
    payload: {},
  });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().alreadyHandled, true);
});

test("prestador não acessa parcela de outro prestador", async () => {
  const charge = await createCharge();
  const otherToken = await createAuthUser("other");
  const other = await app.inject({
    method: "POST",
    url: "/api/providers",
    headers: { authorization: `Bearer ${otherToken}` },
    payload: {
      name: "Outro Prestador",
      profession: "Lavagem",
      whatsapp: "11955554444",
      pixKey: "outro@prestou.com",
      consent: true,
    },
  });
  assert.equal(other.statusCode, 201);

  const res = await app.inject({
    method: "POST",
    url: `/api/payments/${charge.payment.id}/confirm`,
    headers: { authorization: `Bearer ${otherToken}` },
  });
  assert.equal(res.statusCode, 404);
});

test("F9 — painel agrega totais e deriva atrasada a partir do vencimento", async () => {
  // Vencimento no passado: deve aparecer como "atrasada" (estado derivado,
  // nunca persistido — o status gravado continua em_aberto).
  const vencida = await createCharge(7700, "2020-01-01");

  const res = await app.inject({
    method: "GET",
    url: "/api/charges",
    headers: auth(),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.items));
  assert.ok(typeof body.totals.aReceberCents === "number");

  const item = body.items.find(
    (i: { paymentId: string }) => i.paymentId === vencida.payment.id,
  );
  assert.ok(item, "cobrança vencida deveria estar no painel");
  assert.equal(item.status, "atrasada");
  assert.ok(body.totals.atrasadasCount >= 1);
});

test("lista cobranças recentes com paginação e filtros", async () => {
  await createCharge(3100, "2030-05-10");
  await createCharge(3200, "2030-05-11");

  const clients = await app.inject({
    method: "GET",
    url: "/api/clients",
    headers: auth(),
  });
  assert.equal(clients.statusCode, 200);
  const client = clients.json().clients.find(
    (item: { whatsapp: string }) => item.whatsapp === "11977776666",
  );
  assert.ok(client);

  const firstPage = await app.inject({
    method: "GET",
    url: `/api/charges?page=1&pageSize=1&clientId=${client.id}&status=em_aberto&from=2030-05-01&to=2030-05-31`,
    headers: auth(),
  });
  assert.equal(firstPage.statusCode, 200);
  const body = firstPage.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].client.id, client.id);
  assert.equal(body.items[0].status, "em_aberto");
  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.pageSize, 1);
  assert.ok(body.pagination.total >= 2);
  assert.ok(body.pagination.totalPages >= 2);

  const secondPage = await app.inject({
    method: "GET",
    url: `/api/charges?page=2&pageSize=1&clientId=${client.id}&from=2030-05-01&to=2030-05-31`,
    headers: auth(),
  });
  assert.equal(secondPage.statusCode, 200);
  assert.equal(secondPage.json().items.length, 1);

  const invalidPeriod = await app.inject({
    method: "GET",
    url: "/api/charges?from=2030-06-01&to=2030-05-01",
    headers: auth(),
  });
  assert.equal(invalidPeriod.statusCode, 400);
});

test("lista somente os clientes do prestador autenticado", async () => {
  const otherToken = await createAuthUser("clients-other");
  const otherProvider = await app.inject({
    method: "POST",
    url: "/api/providers",
    headers: { authorization: `Bearer ${otherToken}` },
    payload: {
      name: "Prestador Clientes",
      profession: "Pintura",
      whatsapp: "11944443333",
      pixKey: "clientes@prestou.com",
      consent: true,
    },
  });
  assert.equal(otherProvider.statusCode, 201);
  const otherCharge = await app.inject({
    method: "POST",
    url: "/api/charges",
    headers: { authorization: `Bearer ${otherToken}` },
    payload: {
      client: { name: "Cliente de Outro", whatsapp: "11933332222" },
      description: "Pintura",
      amountCents: 4000,
      dueDate: "2030-05-12",
    },
  });
  assert.equal(otherCharge.statusCode, 201);

  const clients = await app.inject({
    method: "GET",
    url: "/api/clients",
    headers: auth(),
  });
  assert.equal(clients.statusCode, 200);
  assert.equal(
    clients.json().clients.some(
      (client: { whatsapp: string }) => client.whatsapp === "11933332222",
    ),
    false,
  );
});

test("resumo financeiro seleciona o mês e pagina suas cobranças", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/financial-summary?month=2030-05&page=1&pageSize=1",
    headers: auth(),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.month, "2030-05");
  assert.equal(body.items.length, 1);
  assert.equal(body.pagination.pageSize, 1);
  assert.ok(body.pagination.total >= 2);
  assert.ok(body.summary.totalCents >= 6300);
  assert.ok(body.summary.pendingCents >= 6300);

  const invalidMonth = await app.inject({
    method: "GET",
    url: "/api/financial-summary?month=2030-13",
    headers: auth(),
  });
  assert.equal(invalidMonth.statusCode, 400);
});

test("funil registra os eventos que decidem o PSP na V2", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/insights/funnel",
    headers: auth(),
  });
  const body = res.json();
  const types = body.events.map((e: { type: string }) => e.type);
  assert.ok(types.includes("cobranca_criada"));
  assert.ok(types.includes("link_aberto"));
  assert.ok(types.includes("codigo_copiado"));
  assert.ok(types.includes("cliente_confirmou"));
  assert.ok(body.leakage.vazamentoPct !== undefined);
});

test("F8 — lembretes disparam no vencimento e são idempotentes no dia", async () => {
  const { runReminders } = await import("../src/reminders.ts");
  await createCharge(5000, "2026-07-19");
  const first = await runReminders("2026-07-19");
  assert.ok(first.sent >= 1);
  const second = await runReminders("2026-07-19");
  assert.equal(second.sent, 0, "não deve reenviar o mesmo lembrete no mesmo dia");
});
}
