import { test } from "node:test";
import assert from "node:assert/strict";
import { INTERNAL_ERROR_MESSAGE, publicErrorMessage } from "../src/public-errors.ts";

test("erros internos usam mensagem genérica", () => {
  assert.equal(publicErrorMessage(500), INTERNAL_ERROR_MESSAGE);
  assert.equal(publicErrorMessage(503), INTERNAL_ERROR_MESSAGE);
  assert.doesNotMatch(publicErrorMessage(500), /sql|token|stack|database/i);
});

test("erros esperados orientam o usuário", () => {
  assert.match(publicErrorMessage(401), /sessão expirou/i);
  assert.match(publicErrorMessage(413), /10 MB/i);
  assert.match(publicErrorMessage(429), /aguarde/i);
});
