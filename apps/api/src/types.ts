export type PaymentStatus = "em_aberto" | "cliente_confirmou" | "paga";

/** Estado derivado (nunca persistido): em_aberto + vencimento passado. */
export type DerivedStatus = PaymentStatus | "atrasada";

export type DefaultDueDays = 0 | 1 | 5 | 15 | 30;
export type PaymentMethod = "pix" | "dinheiro" | "cartao" | "transferencia" | "outro";

export interface ProviderRow {
  id: string;
  auth_user_id: string | null;
  email: string | null;
  name: string;
  profession: string;
  photo_url: string | null;
  city: string | null;
  state: string | null;
  municipality_code: string | null;
  pix_key: string;
  pix_key_type: string;
  whatsapp: string;
  default_due_days: DefaultDueDays;
  consent_at: string;
  created_at: string;
}

export interface ClientRow {
  id: string;
  provider_id: string;
  name: string;
  whatsapp: string;
  created_at: string;
}

export interface ChargeRow {
  id: string;
  provider_id: string;
  client_id: string;
  description: string;
  amount_cents: number;
  due_date: string;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  charge_id: string;
  seq: number;
  amount_cents: number;
  due_date: string;
  status: PaymentStatus;
  public_token: string;
  brcode: string;
  client_confirmed_at: string | null;
  comprovante_path: string | null;
  paid_at: string | null;
  paid_via: string | null;
  received_amount_cents: number | null;
  payment_method: PaymentMethod | null;
  financial_note: string | null;
  financial_voided_at: string | null;
  created_at: string;
}
