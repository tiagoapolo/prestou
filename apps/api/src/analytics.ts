import { db, databaseMode, queryAll, queryOne } from "./db.js";
import { newId } from "./ids.js";

/** Eventos do funil (seção 9 do plano). Sem isso o piloto não gera aprendizado. */
export type EventType =
  | "cobranca_criada"
  | "mensagem_enviada"
  | "link_aberto"
  | "codigo_copiado"
  | "cliente_confirmou"
  | "prestador_confirmou"
  | "marcado_pago_manual"
  | "contestacao_aberta"
  | "lembrete_disparado"
  | "lembrete_enviado";

export interface TrackInput {
  type: EventType;
  providerId?: string | null;
  chargeId?: string | null;
  paymentId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function track(input: TrackInput): Promise<void> {
  await db.execute(`
    INSERT INTO events (id, type, provider_id, charge_id, payment_id, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    newId(),
    input.type,
    input.providerId ?? null,
    input.chargeId ?? null,
    input.paymentId ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    new Date().toISOString(),
  );
}

export interface FunnelRow {
  type: string;
  total: number;
}

/**
 * Funil agregado. A métrica que decide o PSP na V2 é o vazamento:
 * quantos clientes copiaram o código mas não tocaram em "já paguei".
 */
export async function funnel(providerId?: string): Promise<{
  events: FunnelRow[];
  leakage: {
    codigoCopiado: number;
    clienteConfirmou: number;
    /** % de quem copiou e não confirmou. Alto ⇒ argumento para adotar PSP. */
    vazamentoPct: number | null;
  };
  tempoMedioAtePagamentoHoras: number | null;
}> {
  const where = providerId ? "WHERE provider_id = ?" : "";
  const params = providerId ? [providerId] : [];

  const events = await queryAll<FunnelRow>(
    `SELECT type, COUNT(*) AS total FROM events ${where} GROUP BY type ORDER BY type`,
    ...params,
  );

  const normalizedEvents = events.map((event) => ({
    ...event,
    total: Number(event.total),
  }));
  const byType = new Map(normalizedEvents.map((e) => [e.type, e.total]));
  const copied = byType.get("codigo_copiado") ?? 0;
  const confirmed = byType.get("cliente_confirmou") ?? 0;

  const durationExpression =
    databaseMode === "postgres"
      ? "EXTRACT(EPOCH FROM (p.paid_at - p.created_at)) / 3600.0"
      : "(julianday(p.paid_at) - julianday(p.created_at)) * 24.0";
  const avgRow = await queryOne<{ horas: number | null }>(
    `SELECT AVG(${durationExpression}) AS horas
       FROM payments p
       JOIN charges c ON c.id = p.charge_id
      WHERE p.paid_at IS NOT NULL
        ${providerId ? "AND c.provider_id = ?" : ""}`,
    ...params,
  );

  return {
    events: normalizedEvents,
    leakage: {
      codigoCopiado: copied,
      clienteConfirmou: confirmed,
      vazamentoPct:
        copied > 0 ? Math.round(((copied - confirmed) / copied) * 1000) / 10 : null,
    },
    tempoMedioAtePagamentoHoras:
      avgRow?.horas === null || avgRow?.horas === undefined
        ? null
        : Number(avgRow.horas),
  };
}
