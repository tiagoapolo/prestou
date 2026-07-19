import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parsePixKey } from "@prestou/pix";
import { execute, queryOne } from "../db.js";
import { newApiToken, newId } from "../ids.js";
import { isSupabaseAuthEnabled, requireAuthUser, requireProvider } from "../auth.js";
import type { ProviderRow } from "../types.js";

const createProviderSchema = z.object({
  name: z.string().min(2).max(80),
  profession: z.string().min(2).max(60),
  whatsapp: z.string().min(10).max(20),
  pixKey: z.string().min(3).max(80),
  city: z.string().max(40).optional(),
  photoUrl: z.string().url().max(500).optional(),
  /** Aceite do termo LGPD — obrigatório no onboarding (F1). */
  consent: z.literal(true),
});

function publicProvider(p: ProviderRow) {
  return {
    id: p.id,
    name: p.name,
    profession: p.profession,
    photoUrl: p.photo_url,
    city: p.city,
    pixKeyType: p.pix_key_type,
    // A chave Pix é exibida mascarada; o valor cru só é usado para gerar o BR Code.
    pixKeyMasked: maskKey(p.pix_key),
    whatsapp: p.whatsapp,
    createdAt: p.created_at,
  };
}

function maskKey(key: string): string {
  if (key.length <= 6) return "***";
  return `${key.slice(0, 3)}***${key.slice(-3)}`;
}

export async function providerRoutes(app: FastifyInstance): Promise<void> {
  /** F1 — Onboarding do prestador (assistido no piloto). */
  app.post(
    "/api/providers",
    { preHandler: isSupabaseAuthEnabled ? requireAuthUser : undefined },
    async (req, reply) => {
    const parsed = createProviderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos", issues: parsed.error.issues });
    }
    const body = parsed.data;

    // Valida o formato da chave Pix já no cadastro (critério de aceite F1).
    let keyInfo;
    try {
      keyInfo = parsePixKey(body.pixKey);
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "Chave Pix inválida",
      });
    }

    const id = newId();
    const token = isSupabaseAuthEnabled ? null : newApiToken();
    const now = new Date().toISOString();

    if (req.authUser) {
      const existing = await queryOne<ProviderRow>(
        "SELECT * FROM providers WHERE auth_user_id = ?",
        req.authUser.id,
      );
      if (existing) {
        return reply.code(409).send({ error: "Onboarding já concluído" });
      }
    }

    await execute(
      `INSERT INTO providers (id, auth_user_id, email, name, profession, photo_url, city, pix_key, pix_key_type, whatsapp, api_token, consent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      req.authUser?.id ?? null,
      req.authUser?.email ?? null,
      body.name,
      body.profession,
      body.photoUrl ?? null,
      body.city ?? null,
      keyInfo.normalized,
      keyInfo.type,
      body.whatsapp,
      token,
      now,
      now,
    );

    const provider = (await queryOne<ProviderRow>(
      "SELECT * FROM providers WHERE id = ?",
      id,
    ))!;
    return reply.code(201).send({
      provider: publicProvider(provider),
      // Existe apenas no modo local/teste. Produção usa a sessão Supabase.
      ...(token ? { apiToken: token } : {}),
    });
    },
  );

  /** Prestador autenticado (usado pelo painel para render do cabeçalho). */
  app.get("/api/providers/me", { preHandler: requireProvider }, async (req) => {
    return { provider: publicProvider(req.provider!) };
  });
}
