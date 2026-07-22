function env(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(env(name, String(fallback)));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Variável de ambiente deve ser um inteiro positivo: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(env("PORT", "3333")),
  publicWebUrl: env("PUBLIC_WEB_URL", "http://localhost:3000").replace(/\/$/, ""),
  databaseUrl: requiredEnv("DATABASE_URL"),
  databasePoolSize: Number(env("DATABASE_POOL_SIZE", "5")),
  databaseSsl: env("DATABASE_SSL", "true") !== "false",
  corsOrigins: env("CORS_ORIGINS", "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  whatsapp: {
    mode: env("WHATSAPP_MODE", "log") as "log" | "cloud-api",
    phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"),
    accessToken: env("WHATSAPP_ACCESS_TOKEN"),
    templateLang: env("WHATSAPP_TEMPLATE_LANG", "pt_BR"),
    // Webhook inbound: verify token (handshake GET) e app secret (assinatura
    // X-Hub-Signature-256 dos POSTs). Só exigidos quando o inbound está ativo.
    verifyToken: env("WHATSAPP_VERIFY_TOKEN"),
    appSecret: env("WHATSAPP_APP_SECRET"),
    guardrail: {
      perMinute: positiveIntegerEnv("WHATSAPP_RATE_LIMIT_PER_MINUTE", 10),
      perDay: positiveIntegerEnv("WHATSAPP_DAILY_MESSAGE_LIMIT", 100),
      maxMessageLength: positiveIntegerEnv("WHATSAPP_MAX_MESSAGE_LENGTH", 1_000),
      globalDailyAiLimit: positiveIntegerEnv("WHATSAPP_GLOBAL_DAILY_AI_LIMIT", 5_000),
      cooldownMinutes: positiveIntegerEnv("WHATSAPP_ABUSE_COOLDOWN_MINUTES", 30),
      invalidStreakLimit: positiveIntegerEnv("WHATSAPP_INVALID_STREAK_LIMIT", 3),
    },
  },
  supabase: {
    url: requiredEnv("SUPABASE_URL"),
    anonKey: requiredEnv("SUPABASE_ANON_KEY"),
    serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    receiptsBucket: env("SUPABASE_RECEIPTS_BUCKET", "receipts"),
    signedUrlTtlSeconds: Number(env("SIGNED_URL_TTL_SECONDS", "300")),
  },
  openai: {
    apiKey: env("OPENAI_API_KEY"),
    model: env("OPENAI_MODEL", "gpt-5.4-nano"),
    timeoutMs: Number(env("OPENAI_TIMEOUT_MS", "15000")),
  },
  cronSecret: env("CRON_SECRET"),
} as const;
