import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireProvider } from "../auth.js";
import { funnel, track, type EventType } from "../analytics.js";
import { runReminders } from "../reminders.js";
import { config } from "../config.js";

const eventSchema = z.object({
  type: z.enum([
    "cobranca_criada",
    "mensagem_enviada",
    "link_aberto",
    "codigo_copiado",
    "cliente_confirmou",
    "prestador_confirmou",
    "marcado_pago_manual",
    "contestacao_aberta",
    "lembrete_disparado",
    "lembrete_enviado",
  ]),
  chargeId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function insightRoutes(app: FastifyInstance): Promise<void> {
  /** Ingestão de eventos disparados pelo painel do prestador. */
  app.post("/api/events", { preHandler: requireProvider }, async (req, reply) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Evento inválido", issues: parsed.error.issues });
    }
    await track({
      type: parsed.data.type as EventType,
      providerId: req.provider!.id,
      chargeId: parsed.data.chargeId ?? null,
      paymentId: parsed.data.paymentId ?? null,
      metadata: parsed.data.metadata,
    });
    return { ok: true };
  });

  /** Dashboard interno do funil — inclui o vazamento que decide o PSP na V2. */
  app.get("/api/insights/funnel", { preHandler: requireProvider }, async (req) => {
    return await funnel(req.provider!.id);
  });

  /**
   * Disparo dos lembretes (F8). Em produção quem chama é um cron externo;
   * em dev o servidor também roda de tempos em tempos (ver server.ts).
   */
  app.post("/api/internal/run-reminders", async (req, reply) => {
    const secret = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    if (!process.env.NODE_ENV?.includes("test") && (!config.cronSecret || secret !== config.cronSecret)) {
      return reply.code(401).send({ error: "Cron não autorizado" });
    }
    const result = await runReminders();
    return reply.send(result);
  });
}
