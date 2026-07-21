import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { ErrorNotice, Spinner } from "../components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { userMessage } from "../errors";

interface Detail {
  paymentId: string; description: string; amountLabel: string; dueDate: string;
  status: string; client: { name: string; whatsapp: string }; paymentUrl: string;
  comprovanteUrl: string | null; clientConfirmedAt: string | null; paidAt: string | null;
}

export function ChargeDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api<Detail>(`/api/charges/${id}`).then(setDetail).catch((cause) => setMessage(userMessage(cause, "Não foi possível carregar a cobrança. Tente novamente.")));
  useEffect(() => { void load(); }, [id]);

  async function action(kind: "confirm" | "mark-paid" | "contest") {
    if (!detail) return;
    setBusy(true); setMessage("");
    try {
      const result = await api<{ whatsapp?: { deeplink: string } }>(`/api/payments/${detail.paymentId}/${kind}`, { method: "POST" });
      await load();
      if (result.whatsapp?.deeplink) window.location.href = result.whatsapp.deeplink;
    } catch (e) { setMessage(userMessage(e, "Não foi possível concluir a ação. Tente novamente.")); }
    finally { setBusy(false); }
  }

  async function copyPaymentLink() {
    setMessage("");
    try {
      await navigator.clipboard.writeText(detail!.paymentUrl);
    } catch {
      setMessage("Não foi possível copiar o link. Selecione e copie o endereço manualmente.");
    }
  }

  if (message && !detail) return <ErrorNotice message={message} />;
  if (!detail) return <Spinner />;
  return <div className="page"><div className="back-title"><Link to="/">←</Link><div><p className="eyebrow">Detalhe da cobrança</p><h1>{detail.client.name}</h1></div></div>
    <Card className="detail-card">
      <div className="detail-value"><span>{detail.description}</span><strong>{detail.amountLabel}</strong></div>
      <dl><div><dt>Vencimento</dt><dd>{new Date(`${detail.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}</dd></div><div><dt>Status</dt><dd><Badge variant="secondary" className={`badge ${detail.status}`}>{detail.status.replace("cliente_confirmou", "aguardando validação").replace("em_aberto", "em aberto")}</Badge></dd></div></dl>
      {detail.comprovanteUrl && <a className="receipt-link" href={detail.comprovanteUrl} target="_blank" rel="noreferrer">Ver comprovante anexado ↗</a>}
    </Card>
    {message && <ErrorNotice message={message} />}
    <div className="action-stack">
      {detail.status === "cliente_confirmou" && <><Button disabled={busy} onClick={() => action("confirm")}>Confirmar que recebi</Button><Button disabled={busy} variant="destructive" onClick={() => action("contest")}>Não recebi — pedir conferência</Button></>}
      {(detail.status === "em_aberto" || detail.status === "atrasada") && <Button disabled={busy} variant="secondary" onClick={() => action("mark-paid")}>Marcar como paga manualmente</Button>}
      <Button variant="secondary" onClick={copyPaymentLink}>Copiar link da cobrança</Button>
    </div>
  </div>;
}
