export type PixKeyType = "cpf" | "cnpj" | "phone" | "email" | "evp";

export interface PixKeyInfo {
  type: PixKeyType;
  /** Chave normalizada no formato que os bancos esperam ler dentro do BR Code. */
  normalized: string;
}

const ONLY_DIGITS = /\D/g;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EVP_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Detecta o tipo da chave Pix e devolve a forma normalizada.
 * Regras de normalização seguem o que o app do banco lê no BR Code:
 * - CPF/CNPJ: apenas dígitos
 * - Telefone: E.164 com +55 (ex.: +5511999998888)
 * - E-mail: minúsculas, sem espaços
 * - EVP (aleatória): UUID em minúsculas
 *
 * Lança Error se a chave não casar com nenhum formato válido.
 */
export function parsePixKey(raw: string): PixKeyInfo {
  const key = raw.trim();
  if (!key) throw new Error("Chave Pix vazia");

  if (EMAIL_RE.test(key)) {
    const normalized = key.toLowerCase();
    if (normalized.length > 77) throw new Error("E-mail excede 77 caracteres");
    return { type: "email", normalized };
  }

  if (EVP_RE.test(key)) {
    return { type: "evp", normalized: key.toLowerCase() };
  }

  const digits = key.replace(ONLY_DIGITS, "");

  // Telefone: com DDI (+55) explícito, ou 10/11 dígitos nacionais.
  if (key.startsWith("+")) {
    if (digits.length < 12 || digits.length > 13) {
      throw new Error("Telefone internacional inválido");
    }
    return { type: "phone", normalized: `+${digits}` };
  }

  // 11 dígitos são ambíguos entre CPF e celular (DDD + 9 + número).
  // Desambiguação: se passa na validação de CPF, é CPF (chave mais comum);
  // senão, se parece celular (3º dígito 9), é telefone.
  if (digits.length === 11) {
    if (isValidCpf(digits)) return { type: "cpf", normalized: digits };
    if (looksLikeMobile(digits)) {
      return { type: "phone", normalized: `+55${digits}` };
    }
    throw new Error("CPF inválido / telefone não reconhecido");
  }
  if (digits.length === 10) {
    // Telefone fixo nacional (DDD + 8 dígitos).
    return { type: "phone", normalized: `+55${digits}` };
  }
  if (digits.length === 14) {
    return { type: "cnpj", normalized: digits };
  }

  throw new Error(`Chave Pix em formato não reconhecido: "${raw}"`);
}

/** Heurística: 11 dígitos com 3º dígito 9 é celular (DDD + 9 + número). */
function looksLikeMobile(digits: string): boolean {
  return digits.length === 11 && digits[2] === "9";
}

/** Validação de dígitos verificadores de CPF. */
export function isValidCpf(input: string): boolean {
  const cpf = input.replace(ONLY_DIGITS, "");
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // todos iguais

  const digitAt = (i: number): number => Number(cpf[i]);

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += digitAt(i) * (10 - i);
  let check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  if (check !== digitAt(9)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += digitAt(i) * (11 - i);
  check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  return check === digitAt(10);
}
