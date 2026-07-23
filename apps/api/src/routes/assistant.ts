import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { interpretChargeMessage, type AssistantClient } from "../assistant.js";
import { interpretMessage } from "../orchestrator.js";
import { dbDeps } from "../assistant-data.js";
import { dbChargeMemory } from "../charge-memory.js";
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
      defaultDueDays: req.provider!.default_due_days,
      timeoutMs: config.openai.timeoutMs,
    });
    return reply.send(result);
  });

  /**
   * Porta de teste do orquestrador completo (leitura + cobrança), servida pela
   * mesma identidade JWT do Dashboard. É o banco de testes local do "cérebro"
   * antes de expô-lo ao WhatsApp — o adaptador de canal chama o mesmo
   * `interpretMessage`.
   */
  app.post("/api/assistant/chat", async (req, reply) => {
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

    const result = await interpretMessage({
      providerId: req.provider!.id,
      message: parsed.data.message,
      deps: dbDeps,
      apiKey: config.openai.apiKey,
      model: config.openai.model,
      defaultDueDays: req.provider!.default_due_days,
      timeoutMs: config.openai.timeoutMs,
      memory: dbChargeMemory,
    });
    return reply.send(result);
  });
}
