/** Formatação de moeda (puro, sem config): usado pelo cérebro e pelas rotas. */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
