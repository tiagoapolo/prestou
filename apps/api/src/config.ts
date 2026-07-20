function env(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
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
  },
  supabase: {
    url: requiredEnv("SUPABASE_URL"),
    anonKey: requiredEnv("SUPABASE_ANON_KEY"),
    serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    receiptsBucket: env("SUPABASE_RECEIPTS_BUCKET", "receipts"),
    signedUrlTtlSeconds: Number(env("SIGNED_URL_TTL_SECONDS", "300")),
  },
  cronSecret: env("CRON_SECRET"),
} as const;
