import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorNotice } from "../components";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dateToISO, formatDate, formatMobile, formatMoney, isValidMobile, isoToDate, moneyToCents, normalizeMobile } from "../formats";
import { userMessage } from "../errors";

interface Client { id: string; name: string; whatsapp: string }
interface Created { payment: { id: string }; whatsapp: { deeplink: string; message: string } }

export function NewChargePage() {
  const started = useRef(Date.now());
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clientWhatsapp, setClientWhatsapp] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(() => isoToDate(new Date().toISOString().slice(0, 10)));
  useEffect(() => {
    api<{ clients: Client[] }>("/api/clients")
      .then((response) => setClients(response.clients))
      .catch((cause) => {
        setClients([]);
        setError(userMessage(cause, "Não foi possível carregar os clientes cadastrados. Você ainda pode adicionar um novo cliente."));
      })
      .finally(() => setClientsLoading(false));
  }, []);

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
      const result = await api<Created>("/api/charges", { method: "POST", body: JSON.stringify({ client, description, amountCents, dueDate: dueDateISO, fillMs: Date.now() - started.current }) });
      setCreated(result);
    } catch (err) { setError(userMessage(err, "Não foi possível criar a cobrança. Tente novamente.")); }
    finally { setBusy(false); }
  }

  async function openWhatsApp() {
    if (!created) return;
    setError("");
    try {
      await api(`/api/payments/${created.payment.id}/sent`, { method: "POST" });
      window.location.href = created.whatsapp.deeplink;
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível abrir o WhatsApp. Tente novamente."));
    }
  }

  if (created) return <div className="page success-page"><div className="success-icon">✓</div><p className="eyebrow">Cobrança criada</p><h1>Pronta para enviar</h1><p>A mensagem já está escrita com o valor e o link certo.</p>{error && <ErrorNotice message={error} />}<Button className="whatsapp-button" onClick={openWhatsApp}>Abrir WhatsApp</Button><Button variant="secondary" asChild><Link to="/">Voltar ao painel</Link></Button></div>;

  return <div className="page"><div className="back-title"><Link to="/">←</Link><div><p className="eyebrow">Meta: menos de 60 segundos</p><h1>Nova cobrança</h1></div></div>
    <Card asChild className="form-card"><form className="stack" onSubmit={submit}>
      <Label>Cliente já cadastrado<Select disabled={clientsLoading} value={clientsLoading ? "loading" : selected || "new"} onValueChange={(value) => setSelected(value === "new" ? "" : value)}><SelectTrigger aria-label={clientsLoading ? "Carregando clientes" : "Selecionar cliente"}><SelectValue /></SelectTrigger><SelectContent>{clientsLoading ? <SelectItem value="loading">Carregando clientes…</SelectItem> : <><SelectItem value="new">Novo cliente</SelectItem>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.whatsapp}</SelectItem>)}</>}</SelectContent></Select></Label>
      {!selected && <div className="two-fields"><Label>Nome do cliente<Input name="clientName" required minLength={2} maxLength={80} /></Label><Label>WhatsApp<Input name="clientWhatsapp" inputMode="numeric" autoComplete="tel-national" required placeholder="(11) 99999-9999" value={clientWhatsapp} onChange={(event) => setClientWhatsapp(formatMobile(event.target.value))} maxLength={15} pattern="\([1-9][0-9]\) 9[0-9]{4}-[0-9]{4}" title="Informe um celular válido com DDD" /></Label></div>}
      <Label>Serviço<Input name="description" required minLength={2} maxLength={120} placeholder="Ex.: corte de grama" /></Label>
      <div className="two-fields"><Label>Valor (R$)<Input name="amount" required inputMode="numeric" placeholder="150,00" value={amount} onChange={(event) => setAmount(formatMoney(event.target.value))} maxLength={9} /></Label><Label>Vencimento<Input name="dueDate" required inputMode="numeric" placeholder="DD/MM/AAAA" value={dueDate} onChange={(event) => setDueDate(formatDate(event.target.value))} maxLength={10} pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}" title="Informe uma data válida no formato DD/MM/AAAA" /></Label></div>
      {error && <ErrorNotice message={error} />}
      <Button disabled={busy}>{busy ? "Criando…" : "Criar e preparar mensagem"}</Button>
    </form></Card>
  </div>;
}
