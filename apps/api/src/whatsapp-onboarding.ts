import { createHmac, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAppAdmin } from "./auth.js";
import { config } from "./config.js";
import {
  execute,
  queryAll,
  queryOne,
  withTransaction,
  type DatabaseClient,
} from "./db.js";
import { newId } from "./ids.js";
import { sendWhatsAppTemplate } from "./notify.js";
import { nationalWhatsAppIdentityCandidates, type InboundMessage } from "./channels/whatsapp.js";
import { mobileSchema, requiredText } from "./validation.js";
import { parsePublicSignupIntent } from "./public-signup.js";

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const emailSchema = z.string().trim().email().max(254);
const createInviteSchema = z.object({
  phone: mobileSchema,
  expiresInDays: z.number().int().min(1).max(30).default(7),
  manual: z.boolean().default(false),
}).strict();
const authorizeEmailSchema = z.object({
  email: emailSchema,
  captchaToken: requiredText("CAPTCHA", 1, 4_096),
}).strict();

const SIGNUP_CONFIRM_PAYLOAD = "signup:confirm";

function manualInviteMessage(): string | undefined {
  const prestouPhone = mobileSchema.safeParse(config.whatsapp.publicPhone);
  if (!prestouPhone.success) return undefined;
  const link = `https://wa.me/55${prestouPhone.data}?text=${encodeURIComponent("Oi")}`;
  return (
    "Olá! Você recebeu um convite para criar sua conta no Prestou. " +
    "Para confirmar que este WhatsApp é seu e continuar o cadastro, " +
    `toque no link e envie a mensagem pronta: ${link}`
  );
}

const onboardingSecret =
  config.whatsapp.signup.onboardingSecret || config.supabase.serviceRoleKey;

const adminAuth = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface InviteRow {
  id: string;
  phone: string;
  status: "pending" | "claimed" | "consumed" | "revoked";
  expires_at: string;
  claimed_at: string | null;
  consumed_at: string | null;
  created_at: string;
}

interface SessionRow {
  id: string;
  invite_id: string | null;
  phone: string;
  phone_verified_at: string;
  auth_user_id: string | null;
  requested_email: string | null;
  email_requested_at: string | null;
  expires_at: string;
  consumed_at: string | null;
}

interface ActiveOnboardingRow {
  token_id: string;
  token_session_id: string;
  token_expires_at: string;
  token_consumed_at: string | null;
  session_id: string;
  session_invite_id: string;
  session_phone: string;
  session_phone_verified_at: string;
  session_auth_user_id: string | null;
  session_requested_email: string | null;
  session_email_requested_at: string | null;
  session_expires_at: string;
  session_consumed_at: string | null;
  invite_id: string;
  invite_phone: string;
  invite_status: InviteRow["status"];
  invite_expires_at: string;
  invite_claimed_at: string | null;
  invite_consumed_at: string | null;
  invite_created_at: string;
}

