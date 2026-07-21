import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RECEIPT_RETENTION_DAYS,
  receiptRetentionCutoff,
} from "../src/retention-policy.ts";

test("comprovantes pagos são elegíveis para expurgo após 90 dias", () => {
  assert.equal(RECEIPT_RETENTION_DAYS, 90);
  assert.equal(
    receiptRetentionCutoff(new Date("2026-07-21T15:00:00.000Z")),
    "2026-04-22T15:00:00.000Z",
  );
});
