import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { ErrorNotice, Spinner } from "../components";
import type { ChargeItem, DashboardData, PaymentStatus } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus, Sparkles } from "lucide-react";
import { userMessage } from "../errors";

const labels: Record<PaymentStatus, string> = {
  em_aberto: "Em aberto", atrasada: "Atrasada", cliente_confirmou: "Validar", paga: "Paga",
};
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

export function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [filter, setFilter] = useState<"todas" | PaymentStatus>("todas");
  const [error, setError] = useState("");

  useEffect(() => { api<DashboardData>("/api/charges").then(setData).catch((cause) => setError(userMessage(cause, "Não foi possível carregar as cobranças. Tente novamente."))); }, []);
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
      <AssistantCommand onDraft={(draft, startedAt) => navigate("/nova", {
        state: { assistantDraft: { ...draft, startedAt } },
      })} />
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

interface AssistantDraft {
  client: { id?: string; name: string; whatsapp: string };
  description: string;
  amountCents: number;
  dueDate: string;
}

type AssistantResponse =
  | { kind: "draft"; message: string; draft: AssistantDraft }
  | { kind: "clarification"; message: string };

function AssistantCommand({
  onDraft,
}: {
  onDraft: (draft: AssistantDraft, startedAt: number) => void;
}) {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (text.length < 3) return;
    const journeyStartedAt = startedAt ?? Date.now();
    if (startedAt === null) setStartedAt(journeyStartedAt);
    setBusy(true); setError(""); setReply("");
    try {
      const result = await api<AssistantResponse>("/api/assistant/interpret", {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });
      if (result.kind === "draft") onDraft(result.draft, journeyStartedAt);
      else setReply(result.message);
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível interpretar o pedido. Tente novamente."));
    } finally {
      setBusy(false);
    }
  }

  return <Card asChild className="assistant-card"><form onSubmit={submit}>
    <div className="assistant-heading"><Sparkles aria-hidden="true" /><div><strong>Criar falando do seu jeito</strong><small>Assistente experimental</small></div></div>
    <div className="assistant-input-row"><input aria-label="Pedido de cobrança" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} placeholder="Ex.: cobra R$ 80 do João pela lavagem, vence amanhã" /><Button loading={busy} loadingLabel="Lendo…" disabled={message.trim().length < 3}>Preparar</Button></div>
    {reply && <p className="assistant-reply">{reply}</p>}
    {error && <ErrorNotice message={error} />}
  </form></Card>;
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
