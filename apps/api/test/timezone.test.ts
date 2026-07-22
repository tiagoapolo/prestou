import { test } from "node:test";
import assert from "node:assert/strict";
import { saoPauloDateISO } from "../src/dates.ts";

test("saoPauloDateISO usa o dia do Brasil, não o UTC", () => {
  // 02:00Z ainda é o dia anterior (23:00) em America/Sao_Paulo (UTC-3): a
  // cobrança que vence 10/03 ainda vence hoje no Brasil, não atrasou.
  assert.equal(saoPauloDateISO(new Date("2026-03-11T02:00:00Z")), "2026-03-10");
  // No meio do dia os dois coincidem.
  assert.equal(saoPauloDateISO(new Date("2026-03-11T12:00:00Z")), "2026-03-11");
  // Virada do ano no Brasil enquanto o UTC já está em janeiro.
  assert.equal(saoPauloDateISO(new Date("2026-01-01T02:00:00Z")), "2025-12-31");
});
