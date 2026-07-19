import { resolve } from "node:path";

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export const config = {
  port: Number(env("PORT", "3333")),
  publicWebUrl: env("PUBLIC_WEB_URL", "http://localhost:3000").replace(/\/$/, ""),
  databasePath: resolve(env("DATABASE_PATH", "./data/prestou.db")),
  databaseUrl: env("DATABASE_URL", ""),
  databasePoolSize: Number(env("DATABASE_POOL_SIZE", "5")),
  databaseSsl: env("DATABASE_SSL", "true") !== "false",
  uploadsDir: resolve(env("UPLOADS_DIR", "./data/uploads")),
  corsOrigins: env("CORS_ORIGINS", "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  whatsapp: {
    mode: env("WHATSAPP_MODE", "log") as "log" | "cloud-api",
    phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID", ""),
    accessToken: env("WHATSAPP_ACCESS_TOKEN", ""),
    templateLang: env("WHATSAPP_TEMPLATE_LANG", "pt_BR"),
  },
  supabase: {
    url: env("SUPABASE_URL", ""),
    anonKey: env("SUPABASE_ANON_KEY", ""),
    serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY", ""),
    receiptsBucket: env("SUPABASE_RECEIPTS_BUCKET", "receipts"),
    signedUrlTtlSeconds: Number(env("SIGNED_URL_TTL_SECONDS", "300")),
  },
  cronSecret: env("CRON_SECRET", ""),
} as const;
