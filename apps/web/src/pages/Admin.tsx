import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorNotice, Spinner } from "../components";
import { userMessage } from "../errors";
import { formatMobile, isValidMobile, normalizeMobile } from "../formats";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface WhatsappInvite {
  id: string;
  phone: string;
  status: "pending" | "claimed" | "consumed" | "revoked";
  expires_at: string;
}

export function AdminPage() {
  const { provider } = useAuth();
  const [invitePhone, setInvitePhone] = useState("");
  const [invites, setInvites] = useState<WhatsappInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!provider?.admin) return;
    loadInvites();
  }, [provider?.admin]);

  async function loadInvites() {
    setLoading(true);
    try {
      const result = await api<{ invites: WhatsappInvite[] }>("/api/admin/whatsapp-invites");
      setInvites(result.invites);
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível carregar os convites."));
    } finally {
      setLoading(false);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!isValidMobile(invitePhone)) {
      setError("Informe um celular válido com DDD.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/admin/whatsapp-invites", {
        method: "POST",
        body: JSON.stringify({ phone: normalizeMobile(invitePhone), expiresInDays: 7 }),
      });
      setInvitePhone("");
      await loadInvites();
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível criar o convite."));
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite(id: string) {
    setError("");
    try {
      await api(`/api/admin/whatsapp-invites/${id}/revoke`, { method: "POST" });
      await loadInvites();
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível revogar o convite."));
    }
  }

  if (!provider?.admin) return <Navigate to="/" replace />;

  return (
    <div className="page admin-page">
      <div className="back-title"><Link to="/" aria-label="Voltar">‹</Link><div><p className="eyebrow">Acesso restrito</p><h1>Administração</h1></div></div>
      <p className="settings-help">Gerencie os convites de entrada no piloto do Prestou.</p>

      <Card className="form-card">
        <div className="settings-section-heading">
          <div><p className="eyebrow">Piloto</p><h2>Convites por WhatsApp</h2></div>
        </div>
        <p className="settings-help">
          O convite é ativado somente quando o próprio número conversa com o WhatsApp do Prestou.
        </p>
        <form onSubmit={createInvite} className="stack">
          <Label>Número convidado<Input required inputMode="numeric" autoComplete="tel-national" placeholder="(11) 99999-9999" value={invitePhone} onChange={(event) => setInvitePhone(formatMobile(event.target.value))} maxLength={15} /></Label>
          <Button variant="outline" loading={busy} loadingLabel="Convidando…">Criar convite</Button>
        </form>
        {error && <ErrorNotice message={error} />}
        {loading && <Spinner label="Carregando convites…" />}
        {!loading && invites.length > 0 && <div className="stack">
          {invites.map((invite) => <div key={invite.id} className="invite-row">
            <span><strong>{formatMobile(invite.phone)}</strong><small>{invite.status}</small></span>
            {(invite.status === "pending" || invite.status === "claimed") && (
              <Button type="button" variant="ghost" onClick={() => revokeInvite(invite.id)}>Revogar</Button>
            )}
          </div>)}
        </div>}
      </Card>
    </div>
  );
}
