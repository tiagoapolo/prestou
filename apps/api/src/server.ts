import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { providerRoutes } from "./routes/providers.js";
import { chargeRoutes } from "./routes/charges.js";
import { paymentRoutes } from "./routes/payments.js";
import { publicRoutes } from "./routes/public.js";
import { insightRoutes } from "./routes/insights.js";
import { actionProposalRoutes } from "./routes/action-proposals.js";
import { runReminders } from "./reminders.js";
import { closeDatabase } from "./db.js";
import { publicErrorMessage } from "./public-errors.js";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
    },
  });

  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    credentials: true,
  });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // comprovante: 10 MB
  });

  app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  await app.register(providerRoutes);
  await app.register(chargeRoutes);
  await app.register(paymentRoutes);
  await app.register(publicRoutes);
  await app.register(insightRoutes);
  await app.register(actionProposalRoutes);

  app.setNotFoundHandler((_req, reply) => {
    return reply.code(404).send({ error: "Endereço não encontrado" });
  });

  app.setErrorHandler((error, req, reply) => {
    const reportedStatus = typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
    const statusCode = reportedStatus >= 400 && reportedStatus < 500 ? reportedStatus : 500;
    const logContext = { err: error, method: req.method, url: req.url };
    if (statusCode >= 500) req.log.error(logContext, "request failed");
    else req.log.warn(logContext, "request rejected");

    return reply.code(statusCode).send({
      error: publicErrorMessage(statusCode),
      ...(statusCode >= 500 ? { code: "INTERNAL_ERROR" } : {}),
    });
  });

  app.addHook("onClose", async () => {
    await closeDatabase();
  });

  return app;
}

const isMain = process.argv[1]?.includes("server");

if (isMain) {
  const app = await buildServer();
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(
      `Prestou API on :${config.port} — DB: Supabase PostgreSQL — WhatsApp: ${config.whatsapp.mode}`,
    );

    // Em dev, roda os lembretes de hora em hora. Em produção use um cron externo
    // chamando POST /api/internal/run-reminders.
    if (process.env.NODE_ENV !== "production") {
      setInterval(
        () => {
          runReminders().catch((err) => app.log.error({ err }, "reminders failed"));
        },
        60 * 60 * 1000,
      ).unref();
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
