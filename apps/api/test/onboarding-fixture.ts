import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../src/db.ts";

export async function seedInvitedOnboarding(
  db: DatabaseClient,
  input: { authUserId: string; phone: string; secret: string },
): Promise<string> {
  const inviteId = randomUUID();
  const sessionId = randomUUID();
  const rawToken = randomBytes(32).toString("base64url");
  const digest = createHmac("sha256", input.secret).update(rawToken).digest("hex");

  await db.execute(
    `INSERT INTO private.whatsapp_signup_invites
       (id, phone, created_by, expires_at, status, claimed_at)
     VALUES (?, ?, ?, now() + interval '1 day', 'claimed', now())`,
    inviteId,
    input.phone,
    input.authUserId,
  );
  await db.execute(
    `INSERT INTO private.whatsapp_onboarding_sessions
       (id, invite_id, phone, phone_verified_at, auth_user_id, requested_email,
        email_requested_at, expires_at)
     SELECT ?, ?, ?, now(), ?, lower(email), now(), now() + interval '1 day'
       FROM auth.users WHERE id = ?`,
    sessionId,
    inviteId,
    input.phone,
    input.authUserId,
    input.authUserId,
  );
  await db.execute(
    `INSERT INTO private.whatsapp_onboarding_tokens
       (id, session_id, token_digest, expires_at)
     VALUES (?, ?, ?, now() + interval '1 day')`,
    randomUUID(),
    sessionId,
    digest,
  );
  return rawToken;
}
