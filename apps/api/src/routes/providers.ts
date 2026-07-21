import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parsePixKey } from "@prestou/pix";
import { execute, queryOne } from "../db.js";
import { newId } from "../ids.js";
import { requireAuthUser, requireProvider } from "../auth.js";
import type { ProviderRow } from "../types.js";
import { mobileSchema, requiredText, validationMessage } from "../validation.js";
import { loadMunicipalities, municipalityExists, searchMunicipalities } from "../municipalities.js";

const municipalitySchema = z.object({
  name: requiredText("Cidade/município", 2, 60),
  state: z.string().regex(/^[A-Z]{2}$/, "UF inválida"),
  ibgeCode: z.string().regex(/^\d{7}$/, "Código do município inválido"),
});

const createProviderSchema = z.object({
  name: requiredText("Nome", 2, 80),
  profession: requiredText("Profissão", 2, 60),
  whatsapp: mobileSchema,
  pixKey: requiredText("Chave Pix", 3, 80),
  municipality: municipalitySchema.optional(),
  photoUrl: z.string().url().max(500).optional(),
  /** Aceite do termo LGPD — obrigatório no onboarding (F1). */
  consent: z.literal(true, {
    errorMap: () => ({ message: "Consentimento é obrigatório" }),
  }),
});

function publicProvider(p: ProviderRow) {
  return {
    id: p.id,
    name: p.name,
    profession: p.profession,
    photoUrl: p.photo_url,
    city: p.city,
    state: p.state,
    municipalityCode: p.municipality_code,
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
  app.get<{ Querystring: { q?: string } }>(
    "/api/municipalities",
    { preHandler: requireAuthUser },
    async (req, reply) => {
      const query = z.string().trim().min(2).max(60).safeParse(req.query.q);
      if (!query.success) {
        return reply.code(400).send({ error: "Digite ao menos 2 letras para buscar" });
      }
      try {
        const municipalities = searchMunicipalities(query.data, await loadMunicipalities());
        return { municipalities };
      } catch (error) {
        req.log.error({ error }, "municipality search failed");
        return reply.code(503).send({ error: "Busca de municípios indisponível no momento" });
      }
    },
  );

  /** F1 — Onboarding do prestador (assistido no piloto). */
  app.post(
    "/api/providers",
    { preHandler: requireAuthUser },
    async (req, reply) => {
    const parsed = createProviderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: validationMessage(parsed.error), issues: parsed.error.issues });
    }
    const body = parsed.data;

    if (body.municipality) {
      try {
        if (!municipalityExists(body.municipality, await loadMunicipalities())) {
          return reply.code(400).send({ error: "Cidade/município não corresponde à lista oficial do IBGE" });
        }
      } catch (error) {
        req.log.error({ error }, "municipality validation failed");
        return reply.code(503).send({ error: "Não foi possível validar o município no momento" });
      }
    }

    // Valida o formato da chave Pix já no cadastro (critério de aceite F1).
    let keyInfo;
    try {
      keyInfo = parsePixKey(body.pixKey);
    } catch {
      return reply.code(400).send({
        error: "Chave Pix inválida. Confira o formato e tente novamente.",
      });
    }

    const id = newId();
    const now = new Date().toISOString();

    const existing = await queryOne<ProviderRow>(
      "SELECT * FROM providers WHERE auth_user_id = ?",
      req.authUser!.id,
    );
    if (existing) {
      return reply.code(409).send({ error: "Onboarding já concluído" });
    }

    await execute(
      `INSERT INTO providers (id, auth_user_id, email, name, profession, photo_url, city, state, municipality_code, pix_key, pix_key_type, whatsapp, consent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      req.authUser!.id,
      req.authUser!.email,
      body.name,
      body.profession,
      body.photoUrl ?? null,
      body.municipality?.name ?? null,
      body.municipality?.state ?? null,
      body.municipality?.ibgeCode ?? null,
      keyInfo.normalized,
      keyInfo.type,
      body.whatsapp,
      now,
      now,
    );

    const provider = (await queryOne<ProviderRow>(
      "SELECT * FROM providers WHERE id = ?",
      id,
    ))!;
    return reply.code(201).send({
      provider: publicProvider(provider),
    });
    },
  );

  /** Prestador autenticado (usado pelo painel para render do cabeçalho). */
  app.get("/api/providers/me", { preHandler: requireProvider }, async (req) => {
    return { provider: publicProvider(req.provider!) };
  });
}
