import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAppAdmin } from "../auth.js";
import { queryAll } from "../db.js";

const PAGE_SIZE = 25;

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
}
