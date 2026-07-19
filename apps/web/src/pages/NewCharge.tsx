import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorNotice } from "../components";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Client { id: string; name: string; whatsapp: string }
interface Created { payment: { id: string }; whatsapp: { deeplink: string; message: string } }

export function NewChargePage() {
  const started = useRef(Date.now());
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api<{ clients: Client[] }>("/api/clients").then((r) => setClients(r.clients)); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const amount = Number(String(form.get("amount")).replace(",", "."));
    const client = selected ? { id: selected } : { name: form.get("clientName"), whatsapp: form.get("clientWhatsapp") };
    try {
      const result = await api<Created>("/api/charges", { method: "POST", body: JSON.stringify({ client, description: form.get("description"), amountCents: Math.round(amount * 100), dueDate: form.get("dueDate"), fillMs: Date.now() - started.current }) });
      setCreated(result);
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível criar"); }
    finally { setBusy(false); }
  }

  async function openWhatsApp() {
    if (!created) return;
    await api(`/api/payments/${created.payment.id}/sent`, { method: "POST" });
    window.location.href = created.whatsapp.deeplink;
  }

  if (created) return <div className="page success-page"><div className="success-icon">✓</div><p className="eyebrow">Cobrança criada</p><h1>Pronta para enviar</h1><p>A mensagem já está escrita com o valor e o link certo.</p><Button className="whatsapp-button" onClick={openWhatsApp}>Abrir WhatsApp</Button><Button variant="secondary" asChild><Link to="/">Voltar ao painel</Link></Button></div>;

  return <div className="page"><div className="back-title"><Link to="/">←</Link><div><p className="eyebrow">Meta: menos de 60 segundos</p><h1>Nova cobrança</h1></div></div>
    <Card asChild className="form-card"><form className="stack" onSubmit={submit}>
      {clients.length > 0 && <Label>Cliente já cadastrado<Select value={selected || "new"} onValueChange={(value) => setSelected(value === "new" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">Novo cliente</SelectItem>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.whatsapp}</SelectItem>)}</SelectContent></Select></Label>}
      {!selected && <div className="two-fields"><Label>Nome do cliente<Input name="clientName" required /></Label><Label>WhatsApp<Input name="clientWhatsapp" inputMode="tel" required /></Label></div>}
      <Label>Serviço<Input name="description" required maxLength={120} placeholder="Ex.: corte de grama" /></Label>
      <div className="two-fields"><Label>Valor (R$)<Input name="amount" required inputMode="decimal" placeholder="150,00" /></Label><Label>Vencimento<Input name="dueDate" required type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Label></div>
      {error && <ErrorNotice message={error} />}
      <Button disabled={busy}>{busy ? "Criando…" : "Criar e preparar mensagem"}</Button>
    </form></Card>
  </div>;
}
