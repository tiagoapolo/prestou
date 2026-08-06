import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parsePixKey } from "@prestou/pix";
import { execute, queryOne, withTransaction } from "../db.js";
import { newId } from "../ids.js";
import { isAppAdmin, requireAuthUser, requireProvider } from "../auth.js";
import type { ProviderRow } from "../types.js";
import { requiredText, validationMessage } from "../validation.js";
import { loadMunicipalities, municipalityExists, searchMunicipalities } from "../municipalities.js";
import {
  consumeLockedOnboarding,
  lockOnboardingForProvider,
} from "../whatsapp-onboarding.js";
import { track } from "../analytics.js";

const municipalitySchema = z.object({
  name: requiredText("Cidade/município", 2, 60),
  state: z.string().regex(/^[A-Z]{2}$/, "UF inválida"),
  ibgeCode: z.string().regex(/^\d{7}$/, "Código do município inválido"),
});

const createProviderSchema = z.object({
  name: requiredText("Nome", 2, 80),
  profession: requiredText("Profissão", 2, 60),
  onboardingToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Convite inválido"),
  pixKey: requiredText("Chave Pix", 3, 80),
  municipality: municipalitySchema.optional(),
  photoUrl: z.string().url().max(500).optional(),
  /** Aceite do termo LGPD — obrigatório no onboarding (F1). */
  consent: z.literal(true, {
    errorMap: () => ({ message: "Consentimento é obrigatório" }),
  }),
}).strict();

// O número de WhatsApp não é editável aqui: ele só muda por verificação
// (start/confirm em /api/whatsapp/number), para nunca divergir do número provado.
const updateSettingsSchema = z.object({
  pixKey: requiredText("Chave Pix", 3, 80),
  defaultDueDays: z.union([
    z.literal(0), z.literal(1), z.literal(5), z.literal(15), z.literal(30),
  ]).optional(),
}).strict();

function publicProvider(p: ProviderRow, admin = false) {
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
    defaultDueDays: p.default_due_days,
    admin,
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

    try {
      await withTransaction(async (tx) => {
        const onboarding = await lockOnboardingForProvider(
          tx,
          body.onboardingToken,
          req.authUser!.id,
        );
        if (!onboarding) {
          const error = new Error("Convite inválido ou expirado.") as Error & { statusCode: number };
          error.statusCode = 409;
          throw error;
        }
        await tx.execute(
          `INSERT INTO providers
             (id, auth_user_id, email, name, profession, photo_url, city, state,
              municipality_code, pix_key, pix_key_type, whatsapp,
              whatsapp_verified_at, consent_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          onboarding.phone,
          onboarding.phoneVerifiedAt,
          now,
          now,
        );
        await track({ type: "cadastro_conta_criada", providerId: id, onboardingJourneyId: onboarding.journeyId }, tx);
        await consumeLockedOnboarding(tx, onboarding);
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "Este WhatsApp já possui uma conta Prestou." });
      }
      if ((error as { statusCode?: number }).statusCode === 409) {
        return reply.code(409).send({ error: "Convite inválido, expirado ou já utilizado." });
      }
      throw error;
    }

    const provider = (await queryOne<ProviderRow>(
      "SELECT * FROM providers WHERE id = ?",
      id,
    ))!;
    return reply.code(201).send({
      provider: publicProvider(provider, await isAppAdmin(req.authUser!.id)),
    });
    },
  );

  /** Prestador autenticado (usado pelo painel para render do cabeçalho). */
  app.get("/api/providers/me", { preHandler: requireProvider }, async (req) => {
    return {
      provider: publicProvider(req.provider!, await isAppAdmin(req.authUser!.id)),
    };
  });

  app.get("/api/providers/me/settings", { preHandler: requireProvider }, async (req) => {
    return {
      settings: {
        pixKey: req.provider!.pix_key,
        whatsapp: req.provider!.whatsapp,
        defaultDueDays: req.provider!.default_due_days,
      },
    };
  });

  app.patch("/api/providers/me/settings", { preHandler: requireProvider }, async (req, reply) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: validationMessage(parsed.error),
        issues: parsed.error.issues,
      });
    }

    let keyInfo;
    try {
      keyInfo = parsePixKey(parsed.data.pixKey);
    } catch {
      return reply.code(400).send({
        error: "Chave Pix inválida. Confira o formato e tente novamente.",
      });
    }

    const defaultDueDays = parsed.data.defaultDueDays
      ?? req.provider!.default_due_days;

    await execute(
      `UPDATE providers
       SET pix_key = ?, pix_key_type = ?, default_due_days = ?
       WHERE id = ?`,
      keyInfo.normalized,
      keyInfo.type,
      defaultDueDays,
      req.provider!.id,
    );

    return {
      settings: {
        pixKey: keyInfo.normalized,
        whatsapp: req.provider!.whatsapp,
        defaultDueDays,
      },
    };
  });
}
