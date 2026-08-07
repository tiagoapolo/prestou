import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { ErrorNotice, Spinner } from "../components";
import { userMessage } from "../errors";
import { dateToISO, formatDate, formatMoney, isoToDate, moneyToCents } from "../formats";
import type { ChargeSeries, ChargeSeriesDetail, ChargeSeriesStatus, PaymentStatus } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const statusLabels: Record<ChargeSeriesStatus, string> = {
  ativa: "Ativa",
  pausada: "Pausada",
  cancelada: "Cancelada",
  concluida: "Concluída",
};

const paymentStatusLabels: Record<PaymentStatus, string> = {
  em_aberto: "Em aberto",
  cliente_confirmou: "Aguardando validação",
  paga: "Paga",
  atrasada: "Atrasada",
};

interface SeriesDraft {
  description: string;
  amount: string;
  dueDay: string;
  endDate: string;
}

function draftFromSeries(series: ChargeSeries): SeriesDraft {
  return {
    description: series.description,
    amount: formatMoney(String(series.amountCents)),
    dueDay: String(series.dueDay),
    endDate: isoToDate(series.endDate),
  };
}

export function ChargeSeriesPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<ChargeSeriesDetail | null>(null);
  const [draft, setDraft] = useState<SeriesDraft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyAction, setBusyAction] = useState<"save" | "pause" | "resume" | "cancel" | null>(null);

  useEffect(() => {
    setError("");
    api<ChargeSeriesDetail>(`/api/charge-series/${id}`)
      .then((result) => {
        setDetail(result);
        setDraft(draftFromSeries(result.series));
      })
      .catch((cause) => setError(userMessage(cause, "Não foi possível carregar a série mensal.")));
  }, [id]);

  function applySeries(series: ChargeSeries) {
    setDetail((current) => current ? { ...current, series } : current);
    setDraft(draftFromSeries(series));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const amountCents = moneyToCents(draft.amount);
    const dueDay = Number(draft.dueDay);
    const endDate = dateToISO(draft.endDate);
    if (draft.description.trim().length < 2 || !amountCents || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31 || !endDate) {
      setError("Revise serviço, valor, dia do vencimento e data final.");
      return;
    }

    setBusyAction("save"); setError(""); setNotice("");
    try {
      const result = await api<{ series: ChargeSeries }>(`/api/charge-series/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: draft.description.trim(),
          amountCents,
          dueDay,
          endDate,
        }),
      });
      applySeries(result.series);
      setNotice("Alterações salvas para as próximas cobranças.");
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível salvar as alterações."));
    } finally {
      setBusyAction(null);
    }
  }

  async function changeStatus(action: "pause" | "resume" | "cancel") {
    const messages = {
      pause: "Pausar esta série? As cobranças existentes não mudam. Os meses vencidos durante a pausa não serão criados retroativamente.",
      resume: "Retomar esta série? A próxima cobrança será a primeira mensalidade futura dentro da data final.",
      cancel: "Cancelar esta série definitivamente? As cobranças existentes continuam válidas, mas nenhuma nova mensalidade será criada.",
    };
    if (!window.confirm(messages[action])) return;

    setBusyAction(action); setError(""); setNotice("");
    try {
      const result = await api<{ series: ChargeSeries }>(`/api/charge-series/${id}/${action}`, {
        method: "POST",
      });
      applySeries(result.series);
      setNotice(action === "pause" ? "Série pausada." : action === "resume" ? "Série retomada." : "Série cancelada.");
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível alterar o estado da série."));
    } finally {
      setBusyAction(null);
    }
  }

  if (!detail && error) return <div className="page"><Link className="financial-back" to="/">← Voltar ao painel</Link><ErrorNotice message={error} /></div>;
  if (!detail || !draft) return <Spinner label="Abrindo série mensal…" />;

  const { series, charges } = detail;
  const canEdit = series.status !== "cancelada";
  return <div className="page series-page">
    <div className="back-title"><Link to="/">←</Link><div><p className="eyebrow">Série mensal</p><h1>{series.client.name}</h1></div></div>
    <Card className="series-summary-card">
      <div className="series-summary-heading"><div><strong>{series.description}</strong><span>{series.amountLabel} por mês</span></div><Badge variant="secondary" className={`badge series-${series.status}`}>{statusLabels[series.status]}</Badge></div>
      <dl>
        <div><dt>Primeiro vencimento</dt><dd>{isoToDate(series.firstDueDate)}</dd></div>
        <div><dt>Próximo vencimento</dt><dd>{series.nextDueDate ? isoToDate(series.nextDueDate) : "Sem próximo vencimento"}</dd></div>
        <div><dt>Data final</dt><dd>{isoToDate(series.endDate)}</dd></div>
        <div><dt>Progresso</dt><dd>{series.generatedCount} de {series.occurrences} cobranças geradas</dd></div>
      </dl>
    </Card>

    {error && <ErrorNotice message={error} />}
    {notice && <div className="notice success" role="status">{notice}</div>}

    {canEdit && <Card asChild className="form-card series-edit-card"><form className="stack" onSubmit={save}>
      <div><p className="eyebrow">Somente o futuro</p><h2>Próximas cobranças</h2><p className="settings-help">As cobranças já criadas não serão alteradas.</p></div>
      <Label>Serviço das próximas cobranças<Input required minLength={2} maxLength={120} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Label>
      <div className="two-fields">
        <Label>Valor mensal (R$)<Input required inputMode="numeric" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: formatMoney(event.target.value) })} /></Label>
        <Label>Dia dos próximos vencimentos<Input required type="number" inputMode="numeric" min={1} max={31} value={draft.dueDay} onChange={(event) => setDraft({ ...draft, dueDay: event.target.value })} /></Label>
      </div>
      <Label>Data final da série<Input required inputMode="numeric" maxLength={10} pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: formatDate(event.target.value) })} /></Label>
      <Button loading={busyAction === "save"} disabled={busyAction !== null} loadingLabel="Salvando…">Salvar alterações</Button>
    </form></Card>}

    {(series.status === "ativa" || series.status === "pausada") && <Card className="series-actions-card">
      <div><h2>Geração mensal</h2><p>{series.status === "ativa" ? "Pause temporariamente ou cancele as próximas cobranças." : "Retome a partir do próximo vencimento futuro ou cancele definitivamente."}</p></div>
      <div className="series-action-buttons">
        {series.status === "ativa" && <Button variant="secondary" disabled={busyAction !== null} loading={busyAction === "pause"} loadingLabel="Pausando…" onClick={() => changeStatus("pause")}>Pausar série</Button>}
        {series.status === "pausada" && <Button disabled={busyAction !== null} loading={busyAction === "resume"} loadingLabel="Retomando…" onClick={() => changeStatus("resume")}>Retomar série</Button>}
        <Button variant="destructive" disabled={busyAction !== null} loading={busyAction === "cancel"} loadingLabel="Cancelando…" onClick={() => changeStatus("cancel")}>Cancelar série</Button>
      </div>
    </Card>}

    <section className="series-charges">
      <div className="section-title"><h2>Cobranças geradas</h2><span>{charges.length}</span></div>
      {charges.map((charge) => <Card asChild key={charge.paymentId} className="series-charge-card"><Link to={`/cobranca/${charge.paymentId}`}>
        <div><strong>{charge.description}</strong><span>Mensalidade {charge.sequence} de {series.occurrences} · vence {isoToDate(charge.dueDate)}</span></div>
        <div><strong>{charge.amountLabel}</strong><Badge variant="secondary" className={`badge ${charge.status}`}>{paymentStatusLabels[charge.status]}</Badge></div>
      </Link></Card>)}
    </section>
  </div>;
}