interface OnboardingTokenRow {
  id: string;
  session_id: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface LockedOnboarding {
  tokenId: string;
  sessionId: string;
  inviteId: string;
  phone: string;
  phoneVerifiedAt: string;
  authUserId: string;
}

interface PreparedAuthUser {
  id: string;
  created: boolean;
}

function tokenDigest(token: string): string {
  return createHmac("sha256", onboardingSecret).update(token).digest("hex");
}

function newOnboardingToken(): string {
  return randomBytes(32).toString("base64url");
}

function signupUrl(token: string): string {
  return `${config.publicWebUrl}/cadastro?token=${encodeURIComponent(token)}`;
}

function maskedPhone(phone: string): string {
  return `(${phone.slice(0, 2)}) *****-${phone.slice(-4)}`;
}

function isFuture(value: string): boolean {
  return new Date(value).getTime() > Date.now();
}

async function incrementOnboardingCounter(
  tx: DatabaseClient,
  scope: "phone_day" | "global_day",
  scopeId: string,
): Promise<number> {
  const row = await tx.queryOne<{ count: number }>(
    `INSERT INTO private.whatsapp_onboarding_counters (scope, scope_id, window_start, count)
     VALUES (?, ?, date_trunc('day', now()), 1)
     ON CONFLICT (scope, scope_id, window_start)
     DO UPDATE SET count = private.whatsapp_onboarding_counters.count + 1
     RETURNING count`,
    scope,
    scopeId,
  );
  return row?.count ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Para número ainda sem provider, reivindica um convite pelo inbound assinado e
 * emite um único link bearer de curta duração. Não chama Auth nem LLM.
 */
export async function startInvitedWhatsAppOnboarding(
  inbound: InboundMessage,
): Promise<string | undefined> {
  if (!config.whatsapp.signup.enabled) return undefined;
  const candidates = nationalWhatsAppIdentityCandidates(inbound.from);

  return withTransaction(async (tx) => {
    const invite = await tx.queryOne<InviteRow>(
      `SELECT * FROM private.whatsapp_signup_invites
        WHERE phone IN (?, ?)
          AND status IN ('pending', 'claimed')
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1 FOR UPDATE`,
      ...candidates,
    );
    if (!invite) return undefined;

    const admitted = await tx.execute(
      `INSERT INTO private.whatsapp_onboarding_messages (message_id, phone)
       VALUES (?, ?) ON CONFLICT (message_id) DO NOTHING`,
      inbound.id,
      invite.phone,
    );
    if (admitted.changes === 0) return undefined;

    // Só uma mensagem inédita e convidada dispara manutenção ou qualquer outra
    // escrita. Replays param na deduplicação.
    await tx.execute(
      "DELETE FROM private.whatsapp_onboarding_messages WHERE created_at < now() - interval '2 days'",
    );
    await tx.execute(
      `DELETE FROM private.whatsapp_onboarding_sessions
        WHERE (consumed_at IS NULL AND expires_at <= now())
           OR consumed_at < now() - interval '30 days'`,
    );
    await tx.execute(
      `DELETE FROM private.whatsapp_onboarding_counters
        WHERE window_start < date_trunc('day', now()) - interval '2 days'`,
    );
    await tx.execute(
      `UPDATE private.whatsapp_signup_invites
          SET status = 'revoked', revoked_at = now()
        WHERE status IN ('pending', 'claimed') AND expires_at <= now()`,
    );

    const phoneCount = await incrementOnboardingCounter(tx, "phone_day", invite.phone);
    if (phoneCount > config.whatsapp.signup.phoneDailyLimit) return undefined;
    const globalCount = await incrementOnboardingCounter(tx, "global_day", "all");
    if (globalCount > config.whatsapp.signup.globalDailyLimit) return undefined;

    let session = await tx.queryOne<SessionRow>(
      "SELECT * FROM private.whatsapp_onboarding_sessions WHERE invite_id = ? FOR UPDATE",
      invite.id,
    );
    if (!session) {
      const sessionId = newId();
      const verifiedAt = new Date().toISOString();
      await tx.execute(
        `INSERT INTO private.whatsapp_onboarding_sessions
           (id, invite_id, phone, phone_verified_at, expires_at)
         VALUES (?, ?, ?, ?, now() + (? * interval '1 minute'))`,
        sessionId,
        invite.id,
        invite.phone,
        verifiedAt,
        config.whatsapp.signup.sessionTtlMinutes,
      );
      await tx.execute(
        `UPDATE private.whatsapp_signup_invites
            SET status = 'claimed', claimed_at = coalesce(claimed_at, now())
          WHERE id = ?`,
        invite.id,
      );
      session = (await tx.queryOne<SessionRow>(
        "SELECT * FROM private.whatsapp_onboarding_sessions WHERE id = ?",
        sessionId,
      ))!;
    }

    const activeToken = await tx.queryOne<{ id: string }>(
      `SELECT id FROM private.whatsapp_onboarding_tokens
        WHERE session_id = ? AND consumed_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      session.id,
    );
    // Uma segunda mensagem não gira nem reenvia um link ainda válido. Isso
    // preserva a página que o convidado já abriu e evita amplificação de spam.
    if (activeToken) return undefined;

    await tx.execute(
      `UPDATE private.whatsapp_onboarding_tokens
          SET consumed_at = now()
        WHERE session_id = ? AND consumed_at IS NULL`,
      session.id,
    );
    const rawToken = newOnboardingToken();
    await tx.execute(
      `INSERT INTO private.whatsapp_onboarding_tokens
         (id, session_id, token_digest, expires_at)
       VALUES (?, ?, ?, now() + (? * interval '1 minute'))`,
      newId(),
      session.id,
      tokenDigest(rawToken),
      config.whatsapp.signup.linkTtlMinutes,
    );
    return rawToken;
  });
}

/**
 * Entrada self-serve: somente a frase assinada/exata cria estado. Mensagens
 * desconhecidas continuam fora da LLM e não ganham resposta.
 */
export async function startPublicWhatsAppOnboarding(
  inbound: InboundMessage,
): Promise<string | undefined> {
  if (config.whatsapp.signup.mode !== "public" || inbound.kind !== "text") return undefined;
  const intent = parsePublicSignupIntent(inbound.text, { secret: onboardingSecret });
  if (!intent) return undefined;
  const [phone] = nationalWhatsAppIdentityCandidates(inbound.from);

  return withTransaction(async (tx) => {
    await tx.execute("SELECT pg_advisory_xact_lock(hashtext(?))", phone);
    const admitted = await tx.execute(
      `INSERT INTO private.whatsapp_onboarding_messages (message_id, phone)
       VALUES (?, ?) ON CONFLICT (message_id) DO NOTHING`,
      inbound.id,
      phone,
    );
    if (admitted.changes === 0) return undefined;

    const phoneCount = await incrementOnboardingCounter(tx, "phone_day", phone);
    if (phoneCount > config.whatsapp.signup.phoneDailyLimit) return undefined;
    const globalCount = await incrementOnboardingCounter(tx, "global_day", "all");
    if (globalCount > config.whatsapp.signup.globalDailyLimit) return undefined;

    const existing = await tx.queryOne<SessionRow>(
      `SELECT * FROM private.whatsapp_onboarding_sessions
        WHERE phone = ? AND entry_mode = 'public' AND consumed_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      phone,
    );
    if (existing) return undefined;

    const sessionId = newId();
    await tx.execute(
      `INSERT INTO private.whatsapp_onboarding_sessions
         (id, entry_mode, onboarding_journey_id, attribution, phone, phone_verified_at, expires_at)
       VALUES (?, 'public', ?, ?::text::jsonb, ?, now(), now() + (? * interval '1 minute'))`,
      sessionId,
      "journeyId" in intent ? intent.journeyId : newId(),
      JSON.stringify(intent.attribution),
      phone,
      config.whatsapp.signup.sessionTtlMinutes,
    );
    const rawToken = newOnboardingToken();
    await tx.execute(
      `INSERT INTO private.whatsapp_onboarding_tokens (id, session_id, token_digest, expires_at)
       VALUES (?, ?, ?, now() + (? * interval '1 minute'))`,
      newId(), sessionId, tokenDigest(rawToken), config.whatsapp.signup.linkTtlMinutes,
    );
    return rawToken;
  });
}

async function loadActiveOnboarding(token: string): Promise<{
  token: OnboardingTokenRow;
  session: SessionRow;
  invite: InviteRow;
} | undefined> {
  if (!tokenSchema.safeParse(token).success) return undefined;
  const row = await queryOne<ActiveOnboardingRow>(
    `SELECT
       tok.id AS token_id, tok.session_id AS token_session_id,
       tok.expires_at AS token_expires_at, tok.consumed_at AS token_consumed_at,
       ses.id AS session_id, ses.invite_id AS session_invite_id,
       ses.phone AS session_phone,
       ses.phone_verified_at AS session_phone_verified_at,
       ses.auth_user_id AS session_auth_user_id,
       ses.requested_email AS session_requested_email,
       ses.email_requested_at AS session_email_requested_at,
       ses.expires_at AS session_expires_at,
       ses.consumed_at AS session_consumed_at,
       inv.id AS invite_id, inv.phone AS invite_phone,
       inv.status AS invite_status, inv.expires_at AS invite_expires_at,
       inv.claimed_at AS invite_claimed_at,
       inv.consumed_at AS invite_consumed_at,
       inv.created_at AS invite_created_at
     FROM private.whatsapp_onboarding_tokens tok
     JOIN private.whatsapp_onboarding_sessions ses ON ses.id = tok.session_id
     JOIN private.whatsapp_signup_invites inv ON inv.id = ses.invite_id
     WHERE tok.token_digest = ? AND ses.phone = inv.phone`,
    tokenDigest(token),
  );
  if (!row) return undefined;

  const tokenRow: OnboardingTokenRow = {
    id: row.token_id!,
    session_id: row.token_session_id!,
    expires_at: row.token_expires_at!,
    consumed_at: row.token_consumed_at ?? null,
  };
  const sessionRow: SessionRow = {
    id: row.session_id,
    invite_id: row.session_invite_id,
    phone: row.session_phone,
    phone_verified_at: row.session_phone_verified_at,
    auth_user_id: row.session_auth_user_id,
    requested_email: row.session_requested_email,
    email_requested_at: row.session_email_requested_at,
    expires_at: row.session_expires_at,
    consumed_at: row.session_consumed_at,
  };
  const inviteRow: InviteRow = {
    id: row.invite_id,
    phone: row.invite_phone,
    status: row.invite_status,
    expires_at: row.invite_expires_at,
    claimed_at: row.invite_claimed_at,
    consumed_at: row.invite_consumed_at,
    created_at: row.invite_created_at,
  };
  if (
    tokenRow.consumed_at || sessionRow.consumed_at || inviteRow.status !== "claimed" ||
    !isFuture(tokenRow.expires_at) || !isFuture(sessionRow.expires_at) || !isFuture(inviteRow.expires_at)
  ) {
    return undefined;
  }
  return { token: tokenRow, session: sessionRow, invite: inviteRow };
}

async function verifyTurnstile(token: string, remoteIp: string): Promise<boolean> {
  const secret = config.whatsapp.signup.turnstileSecret;
  if (!secret) return config.nodeEnv !== "production" && token === "development";
  const body = new URLSearchParams({ secret, response: token, remoteip: remoteIp });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return false;
  const result = await response.json() as { success?: boolean };
  return result.success === true;
}

async function findAuthUserId(email: string): Promise<string | undefined> {
  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM auth.users WHERE lower(email) = lower(?) LIMIT 1",
    email,
  );
  return existing?.id;
}

async function ensureAuthUser(email: string): Promise<PreparedAuthUser> {
  const existingId = await findAuthUserId(email);
  if (existingId) return { id: existingId, created: false };

  const created = await adminAuth.auth.admin.createUser({ email, email_confirm: false });
  if (!created.error && created.data.user) return { id: created.data.user.id, created: true };

  // Uma requisição concorrente pode ter criado o mesmo e-mail.
  const raced = await queryOne<{ id: string }>(
    "SELECT id FROM auth.users WHERE lower(email) = lower(?) LIMIT 1",
    email,
  );
  if (raced) return { id: raced.id, created: false };
  throw created.error ?? new Error("Não foi possível preparar a identidade Supabase");
}

async function cleanupPreparedAuthUser(
  prepared: PreparedAuthUser,
): Promise<Error | undefined> {
  if (!prepared.created) return undefined;
  try {
    // Se o COMMIT do vínculo aconteceu mas a conexão falhou ao responder, não
    // compensamos: apagar o Auth removeria um vínculo que já foi confirmado.
    const inUse = await queryOne<{ found: number }>(
      `SELECT 1 AS found
         FROM private.whatsapp_onboarding_sessions
        WHERE auth_user_id = ?
       UNION ALL
       SELECT 1 AS found FROM providers WHERE auth_user_id = ?
       LIMIT 1`,
      prepared.id,
      prepared.id,
    );
    if (inUse) return undefined;
    const deleted = await adminAuth.auth.admin.deleteUser(prepared.id);
    return deleted.error ?? undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export async function lockOnboardingForProvider(
  tx: DatabaseClient,
  rawToken: string,
  authUserId: string,
): Promise<LockedOnboarding | undefined> {
  if (!tokenSchema.safeParse(rawToken).success) return undefined;
  const row = await tx.queryOne<{
    token_id: string;
    session_id: string;
    invite_id: string;
    phone: string;
    phone_verified_at: string;
  }>(
    `SELECT tok.id AS token_id, ses.id AS session_id, inv.id AS invite_id,
            ses.phone, ses.phone_verified_at
       FROM private.whatsapp_onboarding_tokens tok
       JOIN private.whatsapp_onboarding_sessions ses ON ses.id = tok.session_id
       JOIN private.whatsapp_signup_invites inv ON inv.id = ses.invite_id
      WHERE tok.token_digest = ?
        AND tok.consumed_at IS NULL AND tok.expires_at > now()
        AND ses.consumed_at IS NULL AND ses.expires_at > now()
        AND ses.auth_user_id = ?
        AND inv.status = 'claimed' AND inv.expires_at > now()
        AND ses.phone = inv.phone
      FOR UPDATE OF tok, ses, inv`,
    tokenDigest(rawToken),
    authUserId,
  );
  return row ? {
    tokenId: row.token_id,
    sessionId: row.session_id,
    inviteId: row.invite_id,
    phone: row.phone,
    phoneVerifiedAt: row.phone_verified_at,
    authUserId,
  } : undefined;
}

export async function consumeLockedOnboarding(
  tx: DatabaseClient,
  onboarding: LockedOnboarding,
): Promise<void> {
  await tx.execute(
    "UPDATE private.whatsapp_onboarding_tokens SET consumed_at = now() WHERE id = ?",
    onboarding.tokenId,
  );
  await tx.execute(
    "UPDATE private.whatsapp_onboarding_sessions SET consumed_at = now() WHERE id = ?",
    onboarding.sessionId,
  );
  await tx.execute(
    `UPDATE private.whatsapp_signup_invites
        SET status = 'consumed', consumed_at = now()
      WHERE id = ?`,
    onboarding.inviteId,
  );
  await tx.execute(
    "DELETE FROM private.whatsapp_onboarding_auth_users WHERE auth_user_id = ?",
    onboarding.authUserId,
  );
}

export async function invalidateOnboardingToken(rawToken: string): Promise<void> {
  if (!tokenSchema.safeParse(rawToken).success) return;
  await queryOne(
    `UPDATE private.whatsapp_onboarding_tokens
        SET consumed_at = now()
      WHERE token_digest = ? AND consumed_at IS NULL
      RETURNING id`,
    tokenDigest(rawToken),
  );
}

/** Remove sessões expiradas e somente identidades Auth criadas por este fluxo. */
export async function purgeExpiredWhatsAppOnboarding(): Promise<{
  authUsersDeleted: number;
  authUserDeleteFailures: number;
  sessionsDeleted: number;
}> {
  const provisional = await queryAll<{ auth_user_id: string }>(
    `SELECT provisional.auth_user_id
       FROM private.whatsapp_onboarding_auth_users provisional
      WHERE provisional.created_at < now() - (? * interval '1 minute')
        AND NOT EXISTS (
          SELECT 1 FROM providers WHERE auth_user_id = provisional.auth_user_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM private.whatsapp_onboarding_sessions ses
           WHERE ses.auth_user_id = provisional.auth_user_id
             AND ses.consumed_at IS NULL AND ses.expires_at > now()
        )`,
    config.whatsapp.signup.sessionTtlMinutes,
  );
  let authUsersDeleted = 0;
  let authUserDeleteFailures = 0;
  for (const row of provisional) {
    const deleted = await adminAuth.auth.admin.deleteUser(row.auth_user_id);
    if (!deleted.error) authUsersDeleted++;
    else authUserDeleteFailures++;
  }
  const sessions = await withTransaction(async (tx) => tx.execute(
    `DELETE FROM private.whatsapp_onboarding_sessions
      WHERE (consumed_at IS NULL AND expires_at <= now())
         OR consumed_at < now() - interval '30 days'`,
  ));
  return { authUsersDeleted, authUserDeleteFailures, sessionsDeleted: sessions.changes };
}

export async function whatsappOnboardingRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>(
    "/public/whatsapp-onboarding/:token",
    async (req, reply) => {
      const active = await loadActiveOnboarding(req.params.token);
      if (!active || !config.whatsapp.signup.enabled) {
        return reply.code(404).send({ error: "Convite inválido ou expirado." });
      }
      return { phoneMasked: maskedPhone(active.session.phone) };
    },
  );

  app.post<{ Params: { token: string } }>(
    "/public/whatsapp-onboarding/:token/email",
    async (req, reply) => {
      if (!config.whatsapp.signup.enabled) {
        return reply.code(404).send({ error: "Convite inválido ou expirado." });
      }
      const body = authorizeEmailSchema.safeParse(req.body);
      const active = await loadActiveOnboarding(req.params.token);
      if (!body.success || !active) {
        return reply.code(400).send({ error: "Convite inválido ou expirado." });
      }
      if (!(await verifyTurnstile(body.data.captchaToken, req.ip))) {
        return reply.code(400).send({ error: "Não foi possível validar o CAPTCHA." });
      }

      const normalizedEmail = body.data.email.toLowerCase();
      const existingAuthUserId = await findAuthUserId(normalizedEmail);
      if (existingAuthUserId && await queryOne(
        "SELECT id FROM providers WHERE auth_user_id = ?",
        existingAuthUserId,
      )) {
        return reply.code(409).send({ error: "Este convite não pode ser usado com esse e-mail." });
      }
      const reservation = await withTransaction(async (tx) => {
        // Revalida e trava o token exato depois do CAPTCHA. Assim, revogação,
        // expiração ou rotação ocorrida durante o desafio não autoriza o Auth.
        const session = await tx.queryOne<SessionRow>(
          `SELECT ses.*
             FROM private.whatsapp_onboarding_tokens tok
             JOIN private.whatsapp_onboarding_sessions ses ON ses.id = tok.session_id
             JOIN private.whatsapp_signup_invites inv ON inv.id = ses.invite_id
            WHERE tok.token_digest = ?
              AND tok.consumed_at IS NULL AND tok.expires_at > now()
              AND ses.consumed_at IS NULL AND ses.expires_at > now()
              AND inv.status = 'claimed' AND inv.expires_at > now()
              AND ses.phone = inv.phone
            FOR UPDATE OF tok, ses, inv`,
          tokenDigest(req.params.token),
        );
        if (!session) return { status: "expired" as const };
        if (session.requested_email && session.requested_email !== normalizedEmail) return "bound";
        if (
          session.email_requested_at &&
          new Date(session.email_requested_at).getTime() >
            Date.now() - config.whatsapp.signup.emailCooldownSeconds * 1_000
        ) return { status: "cooldown" as const };
        await tx.execute(
          `UPDATE private.whatsapp_onboarding_sessions
              SET requested_email = ?, email_requested_at = now()
            WHERE id = ?`,
          normalizedEmail,
          session.id,
        );
        return { status: "ok" as const, sessionId: session.id };
      });
      if (reservation === "bound") {
        return reply.code(409).send({ error: "Este convite já está vinculado a outro cadastro." });
      }
      if (reservation.status === "cooldown") {
        return reply.code(429).send({ error: "Aguarde antes de solicitar outro link." });
      }
      if (reservation.status !== "ok") {
        return reply.code(409).send({ error: "Convite inválido, expirado ou já utilizado." });
      }

      const prepared = await ensureAuthUser(normalizedEmail);
      try {
        const provider = await queryOne<{ id: string }>(
          "SELECT id FROM providers WHERE auth_user_id = ?",
          prepared.id,
        );
        if (provider) {
          const error = new Error("email already has provider") as Error & { statusCode: number };
          error.statusCode = 409;
          throw error;
        }
        await withTransaction(async (tx) => {
          const session = await tx.queryOne<SessionRow>(
            `SELECT ses.*
               FROM private.whatsapp_onboarding_tokens tok
               JOIN private.whatsapp_onboarding_sessions ses ON ses.id = tok.session_id
               JOIN private.whatsapp_signup_invites inv ON inv.id = ses.invite_id
              WHERE tok.token_digest = ?
                AND tok.consumed_at IS NULL AND tok.expires_at > now()
                AND ses.consumed_at IS NULL AND ses.expires_at > now()
                AND inv.status = 'claimed' AND inv.expires_at > now()
                AND ses.phone = inv.phone
              FOR UPDATE OF tok, ses, inv`,
            tokenDigest(req.params.token),
          );
          if (!session || session.id !== reservation.sessionId ||
              session.requested_email !== normalizedEmail) {
            throw new Error("onboarding session changed while binding auth user");
          }
          if (session.auth_user_id && session.auth_user_id !== prepared.id) {
            throw new Error("onboarding session already bound to another auth user");
          }
          await tx.execute(
            "UPDATE private.whatsapp_onboarding_sessions SET auth_user_id = ? WHERE id = ?",
            prepared.id,
            session.id,
          );
          if (prepared.created) {
            await tx.execute(
              `INSERT INTO private.whatsapp_onboarding_auth_users (auth_user_id)
               VALUES (?) ON CONFLICT (auth_user_id) DO NOTHING`,
              prepared.id,
            );
          }
        });
      } catch (error) {
        const cleanupError = await cleanupPreparedAuthUser(prepared);
        if (cleanupError) {
          req.log.error({ err: cleanupError, authUserId: prepared.id }, "auth user compensation failed");
        }
        if ((error as { statusCode?: number }).statusCode === 409) {
          return reply.code(409).send({ error: "Este convite não pode ser usado com esse e-mail." });
        }
        if ((error as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "Este convite não pode ser usado com esse e-mail." });
        }
        throw error;
      }
      return { authorized: true };
    },
  );

  app.get(
    "/api/admin/whatsapp-invites",
    { preHandler: requireAppAdmin },
    async () => ({
      invites: await queryAll<InviteRow>(
        `SELECT id, phone, status, expires_at, claimed_at, consumed_at, created_at
           FROM private.whatsapp_signup_invites
          ORDER BY created_at DESC LIMIT 100`,
      ),
    }),
  );

  app.post(
    "/api/admin/whatsapp-invites",
    { preHandler: requireAppAdmin },
    async (req, reply) => {
      if (!config.whatsapp.signup.enabled) {
        return reply.code(503).send({ error: "Cadastro por WhatsApp está desativado." });
      }
      const body = createInviteSchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: "Informe um celular válido para o convite." });
      }
      const preparedManualMessage = body.data.manual ? manualInviteMessage() : undefined;
      if (body.data.manual && !preparedManualMessage) {
        return reply.code(503).send({
          code: "MANUAL_INVITE_UNAVAILABLE",
          error: "O telefone do Prestou não está configurado para convites manuais.",
        });
      }
      const owner = await queryOne<{ id: string }>(
        "SELECT id FROM providers WHERE whatsapp = ?",
        body.data.phone,
      );
      if (owner) return reply.code(409).send({ error: "Este número já possui uma conta." });

