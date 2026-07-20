import { test } from "node:test";
import assert from "node:assert/strict";
import {
  municipalityExists,
  parseIbgeMunicipalities,
  searchMunicipalities,
} from "../src/municipalities.ts";

const municipalities = [
  { name: "São Paulo", state: "SP", ibgeCode: "3550308" },
  { name: "São Paulo das Missões", state: "RS", ibgeCode: "4319307" },
  { name: "João Pessoa", state: "PB", ibgeCode: "2507507" },
];

test("converte a resposta nivelada do IBGE", () => {
  assert.deepEqual(parseIbgeMunicipalities([{
    "municipio-id": 3550308,
    "municipio-nome": "São Paulo",
    "UF-sigla": "SP",
  }], 1), [municipalities[0]]);
});

test("busca município sem diferenciar acentos e prioriza início do nome", () => {
  assert.deepEqual(searchMunicipalities("sao paulo", municipalities), municipalities.slice(0, 2));
  assert.deepEqual(searchMunicipalities("pessoa", municipalities), [municipalities[2]]);
});

test("valida conjuntamente nome, UF e código IBGE", () => {
  assert.equal(municipalityExists(municipalities[0], municipalities), true);
  assert.equal(municipalityExists({ ...municipalities[0], state: "RJ" }, municipalities), false);
});
