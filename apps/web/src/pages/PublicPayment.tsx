import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { publicApi } from "../api";
import { ErrorNotice, Spinner } from "../components";
import { env } from "../config";
import type { PublicPayment } from "../types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function PublicPaymentPage() {
  const { token = "" } = useParams();
  const [payment, setPayment] = useState<PublicPayment | null>(null);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { publicApi<PublicPayment>(`/public/pay/${token}`).then(setPayment).catch((e) => setError(e.message)); }, [token]);

  async function copyCode() {
    if (!payment) return;
    try { await navigator.clipboard.writeText(payment.brCode); }
    catch {
      const area = document.createElement("textarea"); area.value = payment.brCode; document.body.append(area); area.select(); document.execCommand("copy"); area.remove();
    }
    setCopied(true);
    publicApi(`/public/pay/${token}/copied`, { method: "POST" }).catch(() => undefined);
  }

  async function confirm() {
    setBusy(true); setError("");
    try {
      const body = file ? new FormData() : undefined;
      if (body && file) body.append("file", file);
      await publicApi(`/public/pay/${token}/confirm`, { method: "POST", body });
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível confirmar"); }
    finally { setBusy(false); }
  }

  if (error && !payment) return <main className="public-page"><ErrorNotice message={error} /></main>;
  if (!payment) return <Spinner />;
  if (done || payment.alreadyConfirmed) return <main className="public-page"><Card className="receipt-card done-card"><div className="success-icon">✓</div><p className="eyebrow">Tudo certo</p><h1>Confirmação enviada</h1><p>{payment.provider.name} vai conferir o recebimento. Você não precisa enviar comprovante pelo WhatsApp.</p></Card></main>;

  return <main className="public-page">
    <Card className="receipt-card">
      <header className="provider-head">{payment.provider.photoUrl ? <img src={payment.provider.photoUrl} alt="" /> : <div className="avatar">{payment.provider.name[0]}</div>}<div><small>Cobrança de</small><strong>{payment.provider.name}</strong><span>{payment.provider.profession}</span></div></header>
      <div className="receipt-body"><span>Serviço</span><strong>{payment.description}</strong><span>Valor do Pix</span><div className="public-amount">{payment.amountLabel}</div></div>
      <Button className="copy-button" onClick={copyCode}>{copied ? "Código copiado ✓" : "Copiar código Pix"}</Button>
      <Button variant="ghost" className="qr-toggle" onClick={() => setShowQr((value) => !value)}>{showQr ? "Esconder QR Code" : "Ver QR Code"}</Button>
      {showQr && <img className="qr-code" src={`${env.apiUrl}/public/pay/${token}/qr.svg`} alt="QR Code Pix" />}
      {copied && <section className="confirm-panel"><div className="step-mark">2</div><h2>Já fez o Pix?</h2><p>Avise o prestador para ele conferir. O comprovante é opcional.</p><label className="file-label">{file ? file.name : "Anexar comprovante (opcional)"}<Input type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>{error && <ErrorNotice message={error} />}<Button disabled={busy} onClick={confirm}>{busy ? "Enviando…" : "Já paguei"}</Button></section>}
      <footer>Pagamento direto para {payment.provider.name}. O Prestou não recebe nem movimenta o dinheiro.</footer>
    </Card>
  </main>;
}
