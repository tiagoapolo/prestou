export type PaymentStatus = "em_aberto" | "cliente_confirmou" | "paga" | "atrasada";

export interface Provider {
  id: string;
  name: string;
  profession: string;
  photoUrl: string | null;
  city: string | null;
  pixKeyType: string;
  pixKeyMasked: string;
  whatsapp: string;
}

export interface ChargeItem {
  paymentId: string;
  chargeId: string;
  description: string;
  amountCents: number;
  amountLabel: string;
  dueDate: string;
  status: PaymentStatus;
  client: { name: string; whatsapp: string };
  paymentUrl: string;
  hasComprovante: boolean;
  clientConfirmedAt: string | null;
  paidAt: string | null;
  paidVia: string | null;
  whatsappDeeplink: string;
}

export interface DashboardData {
  items: ChargeItem[];
  totals: {
    aReceberCents: number;
    recebidoMesCents: number;
    atrasadasCount: number;
    aguardandoValidacaoCount: number;
  };
}

export interface PublicPayment {
  provider: { name: string; profession: string; photoUrl: string | null };
  description: string;
  amountCents: number;
  amountLabel: string;
  dueDate: string;
  status: string;
  brCode: string;
  alreadyConfirmed: boolean;
}
