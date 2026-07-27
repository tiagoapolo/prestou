import type { FastifyInstance } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAppAdmin } from "../auth.js";
import { config } from "../config.js";
import { queryAll, queryOne, withTransaction } from "../db.js";
import { deleteReceipts } from "../storage.js";

const PAGE_SIZE = 25;

const adminAuth = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const listProvidersQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(200).optional(),
});

interface AdminProviderRow {
  id: string;
  name: string;
  email: string | null;
  whatsapp: string;
  profession: string;
  city: string | null;
  state: string | null;
  created_at: string;
}

interface ProviderDeletionRow {
  id: string;
  auth_user_id: string | null;
  whatsapp: string;
}

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

function decodeCursor(value: string): z.infer<typeof cursorSchema> | null {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

function encodeCursor(row: AdminProviderRow): string {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id })).toString("base64url");
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string; cursor?: string } }>(
    "/api/admin/providers",
    { preHandler: requireAppAdmin },
    async (req, reply) => {
      const parsed = listProvidersQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Parâmetros de busca inválidos." });
      }

      const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : undefined;
      if (parsed.data.cursor && !cursor) {
        return reply.code(400).send({ error: "Cursor de paginação inválido." });
      }

      const filters: string[] = [];
      const params: string[] = [];
      if (parsed.data.q) {
        const term = `%${parsed.data.q}%`;
        filters.push("(name ILIKE ? OR email ILIKE ? OR whatsapp ILIKE ?)");
        params.push(term, term, term);
      }
      if (cursor) {
        filters.push("(created_at, id) < (?::timestamptz, ?::uuid)");
        params.push(cursor.createdAt, cursor.id);
      }

      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const rows = await queryAll<AdminProviderRow>(
        `SELECT id, name, email, whatsapp, profession, city, state, created_at
         FROM providers
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        ...params,
        PAGE_SIZE + 1,
      );
      const hasMore = rows.length > PAGE_SIZE;
      const page = rows.slice(0, PAGE_SIZE);
      const last = page.at(-1);

      return {
        providers: page.map((provider) => ({
          id: provider.id,
          name: provider.name,
          email: provider.email,
          whatsapp: provider.whatsapp,
          profession: provider.profession,
          city: provider.city,
          state: provider.state,
          createdAt: provider.created_at,
        })),
        nextCursor: hasMore && last ? encodeCursor(last) : null,
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/admin/providers/:id",
    { preHandler: requireAppAdmin },
    async (req, reply) => {
      const providerId = z.string().uuid().safeParse(req.params.id);
      if (!providerId.success) {
        return reply.code(400).send({ error: "Usuário inválido." });
      }

      const provider = await queryOne<ProviderDeletionRow>(
        "SELECT id, auth_user_id, whatsapp FROM providers WHERE id = ?",
        providerId.data,
      );
      if (!provider) return reply.code(404).send({ error: "Usuário não encontrado." });
      if (!provider.auth_user_id) {
        return reply.code(409).send({ error: "Este usuário não possui uma identidade de acesso válida." });
      }
      if (provider.auth_user_id === req.authUser!.id) {
        return reply.code(409).send({ error: "Você não pode remover sua própria conta administrativa." });
      }

      const receipts = await queryAll<{ comprovante_path: string }>(
        `SELECT payments.comprovante_path
           FROM payments
           JOIN charges ON charges.id = payments.charge_id
          WHERE charges.provider_id = ? AND payments.comprovante_path IS NOT NULL`,
        provider.id,
      );
      await deleteReceipts(receipts.map((receipt) => receipt.comprovante_path));

      await withTransaction(async (tx) => {
        await tx.execute(
          "UPDATE private.whatsapp_signup_invites SET created_by = ? WHERE created_by = ?",
          req.authUser!.id,
          provider.auth_user_id!,
        );
        await tx.execute(
          `DELETE FROM private.whatsapp_signup_invites
            WHERE id IN (
              SELECT invite_id FROM private.whatsapp_onboarding_sessions
               WHERE auth_user_id = ?
            )`,
          provider.auth_user_id!,
        );
        await tx.execute(
          `DELETE FROM private.whatsapp_verification_sends
            WHERE (scope = 'provider_day' AND scope_id = ?)
               OR (scope = 'candidate_day' AND scope_id = ?)`,
          provider.id,
          provider.whatsapp,
        );
        await tx.execute(
          "DELETE FROM private.whatsapp_guardrail_buckets WHERE scope_id = ?",
          provider.id,
        );
        await tx.execute(
          "DELETE FROM private.whatsapp_onboarding_counters WHERE scope = 'phone_day' AND scope_id = ?",
          provider.whatsapp,
        );
        await tx.execute(
          "DELETE FROM private.whatsapp_onboarding_messages WHERE phone = ?",
          provider.whatsapp,
        );
      });

      const deleted = await adminAuth.auth.admin.deleteUser(provider.auth_user_id);
      if (deleted.error) {
        req.log.error({ err: deleted.error, providerId: provider.id }, "admin provider deletion failed");
        return reply.code(502).send({ error: "Não foi possível remover a conta de acesso." });
      }

      return { deleted: true };
    },
  );
}
