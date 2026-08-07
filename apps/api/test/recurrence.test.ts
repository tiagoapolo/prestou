import assert from "node:assert/strict";
import test from "node:test";

const {
  MAX_MONTHLY_OCCURRENCES,
  firstMonthlyDueDateAfter,
  monthlyDueDate,
  monthlyDueDates,
  monthlyOccurrenceCount,
} = await import("../src/recurrence.ts");

test("recorrência mensal preserva a âncora depois de meses curtos", () => {
  assert.equal(monthlyDueDate("2027-01-31", 0), "2027-01-31");
  assert.equal(monthlyDueDate("2027-01-31", 1), "2027-02-28");
  assert.equal(monthlyDueDate("2027-01-31", 2), "2027-03-31");
  assert.equal(monthlyDueDate("2027-01-31", 3), "2027-04-30");
});

test("recorrência mensal considera fevereiro bissexto", () => {
  assert.equal(monthlyDueDate("2028-01-31", 1), "2028-02-29");
});

test("data final é inclusiva e não cria vencimento posterior", () => {
  assert.deepEqual(monthlyDueDates("2027-01-31", "2027-03-30"), [
    "2027-01-31",
    "2027-02-28",
  ]);
  assert.deepEqual(monthlyDueDates("2027-01-31", "2027-03-31"), [
    "2027-01-31",
    "2027-02-28",
    "2027-03-31",
  ]);
});

test("contagem sinaliza séries acima do limite sem materializar meses sem fim", () => {
  assert.equal(monthlyOccurrenceCount("2027-01-10", "2027-02-10"), 2);
  assert.equal(
    monthlyOccurrenceCount("2027-01-10", "2030-12-10"),
    MAX_MONTHLY_OCCURRENCES + 1,
  );
});

test("retomada escolhe a primeira competência futura e não recupera meses vencidos", () => {
  assert.equal(
    firstMonthlyDueDateAfter("2027-01-31", 31, "2027-03-01", "2027-04-30"),
    "2027-03-31",
  );
  assert.equal(
    firstMonthlyDueDateAfter("2027-01-31", 5, "2027-03-10", "2027-04-30"),
    "2027-04-05",
  );
  assert.equal(
    firstMonthlyDueDateAfter("2027-01-31", 31, "2027-04-30", "2027-04-30"),
    null,
  );
});
