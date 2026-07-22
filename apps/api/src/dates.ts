/**
 * Data do calendário no fuso do prestador (America/Sao_Paulo), no formato
 * AAAA-MM-DD. "Atrasada", vencimentos e o resumo do mês dependem de "hoje"; usar
 * UTC adiantava a virada do dia em até 3h e marcava como atrasada uma cobrança
 * que ainda vence hoje no Brasil.
 *
 * Módulo puro de propósito: o cérebro do assistente depende dele sem arrastar
 * config/banco, para poder ser testado isoladamente.
 */
export function saoPauloDateISO(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
