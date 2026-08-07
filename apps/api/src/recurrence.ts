export const MIN_MONTHLY_OCCURRENCES = 2;
export const MAX_MONTHLY_OCCURRENCES = 24;

function isoDate(year: number, monthIndex: number, day: number): string {
  const date = new Date(Date.UTC(year, monthIndex, day));
  return date.toISOString().slice(0, 10);
}

export function monthlyDueDateForAnchor(
  firstDueDate: string,
  anchorDay: number,
  monthOffset: number,
): string {
  const [year, month] = firstDueDate.split("-").map(Number);
  const targetMonth = new Date(Date.UTC(year!, month! - 1 + monthOffset, 1));
  const lastDay = new Date(Date.UTC(
    targetMonth.getUTCFullYear(),
    targetMonth.getUTCMonth() + 1,
    0,
  )).getUTCDate();

  return isoDate(
    targetMonth.getUTCFullYear(),
    targetMonth.getUTCMonth(),
    Math.min(anchorDay!, lastDay),
  );
}

/** Calcula a competência mantendo como âncora o dia do primeiro vencimento. */
export function monthlyDueDate(firstDueDate: string, monthOffset: number): string {
  return monthlyDueDateForAnchor(
    firstDueDate,
    Number(firstDueDate.slice(8, 10)),
    monthOffset,
  );
}

/**
 * Materializa no máximo uma ocorrência além do limite. A ocorrência extra
 * permite rejeitar séries longas sem percorrer um intervalo arbitrário.
 */
export function monthlyDueDates(
  firstDueDate: string,
  endDate: string,
  anchorDay = Number(firstDueDate.slice(8, 10)),
): string[] {
  const dueDates: string[] = [];
  for (let offset = 0; offset <= MAX_MONTHLY_OCCURRENCES; offset++) {
    const dueDate = monthlyDueDateForAnchor(firstDueDate, anchorDay, offset);
    if (dueDate > endDate) break;
    dueDates.push(dueDate);
  }
  return dueDates;
}

export function monthlyOccurrenceCount(
  firstDueDate: string,
  endDate: string,
  anchorDay?: number,
): number {
  return monthlyDueDates(firstDueDate, endDate, anchorDay).length;
}

export function monthlySequence(firstDueDate: string, dueDate: string): number {
  const [firstYear, firstMonth] = firstDueDate.split("-").map(Number);
  const [year, month] = dueDate.split("-").map(Number);
  return (year! - firstYear!) * 12 + month! - firstMonth! + 1;
}

export function addDaysISO(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function firstMonthlyDueDateAfter(
  firstDueDate: string,
  anchorDay: number,
  afterDate: string,
  endDate: string,
): string | null {
  for (let offset = 0; offset < MAX_MONTHLY_OCCURRENCES; offset++) {
    const dueDate = monthlyDueDateForAnchor(firstDueDate, anchorDay, offset);
    if (dueDate > endDate) return null;
    if (dueDate > afterDate) return dueDate;
  }
  return null;
}
