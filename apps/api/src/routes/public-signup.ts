import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { track, type TrackInput } from "../analytics.js";
import { config, type WhatsAppSignupMode } from "../config.js";
import {
  createPublicSignupMessage,
  signupAttributionSchema,
  type SignupAttribution,
} from "../public-signup.js";

interface PublicSignupRoutesOptions {
  mode?: () => WhatsAppSignupMode;
  publicPhone?: string;
  onboardingSecret?: string;
  track?: (input: TrackInput) => Promise<void>;
}

function whatsappUrl(phone: string, message: string): string {
  if (!/^\d{10,15}$/.test(phone)) {
    throw new Error("WHATSAPP_PUBLIC_PHONE inválido");
  }
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function eventMetadata(attribution: SignupAttribution): Record<string, string> {
  return { entryMode: "public", ...attribution };
}

export async function publicSignupRoutes(
  app: FastifyInstance,
  options: PublicSignupRoutesOptions = {},
): Promise<void> {
  const mode = options.mode ?? (() => config.whatsapp.signup.mode);
  const publicPhone = options.publicPhone ?? config.whatsapp.publicPhone;
  const onboardingSecret = options.onboardingSecret
    ?? config.whatsapp.signup.onboardingSecret
    ?? config.supabase.serviceRoleKey;
  const trackEntry = options.track ?? track;

  app.get("/public/whatsapp-signup", async () => ({ isAvailable: mode() === "public" }));

  app.post("/public/whatsapp-signup-entries", async (req, reply) => {
    if (mode() !== "public") {
      return reply.code(404).send({ error: "Cadastro pelo WhatsApp não está disponível." });
    }
    const parsed = signupAttributionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Origem de campanha inválida." });
    }

    const journeyId = randomUUID();
    const message = createPublicSignupMessage({
      journeyId,
      attribution: parsed.data,
      secret: onboardingSecret,
    });
    await trackEntry({
      type: "cadastro_entrada_aberta",
      onboardingJourneyId: journeyId,
      metadata: eventMetadata(parsed.data),
    });
    return { whatsappUrl: whatsappUrl(publicPhone, message) };
  });
}
