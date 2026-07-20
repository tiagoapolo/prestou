export type PaymentStatus = "em_aberto" | "cliente_confirmou" | "paga";

/** Estado derivado (nunca persistido): em_aberto + vencimento passado. */
export type DerivedStatus = PaymentStatus | "atrasada";

export interface ProviderRow {
  id: string;
  auth_user_id: string | null;
  email: string | null;
  name: string;
  profession: string;
  photo_url: string | null;
  city: string | null;
  pix_key: string;
  pix_key_type: string;
  whatsapp: string;
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
  created_at: string;
}
