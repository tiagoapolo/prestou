import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountCentsSchema,
  isoDateSchema,
  mobileSchema,
  requiredText,
} from "../src/validation.ts";

test("celular aceita máscara ou +55 e normaliza para 11 dígitos", () => {
  assert.equal(mobileSchema.parse("(11) 98765-4321"), "11987654321");
  assert.equal(mobileSchema.parse("+55 11 98765-4321"), "11987654321");
});

test("celular rejeita fixo, número incompleto e DDD inválido", () => {
  assert.equal(mobileSchema.safeParse("11 3456-7890").success, false);
  assert.equal(mobileSchema.safeParse("11 98765-432").success, false);
  assert.equal(mobileSchema.safeParse("00 98765-4321").success, false);
});

test("data rejeita dias inexistentes mesmo quando o formato ISO está correto", () => {
  assert.equal(isoDateSchema.safeParse("2026-02-28").success, true);
  assert.equal(isoDateSchema.safeParse("2026-02-30").success, false);
  assert.equal(isoDateSchema.safeParse("30/02/2026").success, false);
});

test("valor exige centavos inteiros positivos dentro do limite", () => {
  assert.equal(amountCentsSchema.safeParse(1).success, true);
  assert.equal(amountCentsSchema.safeParse(0).success, false);
  assert.equal(amountCentsSchema.safeParse(10.5).success, false);
  assert.equal(amountCentsSchema.safeParse(10_000_000).success, false);
});

test("campo obrigatório rejeita texto vazio ou composto apenas por espaços", () => {
  const schema = requiredText("Nome", 2, 80);
  assert.equal(schema.safeParse("  ").success, false);
  assert.equal(schema.parse("  Maria  "), "Maria");
});
