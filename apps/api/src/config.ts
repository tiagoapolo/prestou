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

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = env(name, fallback ? "true" : "false");
  if (value !== "true" && value !== "false") {
    throw new Error(`Variável de ambiente deve ser true ou false: ${name}`);
  }
  return value === "true";
}

function enumEnv<const T extends readonly string[]>(
  name: string,
  values: T,
  fallback: T[number],
): T[number] {
  const value = env(name, fallback);
  if (!(values as readonly string[]).includes(value)) {
    throw new Error(`Variável de ambiente inválida: ${name}`);
  }
  return value as T[number];
}

export const config = {
  nodeEnv: enumEnv("NODE_ENV", ["development", "test", "production"] as const, "development"),
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
    mode: enumEnv("WHATSAPP_MODE", ["log", "cloud-api"] as const, "log"),
    phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"),
    publicPhone: env("WHATSAPP_PUBLIC_PHONE", "5541963491134"),
    accessToken: env("WHATSAPP_ACCESS_TOKEN"),
    templateLang: env("WHATSAPP_TEMPLATE_LANG", "pt_BR"),
    // Webhook inbound: verify token (handshake GET) e app secret (assinatura
    // X-Hub-Signature-256 dos POSTs). Só exigidos quando o inbound está ativo.
    verifyToken: env("WHATSAPP_VERIFY_TOKEN"),
    appSecret: env("WHATSAPP_APP_SECRET"),
    // Template de autenticação aprovado na Meta para entregar o OTP. Obrigatório
    // no modo cloud-api (código nunca vai em texto livre).
    authTemplate: env("WHATSAPP_AUTH_TEMPLATE"),
    // Segredo do HMAC-SHA-256 dos códigos de verificação. Sem env dedicada,
    // deriva do service role key (segredo forte, só no servidor) — evita ops
    // extra no piloto sem guardar o código em claro.
    verificationSecret: env("WHATSAPP_VERIFICATION_SECRET"),
    signup: {
      enabled: booleanEnv("WHATSAPP_SIGNUP_ENABLED", false),
      template: env("WHATSAPP_SIGNUP_TEMPLATE", "convite_prestador"),
      onboardingSecret: env("WHATSAPP_ONBOARDING_SECRET"),
      turnstileSecret: env("TURNSTILE_SECRET_KEY"),
      sessionTtlMinutes: positiveIntegerEnv("WHATSAPP_ONBOARDING_SESSION_TTL_MINUTES", 24 * 60),
      linkTtlMinutes: positiveIntegerEnv("WHATSAPP_ONBOARDING_LINK_TTL_MINUTES", 15),
      globalDailyLimit: positiveIntegerEnv("WHATSAPP_SIGNUP_GLOBAL_DAILY_LIMIT", 50),
      phoneDailyLimit: positiveIntegerEnv("WHATSAPP_SIGNUP_PHONE_DAILY_LIMIT", 3),
      emailCooldownSeconds: positiveIntegerEnv("WHATSAPP_SIGNUP_EMAIL_COOLDOWN_SECONDS", 60),
    },
    verification: {
      ttlMinutes: positiveIntegerEnv("WHATSAPP_VERIFICATION_TTL_MINUTES", 10),
      resendCooldownSeconds: positiveIntegerEnv("WHATSAPP_VERIFICATION_RESEND_SECONDS", 60),
      maxAttempts: positiveIntegerEnv("WHATSAPP_VERIFICATION_MAX_ATTEMPTS", 5),
      // Tetos diários de envio de código, aplicados atomicamente no banco.
      providerDailyLimit: positiveIntegerEnv("WHATSAPP_VERIFICATION_PROVIDER_DAILY", 5),
      candidateDailyLimit: positiveIntegerEnv("WHATSAPP_VERIFICATION_CANDIDATE_DAILY", 5),
      globalDailyLimit: positiveIntegerEnv("WHATSAPP_VERIFICATION_GLOBAL_DAILY", 1_000),
    },
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
