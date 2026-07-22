const MOBILE_MAX_DIGITS = 11;
const MONEY_MAX_DIGITS = 7;

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function normalizeMobile(value: string): string {
  const digits = onlyDigits(value);
  return digits.length === 13 && digits.startsWith("55") ? digits.slice(2) : digits;
}

export function isValidMobile(value: string): boolean {
  return /^[1-9]\d9\d{8}$/.test(normalizeMobile(value));
}

export function formatMobile(value: string): string {
  const digits = normalizeMobile(value).slice(0, MOBILE_MAX_DIGITS);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function formatMoney(value: string): string {
  const digits = onlyDigits(value).replace(/^0+/, "").slice(0, MONEY_MAX_DIGITS);
  if (!digits) return "";
  const cents = Number(digits);
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function moneyToCents(value: string): number | null {
  const digits = onlyDigits(value);
  if (!digits) return null;
  const cents = Number(digits);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 9_999_999
    ? cents
    : null;
}

export function formatDate(value: string): string {
  const digits = onlyDigits(value).slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function dateToISO(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) return null;
  return `${year}-${month}-${day}`;
}

export function isoToDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function dateAfterDaysISO(days: number, from = new Date()): string {
  const date = new Date(from);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
