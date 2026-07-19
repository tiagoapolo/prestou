import { queryOne, withTransaction } from "./db.js";
import { newId } from "./ids.js";
import type { DerivedStatus, PaymentRow, PaymentStatus } from "./types.js";

export class TransitionError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

type Actor = "client" | "provider" | "system";

interface TransitionInput {
  payment: PaymentRow;
  to: PaymentStatus;
  actor: Actor;
  action: string;
  /** Campos extras a gravar junto na mesma transação. */
  patch?: Partial<
    Pick<PaymentRow, "client_confirmed_at" | "comprovante_path" | "paid_at" | "paid_via">
  >;
}

/** Transições permitidas pela máquina de estados (seção 6 do plano). */
const ALLOWED: Record<PaymentStatus, PaymentStatus[]> = {
  em_aberto: ["cliente_confirmou", "paga"],
  cliente_confirmou: ["paga", "em_aberto"],
  paga: [], // estado terminal
};

/**
 * Aplica uma transição de estado de forma atômica, validando a origem e
 * gravando a auditoria. Lança TransitionError (409) se a transição for
 * inválida a partir do estado atual — a proteção nº 1 contra o pior bug do
 * produto (cobrança paga sem dinheiro, ou o contrário).
 */
export async function transition(input: TransitionInput): Promise<PaymentRow> {
  const { payment, to, actor, action, patch } = input;
  const from = payment.status;

  if (!ALLOWED[from].includes(to)) {
    throw new TransitionError(
      `Transição inválida: ${from} → ${to} (parcela ${payment.id})`,
    );
  }

  const now = new Date().toISOString();
  // Reabertura por contestação limpa a confirmação do cliente.
  const reopening = to === "em_aberto";
  const next = {
    client_confirmed_at: reopening
      ? null
      : patch?.client_confirmed_at ?? payment.client_confirmed_at,
    comprovante_path: reopening
      ? null
      : patch?.comprovante_path ?? payment.comprovante_path,
    paid_at: patch?.paid_at ?? (to === "paga" ? now : payment.paid_at),
    paid_via: patch?.paid_via ?? payment.paid_via,
  };

  return withTransaction(async (tx) => {
    const res = await tx.execute(`
    UPDATE payments
       SET status = ?,
           client_confirmed_at = ?,
           comprovante_path = ?,
           paid_at = ?,
           paid_via = ?
     WHERE id = ? AND status = ?
  `,
      to,
      next.client_confirmed_at,
      next.comprovante_path,
      next.paid_at,
      next.paid_via,
      payment.id,
      from,
    );

  if (res.changes !== 1) {
    // Corrida: o estado mudou entre a leitura e o update.
    throw new TransitionError(
      `Estado da parcela ${payment.id} mudou concorrentemente; tente de novo`,
    );
  }

  await tx.execute(`
    INSERT INTO payment_transitions (id, payment_id, from_status, to_status, actor, action, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, newId(), payment.id, from, to, actor, action, now);

    return (await tx.queryOne<PaymentRow>(
      "SELECT * FROM payments WHERE id = ?",
      payment.id,
    ))!;
  });
}

export async function getPayment(id: string): Promise<PaymentRow | undefined> {
  return queryOne<PaymentRow>("SELECT * FROM payments WHERE id = ?", id);
}

export async function getPaymentByToken(token: string): Promise<PaymentRow | undefined> {
  return queryOne<PaymentRow>(
    "SELECT * FROM payments WHERE public_token = ?",
    token,
  );
}

/** Deriva "atrasada" a partir de em_aberto + vencimento passado (nunca persistido). */
export function derivedStatus(payment: PaymentRow, today = todayISO()): DerivedStatus {
  if (payment.status === "em_aberto" && payment.due_date < today) {
    return "atrasada";
  }
  return payment.status;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
