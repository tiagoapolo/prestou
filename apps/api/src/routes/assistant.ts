import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { interpretChargeMessage, type AssistantClient } from "../assistant.js";
import { requireProvider } from "../auth.js";
import { config } from "../config.js";
import { queryAll } from "../db.js";

const assistantRequestSchema = z.object({
  message: z.string().trim().min(3).max(500),
}).strict();

export async function assistantRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireProvider);

  app.post("/api/assistant/interpret", async (req, reply) => {
    const parsed = assistantRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Escreva um pedido entre 3 e 500 caracteres." });
    }
    if (!config.openai.apiKey) {
      return reply.code(503).send({
        error: "O assistente ainda não está configurado.",
        code: "ASSISTANT_UNAVAILABLE",
      });
    }

    const clients = await queryAll<AssistantClient>(
      "SELECT id, name, whatsapp FROM clients WHERE provider_id = ? ORDER BY name",
      req.provider!.id,
    );
    const result = await interpretChargeMessage(parsed.data.message, {
      apiKey: config.openai.apiKey,
      model: config.openai.model,
      providerId: req.provider!.id,
      clients,
      timeoutMs: config.openai.timeoutMs,
    });
    return reply.send(result);
  });
}
