import { randomBytes, randomUUID } from "node:crypto";

/** ID interno de entidade (UUID v4). */
export function newId(): string {
  return randomUUID();
}

/**
 * Token público não-adivinhável para a URL de pagamento.
 * 24 bytes → 32 chars base64url. Sem informação previsível.
 */
export function newPublicToken(): string {
  return randomBytes(24).toString("base64url");
}
