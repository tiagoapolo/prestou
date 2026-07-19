import { config } from "./config.js";

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Link público da página de pagamento do cliente. */
export function paymentUrl(publicToken: string): string {
  return `${config.publicWebUrl}/pay/${publicToken}`;
}

/**
 * Monta um deep link wa.me com a mensagem pré-preenchida.
 * `whatsapp` deve estar em formato aceitável; normalizamos para dígitos.
 */
export function waMeLink(whatsapp: string, text: string): string {
  const digits = whatsapp.replace(/\D/g, "");
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`;
}

interface MsgCtx {
  clientName: string;
  providerName: string;
  description: string;
  amountCents: number;
  publicToken: string;
}

/** Mensagem de cobrança (prestador → cliente). Tom: cordial. */
export function chargeMessage(ctx: MsgCtx): string {
  return (
    `Oi, ${ctx.clientName}! Aqui é o ${ctx.providerName}. ` +
    `O serviço de ${ctx.description} ficou em ${formatBRL(ctx.amountCents)}. ` +
    `Segue o link pra pagar por Pix, rapidinho: ${paymentUrl(ctx.publicToken)}`
  );
}

/** Mensagem de lembrete (vencimento/atraso). Tom: leve. */
export function reminderMessage(ctx: MsgCtx): string {
  return (
    `Oi, ${ctx.clientName}! Passando pra lembrar do Pix de ` +
    `${formatBRL(ctx.amountCents)} do ${ctx.description}. ` +
    `O link é esse: ${paymentUrl(ctx.publicToken)}. Qualquer coisa me chama!`
  );
}

/** Mensagem de contestação. Tom: dúvida, NUNCA acusação (regra do plano). */
export function contestMessage(ctx: MsgCtx): string {
  return (
    `Oi, ${ctx.clientName}! Não identifiquei o pagamento aqui ainda — ` +
    `pode conferir pra mim? O link é esse: ${paymentUrl(ctx.publicToken)}. Obrigado!`
  );
}