      try {
        const invite = await withTransaction(async (tx) => {
          await tx.execute(
            `UPDATE private.whatsapp_signup_invites
                SET status = 'revoked', revoked_at = now()
              WHERE phone = ? AND status IN ('pending', 'claimed') AND expires_at <= now()`,
            body.data.phone,
          );
          const id = newId();
          await tx.execute(
            `INSERT INTO private.whatsapp_signup_invites
               (id, phone, created_by, expires_at)
             VALUES (?, ?, ?, now() + (? * interval '1 day'))`,
            id,
            body.data.phone,
            req.authUser!.id,
            body.data.expiresInDays,
          );
          return (await tx.queryOne<InviteRow>(
            "SELECT * FROM private.whatsapp_signup_invites WHERE id = ?",
            id,
          ))!;
        });
        if (!body.data.manual) {
          try {
            await sendWhatsAppTemplate({
              to: `55${invite.phone}`,
              name: config.whatsapp.signup.template,
              quickReplyButtonPayload: SIGNUP_CONFIRM_PAYLOAD,
            });
          } catch (error) {
            await execute(
              `UPDATE private.whatsapp_signup_invites
                  SET status = 'revoked', revoked_at = now()
                WHERE id = ? AND status = 'pending'`,
              invite.id,
            );
            req.log.error({ err: error, inviteId: invite.id }, "signup invite delivery failed");
            return reply.code(502).send({
              error: "Não foi possível enviar o convite pelo WhatsApp. Tente novamente.",
            });
          }
        }
        return reply.code(201).send({ invite, manualMessage: preparedManualMessage });
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "Já existe um convite ativo para este número." });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/whatsapp-invites/:id/revoke",
    { preHandler: requireAppAdmin },
    async (req, reply) => {
      const id = z.string().uuid().safeParse(req.params.id);
      if (!id.success) return reply.code(400).send({ error: "Convite inválido." });
      const changed = await withTransaction(async (tx) => {
        const result = await tx.execute(
          `UPDATE private.whatsapp_signup_invites
              SET status = 'revoked', revoked_at = now()
            WHERE id = ? AND status IN ('pending', 'claimed')`,
          id.data,
        );
        if (result.changes) {
          await tx.execute(
            `DELETE FROM private.whatsapp_onboarding_sessions
              WHERE invite_id = ? AND consumed_at IS NULL`,
            id.data,
          );
        }
        return result.changes;
      });
      if (!changed) return reply.code(404).send({ error: "Convite não encontrado." });
      return { revoked: true };
    },
  );
}

export function invitedSignupMessage(rawToken: string): string {
  return (
    "Seu número foi convidado para o Prestou. " +
    `Conclua o cadastro pelo link seguro (válido por poucos minutos): ${signupUrl(rawToken)}`
  );
}
