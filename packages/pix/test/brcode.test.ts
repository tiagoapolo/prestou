import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generatePixBrCode,
  crc16ccitt,
  parsePixKey,
  sanitizeText,
} from "../dist/index.js";

// --- CRC16 (vetor conhecido do padrão Pix) ---
test("crc16ccitt bate com vetor conhecido do BR Code", () => {
  // Payload de referência amplamente usado em documentação Pix.
  const payload =
    "00020126330014br.gov.bcb.pix0111123456789015204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
  assert.equal(crc16ccitt(payload), "9F79");
});

// --- Estrutura do BR Code ---
test("gera BR Code começando com payload format e terminando com CRC", () => {
  const { brCode } = generatePixBrCode({
    key: "11999998888",
    amount: 150.07,
    merchantName: "Joao Jardineiro",
    merchantCity: "Sao Paulo",
  });
  assert.ok(brCode.startsWith("000201"));
  assert.match(brCode.slice(-8), /^6304[0-9A-F]{4}$/);
});

test("CRC do fim confere com recálculo sobre o corpo", () => {
  const { brCode } = generatePixBrCode({
    key: "tiago@prestou.com",
    amount: 99.9,
    merchantName: "Prestou",
  });
  const body = brCode.slice(0, -4);
  const crc = brCode.slice(-4);
  assert.equal(crc16ccitt(body), crc);
});

test("valor é formatado com 2 casas e ponto", () => {
  const { brCode } = generatePixBrCode({
    key: "11999998888",
    amount: 150.07,
    merchantName: "Teste",
  });
  assert.ok(brCode.includes("5406150.07"));
});

test("valor alto R$ 9.999,99 é formatado sem separador de milhar", () => {
  const { brCode } = generatePixBrCode({
    key: "11999998888",
    amount: 9999.99,
    merchantName: "Teste",
  });
  assert.ok(brCode.includes("54079999.99"));
});

test("evita erro de ponto flutuante no valor", () => {
  const { brCode } = generatePixBrCode({
    key: "11999998888",
    amount: 0.1 + 0.2, // 0.30000000000000004
    merchantName: "Teste",
  });
  assert.ok(brCode.includes("54040.30"));
});

// --- Tipos de chave (matriz de QA) ---
test("aceita os 4 tipos de chave", () => {
  const cases: Array<[string, string]> = [
    ["529.982.247-25", "cpf"], // CPF válido de teste
    ["11999998888", "phone"],
    ["tiago@prestou.com", "email"],
    ["123e4567-e89b-12d3-a456-426614174000", "evp"],
  ];
  for (const [key, expected] of cases) {
    const { keyInfo } = generatePixBrCode({
      key,
      amount: 10,
      merchantName: "Teste",
    });
    assert.equal(keyInfo.type, expected, `chave ${key}`);
  }
});

test("normaliza telefone nacional para E.164", () => {
  assert.equal(parsePixKey("11999998888").normalized, "+5511999998888");
  assert.equal(parsePixKey("(11) 99999-8888").normalized, "+5511999998888");
});

test("rejeita CPF inválido", () => {
  assert.throws(() => parsePixKey("111.111.111-11"));
});

test("rejeita chave vazia e formato desconhecido", () => {
  assert.throws(() => parsePixKey(""));
  assert.throws(() => parsePixKey("abc"));
});

// --- Nome com acento (matriz de QA) ---
test("remove acentos do nome do recebedor", () => {
  const clean = sanitizeText("José Antônio da Conceição", 25);
  assert.equal(clean, "JOSE ANTONIO DA CONCEICAO");
});

test("nome com acento gera BR Code sem quebrar comprimento TLV", () => {
  const { brCode } = generatePixBrCode({
    key: "11999998888",
    amount: 50,
    merchantName: "José Antônio",
    merchantCity: "São Paulo",
  });
  // "JOSE ANTONIO" tem 12 chars → campo 59 = 5912JOSE ANTONIO
  assert.ok(brCode.includes("5912JOSE ANTONIO"));
  // "SAO PAULO" tem 9 chars → campo 60 = 6009SAO PAULO
  assert.ok(brCode.includes("6009SAO PAULO"));
});

// --- Guardas de valor ---
test("rejeita valor zero ou negativo", () => {
  assert.throws(() =>
    generatePixBrCode({ key: "11999998888", amount: 0, merchantName: "T" }),
  );
  assert.throws(() =>
    generatePixBrCode({ key: "11999998888", amount: -5, merchantName: "T" }),
  );
});
