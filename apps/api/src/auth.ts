import type { FastifyReply, FastifyRequest } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { queryOne } from "./db.js";
import type { ProviderRow } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    provider?: ProviderRow;
    authUser?: { id: string; email: string };
  }
}

const authClient = createClient(config.supabase.url, config.supabase.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function bearer(req: FastifyRequest): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/** Valida a identidade Supabase, sem exigir que o perfil Prestou já exista. */
export async function requireAuthUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = bearer(req);
  if (!token) {
    await reply.code(401).send({ error: "Sessão ausente" });
    return;
  }

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    await reply.code(401).send({ error: "Sessão inválida ou expirada" });
    return;
  }
  if (!data.user.email) {
    await reply.code(403).send({ error: "Usuário autenticado sem e-mail" });
    return;
  }
  req.authUser = { id: data.user.id, email: data.user.email };
}

/** Autoriza o prestador derivando o perfil do `sub` validado pelo Supabase. */
export async function requireProvider(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuthUser(req, reply);
  if (reply.sent || req.provider) return;

  const provider = await queryOne<ProviderRow>(
    "SELECT * FROM providers WHERE auth_user_id = ?",
    req.authUser!.id,
  );
  if (!provider) {
    await reply.code(403).send({
      error: "Onboarding pendente",
      code: "ONBOARDING_REQUIRED",
    });
    return;
  }
  req.provider = provider;
}
