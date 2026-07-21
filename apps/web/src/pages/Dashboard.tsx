import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorNotice, Spinner } from "../components";
import type { ChargeItem, DashboardData, PaymentStatus } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus } from "lucide-react";

const labels: Record<PaymentStatus, string> = {
  em_aberto: "Em aberto", atrasada: "Atrasada", cliente_confirmou: "Validar", paga: "Paga",
};
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [filter, setFilter] = useState<"todas" | PaymentStatus>("todas");
  const [error, setError] = useState("");

  useEffect(() => { api<DashboardData>("/api/charges").then(setData).catch((e) => setError(e.message)); }, []);
  const items = useMemo(() => data?.items.filter((item) => filter === "todas" || item.status === filter) ?? [], [data, filter]);
  if (error) return <ErrorNotice message={error} />;
  if (!data) return <Spinner />;

  return (
    <div className="page dashboard">
      <div className="title-row"><div><p className="eyebrow">Visão deste mês</p><h1>Quem me deve</h1></div></div>
      <section className="summary-grid">
        <Card className="summary-card receive"><span>A receber</span><strong>{brl(data.totals.aReceberCents)}</strong></Card>
        <Card className="summary-card paid"><span>Recebido</span><strong>{brl(data.totals.recebidoMesCents)}</strong></Card>
      </section>
      {(data.totals.atrasadasCount > 0 || data.totals.aguardandoValidacaoCount > 0) && (
        <div className="attention-strip">
          {data.totals.aguardandoValidacaoCount > 0 && <Button variant="secondary" onClick={() => setFilter("cliente_confirmou")}>{data.totals.aguardandoValidacaoCount} para validar</Button>}
          {data.totals.atrasadasCount > 0 && <Button variant="secondary" onClick={() => setFilter("atrasada")}>{data.totals.atrasadasCount} atrasada{data.totals.atrasadasCount > 1 ? "s" : ""}</Button>}
        </div>
      )}
      <div className="filter-row">
        {(["todas", "em_aberto", "cliente_confirmou", "atrasada", "paga"] as const).map((key) => <Button size="sm" variant={filter === key ? "default" : "outline"} key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{key === "todas" ? "Todas" : labels[key]}</Button>)}
      </div>
      <section className="charge-list">
        {items.length === 0 ? <Empty filter={filter} /> : items.map((item) => <ChargeCard key={item.paymentId} item={item} />)}
      </section>
      <Button asChild className="floating-add"><Link to="/nova"><Plus aria-hidden="true" />Adicionar cobrança</Link></Button>
    </div>
  );
}

function ChargeCard({ item }: { item: ChargeItem }) {
  return <Card asChild className="charge-card"><Link to={`/cobranca/${item.chargeId}`}>
    <div className={`status-dot ${item.status}`} />
    <div className="charge-main"><strong>{item.client.name}</strong><span>{item.description} · vence {date(item.dueDate)}</span></div>
    <div className="charge-value"><strong>{item.amountLabel}</strong><Badge variant="secondary" className={`badge ${item.status}`}>{labels[item.status]}</Badge></div>
  </Link></Card>;
}

function Empty({ filter }: { filter: "todas" | PaymentStatus }) {
  const description = filter === "todas"
    ? "Quando você adicionar uma cobrança, ela aparecerá nesta lista."
    : `Nenhuma cobrança corresponde ao filtro “${labels[filter]}”.`;

  return <div className="empty-state"><div className="empty-mark">✓</div><h2>Nada por aqui</h2><p>{description}</p></div>;
}
