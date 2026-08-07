export type PaymentStatus = "em_aberto" | "cliente_confirmou" | "paga" | "atrasada";
export type DefaultDueDays = 0 | 1 | 5 | 15 | 30;
export type PaymentMethod = "pix" | "dinheiro" | "cartao" | "transferencia" | "outro";

export interface Provider {
  id: string;
  name: string;
  profession: string;
  photoUrl: string | null;
  city: string | null;
  state: string | null;
  municipalityCode: string | null;
  pixKeyType: string;
  pixKeyMasked: string;
  whatsapp: string;
  defaultDueDays: DefaultDueDays;
  admin: boolean;
}

export interface ChargeItem {
  paymentId: string;
  chargeId: string;
  description: string;
  amountCents: number;
  amountLabel: string;
  dueDate: string;
  recurrence: { seriesId: string; sequence: number; occurrences: number } | null;
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

export type ChargeSeriesStatus = "ativa" | "pausada" | "cancelada" | "concluida";

export interface ChargeSeries {
  id: string;
  status: ChargeSeriesStatus;
  description: string;
  amountCents: number;
  amountLabel: string;
  firstDueDate: string;
  dueDay: number;
  endDate: string;
  nextDueDate: string | null;
  occurrences: number;
  generatedCount: number;
  client: { id: string; name: string; whatsapp: string };
  createdAt: string;
  updatedAt: string;
}

export interface ChargeSeriesCharge {
  paymentId: string;
  chargeId: string;
  description: string;
  sequence: number;
  amountCents: number;
  amountLabel: string;
  dueDate: string;
  status: PaymentStatus;
}

export interface ChargeSeriesDetail {
  series: ChargeSeries;
  charges: ChargeSeriesCharge[];
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

export interface FinancialEntry {
  source: "payment" | "manual_receipt";
  sourceId: string;
  chargeId: string | null;
  description: string;
  amountCents: number;
  receivedDate: string;
  paymentMethod: PaymentMethod;
  note: string | null;
  client: { id: string; name: string } | null;
}

export interface FinancialData {
  month: string;
  availableMonths: string[];
  items: FinancialEntry[];
  summary: {
    receivedCents: number;
    previousMonthReceivedCents: number;
    pendingCents: number;
    overdueCents: number;
  };
}
