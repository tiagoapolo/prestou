import { describe, expect, it } from "vitest";
import { monthlySchedulePreview } from "./formats";

describe("prévia da série mensal", () => {
  it("preserva o dia-âncora depois de um mês curto", () => {
    expect(monthlySchedulePreview("2027-01-31", "2027-04-30")).toEqual({
      occurrences: 4,
      firstDueDate: "2027-01-31",
      lastDueDate: "2027-04-30",
    });
  });

  it("rejeita intervalos com menos de 2 ou mais de 24 cobranças", () => {
    expect(monthlySchedulePreview("2027-01-31", "2027-01-31")).toBeNull();
    expect(monthlySchedulePreview("2027-01-31", "2030-12-31")).toBeNull();
  });
});
