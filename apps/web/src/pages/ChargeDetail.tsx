import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, TriangleAlert } from "lucide-react";
import { api, authenticatedFileUrl } from "../api";
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

interface ActionProposal {
  proposalId: string;
  summary: string;
}

type PendingAction = "confirm" | "mark-paid" | "contest" | "confirm-manual" | "receipt" | "copy-link" | null;

export function ChargeDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pendingProposal, setPendingProposal] = useState<ActionProposal | null>(null);
  const [confirmationError, setConfirmationError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const copyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = pendingAction !== null;
  const load = () => api<Detail>(`/api/charges/${id}`).then(setDetail).catch((cause) => setMessage(userMessage(cause, "Não foi possível carregar a cobrança. Tente novamente.")));
  useEffect(() => { void load(); }, [id]);
  useEffect(() => () => {
    if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
  }, []);
  useEffect(() => {
    const dialog = confirmationDialog.current;
    if (!dialog) return;
    if (pendingProposal && !dialog.open) dialog.showModal();
    if (!pendingProposal && dialog.open) dialog.close();
  }, [pendingProposal]);

  async function action(kind: "confirm" | "mark-paid" | "contest") {
    if (!detail) return;
    setPendingAction(kind); setMessage("");
    try {
      let result: { whatsapp?: { deeplink: string } };
      if (kind === "mark-paid") {
        const proposed = await api<{ proposal: ActionProposal }>("/api/action-proposals", {
          method: "POST",
          body: JSON.stringify({
            tool: "marcar_pago_manual",
            arguments: { paymentId: detail.paymentId },
            idempotencyKey: crypto.randomUUID(),
          }),
        });
        setPendingProposal(proposed.proposal);
        return;
      } else {
        result = await api<{ whatsapp?: { deeplink: string } }>(`/api/payments/${detail.paymentId}/${kind}`, { method: "POST" });
      }
      await load();
      if (result.whatsapp?.deeplink) window.location.href = result.whatsapp.deeplink;
    } catch (e) { setMessage(userMessage(e, "Não foi possível concluir a ação. Tente novamente.")); }
    finally { setPendingAction(null); }
  }

  function closeConfirmation() {
    if (busy) return;
    setPendingProposal(null);
    setConfirmationError("");
  }

  async function confirmManualPayment() {
    if (!pendingProposal) return;
    setPendingAction("confirm-manual"); setConfirmationError("");
    try {
      await api(`/api/action-proposals/${pendingProposal.proposalId}/confirm`, {
        method: "POST",
      });
      setPendingProposal(null);
      await load();
    } catch (e) {
      setConfirmationError(userMessage(e, "Não foi possível marcar a cobrança como paga. Tente novamente."));
    } finally {
      setPendingAction(null);
    }
  }

  async function copyPaymentLink() {
    setPendingAction("copy-link"); setMessage("");
    try {
      await navigator.clipboard.writeText(detail!.paymentUrl);
      if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
      setLinkCopied(true);
      copyFeedbackTimer.current = setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      setLinkCopied(false);
      setMessage("Não foi possível copiar o link. Selecione e copie o endereço manualmente.");
    } finally {
      setPendingAction(null);
    }
  }

  async function openReceipt() {
    if (!detail?.comprovanteUrl) return;
    const receiptWindow = window.open("about:blank", "_blank");
    if (receiptWindow) receiptWindow.opener = null;
    setPendingAction("receipt"); setMessage("");
    try {
      const url = await authenticatedFileUrl(detail.comprovanteUrl);
      if (receiptWindow) receiptWindow.location.replace(url);
      else window.location.assign(url);
    } catch (e) {
      receiptWindow?.close();
      setMessage(userMessage(e, "Não foi possível carregar o comprovante. Tente novamente."));
    } finally { setPendingAction(null); }
  }

  if (message && !detail) return <ErrorNotice message={message} />;
  if (!detail) return <Spinner />;
  return <div className="page"><div className="back-title"><Link to="/">←</Link><div><p className="eyebrow">Detalhe da cobrança</p><h1>{detail.client.name}</h1></div></div>
    <Card className="detail-card">
      <div className="detail-value"><span>{detail.description}</span><strong>{detail.amountLabel}</strong></div>
      <dl><div><dt>Vencimento</dt><dd>{new Date(`${detail.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}</dd></div><div><dt>Status</dt><dd><Badge variant="secondary" className={`badge ${detail.status}`}>{detail.status.replace("cliente_confirmou", "aguardando validação").replace("em_aberto", "em aberto")}</Badge></dd></div></dl>
      {detail.comprovanteUrl && <Button variant="ghost" className="receipt-link" disabled={busy} loading={pendingAction === "receipt"} loadingLabel="Abrindo…" onClick={openReceipt}>Ver comprovante anexado ↗</Button>}
    </Card>
    {message && <ErrorNotice message={message} />}
    <div className="action-stack">
      {detail.status === "cliente_confirmou" && <><Button disabled={busy} loading={pendingAction === "confirm"} loadingLabel="Confirmando…" onClick={() => action("confirm")}>Confirmar que recebi</Button><Button disabled={busy} loading={pendingAction === "contest"} loadingLabel="Enviando…" variant="destructive" onClick={() => action("contest")}>Não recebi — pedir conferência</Button></>}
      {(detail.status === "em_aberto" || detail.status === "atrasada") && <Button disabled={busy} loading={pendingAction === "mark-paid"} loadingLabel="Preparando…" variant="secondary" onClick={() => action("mark-paid")}>Marcar como paga manualmente</Button>}
      <Button
        variant="secondary"
        className={linkCopied ? "copy-success" : undefined}
        disabled={busy}
        loading={pendingAction === "copy-link"}
        loadingLabel="Copiando…"
        aria-live="polite"
        onClick={copyPaymentLink}
      >
        {linkCopied && <Check aria-hidden="true" />}
        {linkCopied ? "Link copiado!" : "Copiar link da cobrança"}
      </Button>
    </div>
    <dialog
      ref={confirmationDialog}
      className="action-dialog"
      aria-labelledby="manual-payment-title"
      aria-describedby="manual-payment-summary"
      onCancel={(event) => {
        event.preventDefault();
        closeConfirmation();
      }}
      onClose={() => {
        setPendingProposal(null);
        setConfirmationError("");
      }}
    >
      <div className="action-dialog-content">
        <div className="action-dialog-heading">
          <span className="action-dialog-icon"><TriangleAlert aria-hidden="true" /></span>
          <div>
            <p className="eyebrow">Confirmar recebimento</p>
            <h2 id="manual-payment-title">Confirmar pagamento manual</h2>
          </div>
        </div>
        <p id="manual-payment-summary" className="action-dialog-summary">
          {pendingProposal?.summary}
        </p>
        <p className="action-dialog-warning">
          Confira os dados com atenção. Depois, você poderá corrigir ou reabrir este pagamento no Financeiro.
        </p>
        {confirmationError && <ErrorNotice message={confirmationError} />}
        <div className="action-dialog-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={closeConfirmation}>Cancelar</Button>
          <Button type="button" variant="destructive" disabled={busy} loading={pendingAction === "confirm-manual"} loadingLabel="Confirmando…" onClick={confirmManualPayment}>Sim, marcar como paga</Button>
        </div>
      </div>
    </dialog>
  </div>;
}
