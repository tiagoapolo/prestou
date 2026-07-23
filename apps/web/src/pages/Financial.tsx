import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Download, Pencil, Plus, TriangleAlert } from "lucide-react";
import { api, authenticatedBlob } from "../api";
import { ErrorNotice, Spinner } from "../components";
import { userMessage } from "../errors";
import { formatMoney, moneyToCents } from "../formats";
import type {
  FinancialData,
  FinancialEntry,
  PaymentMethod,
} from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ClientOption {
  id: string;
  name: string;
}

interface EntryDraft {
  clientId: string;
  description: string;
  amount: string;
  receivedDate: string;
  paymentMethod: PaymentMethod;
  note: string;
}

const methodLabels: Record<PaymentMethod, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao: "Cartão",
  transferencia: "Transferência",
  outro: "Outro",
};

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function saoPauloToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, monthNumber! - 1, 1)).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function emptyDraft(): EntryDraft {
  return {
    clientId: "",
    description: "",
    amount: "",
    receivedDate: saoPauloToday(),
    paymentMethod: "pix",
    note: "",
  };
}

export function FinancialPage() {
  const [month, setMonth] = useState(saoPauloToday().slice(0, 7));
  const [data, setData] = useState<FinancialData | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selected, setSelected] = useState<FinancialEntry | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  async function load(selectedMonth = month) {
    setError("");
    try {
      setData(await api<FinancialData>(`/api/financial?month=${selectedMonth}`));
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível carregar o financeiro."));
    }
  }

  useEffect(() => { void load(month); }, [month]);
  useEffect(() => {
    api<{ clients: ClientOption[] }>("/api/clients")
      .then((result) => setClients(result.clients))
      .catch(() => setClients([]));
  }, []);

  function openNewReceipt() {
    const today = saoPauloToday();
    setSelected(null);
    setConfirmingRemoval(false);
    setDraft({
      ...emptyDraft(),
      receivedDate: month === today.slice(0, 7) ? today : `${month}-01`,
    });
    setFormError("");
    dialog.current?.showModal();
  }

  function openEntry(entry: FinancialEntry) {
    setSelected(entry);
    setConfirmingRemoval(false);
    setDraft({
      clientId: entry.client?.id ?? "",
      description: entry.description,
      amount: formatMoney(String(entry.amountCents)),
      receivedDate: entry.receivedDate,
      paymentMethod: entry.paymentMethod,
      note: entry.note ?? "",
    });
    setFormError("");
    dialog.current?.showModal();
  }

  function closeDialog() {
    if (busy) return;
    dialog.current?.close();
    setSelected(null);
    setConfirmingRemoval(false);
    setFormError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = moneyToCents(draft.amount);
    if (!amountCents) {
      setFormError("Informe um valor válido.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      if (selected?.source === "payment") {
        await api(`/api/financial/payments/${selected.sourceId}`, {
          method: "PATCH",
          body: JSON.stringify({
            amountCents,
            receivedDate: draft.receivedDate,
            paymentMethod: draft.paymentMethod,
            note: draft.note,
          }),
        });
      } else {
        const path = selected
          ? `/api/financial/manual-receipts/${selected.sourceId}`
          : "/api/financial/manual-receipts";
        await api(path, {
          method: selected ? "PATCH" : "POST",
          body: JSON.stringify({
            clientId: draft.clientId || null,
            description: draft.description,
            amountCents,
            receivedDate: draft.receivedDate,
            paymentMethod: draft.paymentMethod,
            note: draft.note,
          }),
        });
      }
      dialog.current?.close();
      setSelected(null);
      await load(month);
    } catch (cause) {
      setFormError(userMessage(cause, "Não foi possível salvar o recebimento."));
    } finally {
      setBusy(false);
    }
  }

  function requestRemoval() {
    setFormError("");
    setConfirmingRemoval(true);
  }

  async function removeEntry() {
    if (!selected) return;
    setBusy(true);
    setFormError("");
    try {
      if (selected.source === "payment") {
        await api(`/api/financial/payments/${selected.sourceId}`, { method: "DELETE" });
      } else {
        await api(`/api/financial/manual-receipts/${selected.sourceId}`, { method: "DELETE" });
      }
      dialog.current?.close();
      setSelected(null);
      setConfirmingRemoval(false);
      await load(month);
    } catch (cause) {
      setFormError(userMessage(cause, "Não foi possível excluir este recebimento."));
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      const blob = await authenticatedBlob(`/api/financial/export.csv?month=${month}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `prestou-financeiro-${month}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível baixar o CSV."));
    } finally {
      setExporting(false);
    }
  }

  if (!data && !error) return <Spinner label="Abrindo seu financeiro…" />;
  if (!data) return <div className="page"><ErrorNotice message={error} /></div>;

  return <div className="page financial-page">
    <Link className="financial-back" to="/">← Voltar ao painel</Link>
    <div className="financial-heading">
      <div><p className="eyebrow">Seu caixa</p><h1>Financeiro</h1></div>
      <div className="financial-actions">
        <Button variant="outline" onClick={exportCsv} disabled={exporting} loading={exporting} loadingLabel="Baixando…"><Download aria-hidden="true" />CSV</Button>
        <Button onClick={openNewReceipt}><Plus aria-hidden="true" />Adicionar receita</Button>
      </div>
    </div>

    <div className="month-picker">
      <Label htmlFor="financial-month">Mês</Label>
      <select id="financial-month" value={month} onChange={(event) => setMonth(event.target.value)}>
        {data.availableMonths.map((available) => <option key={available} value={available}>{monthLabel(available)}</option>)}
      </select>
    </div>

    <section className="financial-summary">
      <Card className="financial-main-card">
        <span>Recebido em {monthLabel(month)}</span>
        <strong>{brl(data.summary.receivedCents)}</strong>
        <small>No mês anterior: {brl(data.summary.previousMonthReceivedCents)}</small>
      </Card>
      <Card className="financial-mini-card"><span>A receber</span><strong>{brl(data.summary.pendingCents)}</strong><small>Carteira atual</small></Card>
      <Card className="financial-mini-card overdue"><span>Em atraso</span><strong>{brl(data.summary.overdueCents)}</strong><small>Carteira atual</small></Card>
    </section>

    <p className="financial-disclaimer">Este valor considera os pagamentos registrados no Prestou. Recebeu por fora? Adicione para completar seu mês.</p>
    {error && <ErrorNotice message={error} />}

    <section className="financial-list">
      <div className="section-title"><h2>Recebimentos</h2><span>{data.items.length}</span></div>
      {data.items.length === 0
        ? <div className="empty-state"><div className="empty-mark">R$</div><h2>Nenhum recebimento</h2><p>Adicione uma receita recebida por fora ou confirme uma cobrança paga.</p><Button onClick={openNewReceipt}>Adicionar receita</Button></div>
        : data.items.map((entry) => <Card key={`${entry.source}:${entry.sourceId}`} className="financial-entry">
          <div className="financial-entry-main">
            <strong>{entry.client?.name ?? "Sem cliente"}</strong>
            <span>{entry.description} · {new Date(`${entry.receivedDate}T12:00:00`).toLocaleDateString("pt-BR")}</span>
            <div><Badge variant="secondary">{methodLabels[entry.paymentMethod]}</Badge><Badge variant="secondary">{entry.source === "payment" ? "Cobrança" : "Avulsa"}</Badge>{entry.chargeId && <Link className="financial-charge-link" to={`/cobranca/${entry.chargeId}`}>Ver cobrança</Link>}</div>
          </div>
          <div className="financial-entry-value"><strong>{brl(entry.amountCents)}</strong><Button variant="ghost" size="sm" onClick={() => openEntry(entry)}><Pencil aria-hidden="true" />Editar</Button></div>
        </Card>)}
    </section>

    <dialog ref={dialog} className="action-dialog financial-dialog" onCancel={(event) => {
      event.preventDefault();
      if (confirmingRemoval) setConfirmingRemoval(false);
      else closeDialog();
    }}>
      {confirmingRemoval && selected ? <div className="action-dialog-content">
        <div className="action-dialog-heading">
          <span className="action-dialog-icon"><TriangleAlert aria-hidden="true" /></span>
          <div><p className="eyebrow">Confirmar exclusão</p><h2>Excluir do Financeiro?</h2></div>
        </div>
        <p className="action-dialog-summary">{selected.client?.name ?? "Sem cliente"} · {selected.description} · {brl(selected.amountCents)}</p>
        <p className="action-dialog-warning">{selected.source === "payment"
          ? "O recebimento deixará de aparecer nos totais e no CSV. A cobrança continuará paga no histórico."
          : "A receita deixará de aparecer nos totais e no CSV. O registro será preservado para auditoria."}</p>
        {formError && <ErrorNotice message={formError} />}
        <div className="action-dialog-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmingRemoval(false)}>Voltar</Button>
          <Button type="button" variant="destructive" disabled={busy} loading={busy} loadingLabel="Excluindo…" onClick={removeEntry}>Sim, excluir</Button>
        </div>
      </div> : <form className="action-dialog-content" onSubmit={save}>
        <div className="action-dialog-heading">
          <span className="action-dialog-icon financial-icon">{selected ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}</span>
          <div><p className="eyebrow">{selected ? "Corrigir registro" : "Recebimento por fora"}</p><h2>{selected ? "Editar recebimento" : "Adicionar receita"}</h2></div>
        </div>
        <div className="stack">
          {selected?.source === "payment" ? <div className="financial-readonly"><span>Cliente</span><strong>{selected.client?.name}</strong><span>Serviço</span><strong>{selected.description}</strong></div> : <>
            <Label>Cliente <span className="optional">opcional</span><select value={draft.clientId} onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}><option value="">Sem cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Label>
            <Label>Serviço<Input required minLength={2} maxLength={120} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Ex.: corte de cabelo" /></Label>
          </>}
          <div className="two-fields">
            <Label>Valor recebido<Input required inputMode="numeric" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: formatMoney(event.target.value) })} placeholder="0,00" /></Label>
            <Label>Data do recebimento<Input required type="date" value={draft.receivedDate} onChange={(event) => setDraft({ ...draft, receivedDate: event.target.value })} /></Label>
          </div>
          <Label>Forma de pagamento<select value={draft.paymentMethod} onChange={(event) => setDraft({ ...draft, paymentMethod: event.target.value as PaymentMethod })}>{Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Label>
          <Label>Observação <span className="optional">opcional</span><textarea maxLength={500} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Informação útil para o fechamento" /></Label>
        </div>
        {formError && <ErrorNotice message={formError} />}
        {selected && <Button type="button" variant="destructive" disabled={busy} onClick={requestRemoval}><TriangleAlert aria-hidden="true" />{selected.source === "payment" ? "Excluir do Financeiro" : "Excluir receita"}</Button>}
        <div className="action-dialog-actions"><Button type="button" variant="secondary" disabled={busy} onClick={closeDialog}>Cancelar</Button><Button disabled={busy} loading={busy} loadingLabel="Salvando…">Salvar</Button></div>
      </form>}
    </dialog>
  </div>;
}
