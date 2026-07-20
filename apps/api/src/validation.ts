import { z } from "zod";

export function normalizeMobile(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 13 && digits.startsWith("55") ? digits.slice(2) : digits;
}

export const mobileSchema = z.string({
  required_error: "Celular é obrigatório",
  invalid_type_error: "Celular deve ser um texto",
}).trim().transform(normalizeMobile).refine(
  (value) => /^[1-9]\d9\d{8}$/.test(value),
  "Informe um celular válido com DDD",
);

export const isoDateSchema = z.string({
  required_error: "Data é obrigatória",
  invalid_type_error: "Data deve estar no formato AAAA-MM-DD",
}).refine((value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day);
}, "Informe uma data válida no formato AAAA-MM-DD");

export const amountCentsSchema = z.number({
  required_error: "Valor é obrigatório",
  invalid_type_error: "Valor inválido",
}).int("Valor inválido").positive("Valor deve ser maior que zero").max(
  9_999_999,
  "Valor máximo é R$ 99.999,99",
);

export function requiredText(label: string, min: number, max: number) {
  return z.string({
    required_error: `${label} é obrigatório`,
    invalid_type_error: `${label} deve ser um texto`,
  }).trim().min(min, `${label} deve ter pelo menos ${min} caracteres`).max(
    max,
    `${label} deve ter no máximo ${max} caracteres`,
  );
}

export function validationMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos";
}
