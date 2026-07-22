import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { ErrorNotice } from "../components";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dateAfterDaysISO, dateToISO, formatDate, formatMobile, formatMoney, isValidMobile, isoToDate, moneyToCents, normalizeMobile } from "../formats";
import { userMessage } from "../errors";
import { useAuth } from "../auth";

interface Client { id: string; name: string; whatsapp: string }
interface Created { payment: { id: string }; whatsapp: { deeplink: string; message: string } }
interface AssistantDraft {
  client: { id?: string; name: string; whatsapp: string };
  description: string;
  amountCents: number;
  dueDate: string;
  startedAt: number;
}

export function NewChargePage() {
  const { provider } = useAuth();
  const location = useLocation();
  const assistantDraft = (location.state as { assistantDraft?: AssistantDraft } | null)?.assistantDraft;
  const started = useRef(assistantDraft?.startedAt ?? Date.now());
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const [openingWhatsApp, setOpeningWhatsApp] = useState(false);
  const [error, setError] = useState("");
  const [clientName, setClientName] = useState(assistantDraft?.client.name ?? "");
  const [clientWhatsapp, setClientWhatsapp] = useState(() => formatMobile(assistantDraft?.client.whatsapp ?? ""));
  const [description, setDescription] = useState(assistantDraft?.description ?? "");
  const [amount, setAmount] = useState(() => assistantDraft ? formatMoney(String(assistantDraft.amountCents)) : "");
  const [dueDate, setDueDate] = useState(() => isoToDate(
    assistantDraft?.dueDate ?? dateAfterDaysISO(provider?.defaultDueDays ?? 0),
  ));
  useEffect(() => {
    api<{ clients: Client[] }>("/api/clients")
      .then((response) => setClients(response.clients))
      .catch((cause) => {
        setClients([]);
        setError(userMessage(cause, "Não foi possível carregar os clientes cadastrados. Você ainda pode adicionar um novo cliente."));
      })
      .finally(() => setClientsLoading(false));
  }, []);

  // Quando o assistente já identificou um cliente cadastrado, seleciona-o só
  // depois que a lista chega: o Select (Radix) só reflete o valor se o item
  // correspondente já estiver montado, então aplicamos num commit separado.
  useEffect(() => {
    const draftClientId = assistantDraft?.client.id;
    if (draftClientId && clients.some((client) => client.id === draftClientId)) {
      setSelected(draftClientId);
    }
  }, [clients]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const amountCents = moneyToCents(amount);
    const dueDateISO = dateToISO(dueDate);
    const clientName = String(form.get("clientName") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    if ((!selected && clientName.length < 2) || description.length < 2) {
      setError("Preencha todos os campos obrigatórios"); setBusy(false); return;
    }
    if (!selected && !isValidMobile(clientWhatsapp)) {
      setError("Informe um celular válido com DDD"); setBusy(false); return;
    }
    if (amountCents === null) {
      setError("Informe um valor entre R$ 0,01 e R$ 99.999,99"); setBusy(false); return;
    }
    if (!dueDateISO) {
      setError("Informe uma data válida no formato DD/MM/AAAA"); setBusy(false); return;
    }
    const client = selected ? { id: selected } : { name: clientName, whatsapp: normalizeMobile(clientWhatsapp) };
    try {
      const result = await api<Created>("/api/charges", { method: "POST", body: JSON.stringify({ client, description, amountCents, dueDate: dueDateISO, fillMs: Date.now() - started.current, source: assistantDraft ? "assistant" : "form" }) });
      setCreated(result);
    } catch (err) { setError(userMessage(err, "Não foi possível criar a cobrança. Tente novamente.")); }
    finally { setBusy(false); }
  }

  async function openWhatsApp() {
    if (!created) return;
    setOpeningWhatsApp(true); setError("");
    try {
      await api(`/api/payments/${created.payment.id}/sent`, { method: "POST" });
      window.location.href = created.whatsapp.deeplink;
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível abrir o WhatsApp. Tente novamente."));
    } finally {
      setOpeningWhatsApp(false);
    }
  }

  if (created) return <div className="page success-page"><div className="success-icon">✓</div><p className="eyebrow">Cobrança criada</p><h1>Pronta para enviar</h1><p>A mensagem já está escrita com o valor e o link certo.</p>{error && <ErrorNotice message={error} />}<Button className="whatsapp-button" loading={openingWhatsApp} loadingLabel="Abrindo…" onClick={openWhatsApp}>Abrir WhatsApp</Button><Button variant="secondary" asChild><Link to="/">Voltar ao painel</Link></Button></div>;

  return <div className="page"><div className="back-title"><Link to="/">←</Link><div><p className="eyebrow">Meta: menos de 60 segundos</p><h1>Nova cobrança</h1></div></div>
    <Card asChild className="form-card"><form className="stack" onSubmit={submit}>
      <Label>Cliente já cadastrado<Select disabled={clientsLoading} value={clientsLoading ? "loading" : selected || "new"} onValueChange={(value) => setSelected(value === "new" ? "" : value)}><SelectTrigger aria-label={clientsLoading ? "Carregando clientes" : "Selecionar cliente"}><SelectValue /></SelectTrigger><SelectContent>{clientsLoading ? <SelectItem value="loading">Carregando clientes…</SelectItem> : <><SelectItem value="new">Novo cliente</SelectItem>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.whatsapp}</SelectItem>)}</>}</SelectContent></Select></Label>
      {!selected && <div className="two-fields"><Label>Nome do cliente<Input name="clientName" required minLength={2} maxLength={80} value={clientName} onChange={(event) => setClientName(event.target.value)} /></Label><Label>WhatsApp<Input name="clientWhatsapp" inputMode="numeric" autoComplete="tel-national" required placeholder="(11) 99999-9999" value={clientWhatsapp} onChange={(event) => setClientWhatsapp(formatMobile(event.target.value))} maxLength={15} pattern="\([1-9][0-9]\) 9[0-9]{4}-[0-9]{4}" title="Informe um celular válido com DDD" /></Label></div>}
      <Label>Serviço<Input name="description" required minLength={2} maxLength={120} placeholder="Ex.: corte de grama" value={description} onChange={(event) => setDescription(event.target.value)} /></Label>
      <div className="two-fields"><Label>Valor (R$)<Input name="amount" required inputMode="numeric" placeholder="150,00" value={amount} onChange={(event) => setAmount(formatMoney(event.target.value))} maxLength={9} /></Label><Label>Vencimento<Input name="dueDate" required inputMode="numeric" placeholder="DD/MM/AAAA" value={dueDate} onChange={(event) => setDueDate(formatDate(event.target.value))} maxLength={10} pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}" title="Informe uma data válida no formato DD/MM/AAAA" /></Label></div>
      {error && <ErrorNotice message={error} />}
      <Button loading={busy} loadingLabel="Criando…">Criar e preparar mensagem</Button>
    </form></Card>
  </div>;
}
