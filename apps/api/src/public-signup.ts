import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const PUBLIC_SIGNUP_MESSAGE = "Quero começar no Prestou";
const PUBLIC_SIGNUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;

const attributionValueSchema = (maxLength: number) => z.string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(maxLength)
  .regex(/^[a-z0-9._-]+$/);

export const signupAttributionSchema = z.object({
  source: attributionValueSchema(32).optional(),
  medium: attributionValueSchema(32).optional(),
  campaign: attributionValueSchema(64).optional(),
  content: attributionValueSchema(64).optional(),
}).strict();

export type SignupAttribution = z.infer<typeof signupAttributionSchema>;

interface SignedSignupPayload {
  version: 1;
  journeyId: string;
  expiresAt: number;
  attribution: SignupAttribution;
}

const signedSignupPayloadSchema = z.object({
  version: z.literal(1),
  journeyId: z.string().uuid(),
  expiresAt: z.number().int().positive(),
  attribution: signupAttributionSchema,
}).strict();

export interface CreatePublicSignupMessageInput {
  journeyId: string;
  attribution: SignupAttribution;
  secret: string;
  now?: number;
}

export interface ParsePublicSignupIntentOptions {
  secret: string;
  now?: number;
}

export type PublicSignupIntent =
  | { type: "public"; journeyId: string; attribution: SignupAttribution }
  | { type: "public"; attribution: { source: "direct"; medium: "unknown" } };

const directAttribution = { source: "direct", medium: "unknown" } as const;

function signatureFor(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function hasValidSignature(payload: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signatureFor(payload, secret));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function parseSignedPayload(token: string, secret: string, now: number): SignedSignupPayload | undefined {
  const match = /^([A-Za-z0-9_-]{1,1024})\.([A-Za-z0-9_-]{1,128})$/.exec(token);
  const encoded = match?.[1];
  const signature = match?.[2];
  if (!encoded || !signature || !hasValidSignature(encoded, signature, secret)) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const parsed = signedSignupPayloadSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.expiresAt <= now) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

export function createPublicSignupMessage(input: CreatePublicSignupMessageInput): string {
  const now = input.now ?? Date.now();
  const payload = signedSignupPayloadSchema.parse({
    version: 1,
    journeyId: input.journeyId,
    expiresAt: now + PUBLIC_SIGNUP_TOKEN_TTL_MS,
    attribution: input.attribution,
  });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${PUBLIC_SIGNUP_MESSAGE} ${encoded}.${signatureFor(encoded, input.secret)}`;
}

export function parsePublicSignupIntent(
  message: string,
  options: ParsePublicSignupIntentOptions,
): PublicSignupIntent | undefined {
  const normalized = message.trim();
  if (normalized !== PUBLIC_SIGNUP_MESSAGE && !normalized.startsWith(`${PUBLIC_SIGNUP_MESSAGE} `)) {
    return undefined;
  }
  const token = normalized.slice(PUBLIC_SIGNUP_MESSAGE.length).trim();
  if (!token) return { type: "public", attribution: directAttribution };

  const payload = parseSignedPayload(token, options.secret, options.now ?? Date.now());
  if (!payload) return { type: "public", attribution: directAttribution };
  return {
    type: "public",
    journeyId: payload.journeyId,
    attribution: payload.attribution,
  };
}
