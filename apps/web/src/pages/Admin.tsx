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

interface AdminProvider {
  id: string;
  name: string;
  email: string | null;
  whatsapp: string;
  profession: string;
  city: string | null;
  state: string | null;
  createdAt: string;
}

interface ProvidersPage {
  providers: AdminProvider[];
  nextCursor: string | null;
}

export function AdminPage() {
  const { provider } = useAuth();
  const [invitePhone, setInvitePhone] = useState("");
  const [invites, setInvites] = useState<WhatsappInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  useEffect(() => {
    if (!provider?.admin) return;
    loadInvites();
    loadProviders();
  }, [provider?.admin]);

  async function loadProviders(query = "", cursor?: string) {
    setProvidersLoading(true);
    setProvidersError("");
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (cursor) params.set("cursor", cursor);
      const suffix = params.size ? `?${params.toString()}` : "";
      const result = await api<ProvidersPage>(`/api/admin/providers${suffix}`);
      setProviders((current) => cursor ? [...current, ...result.providers] : result.providers);
      setNextCursor(result.nextCursor);
    } catch (cause) {
      setProvidersError(userMessage(cause, "Não foi possível carregar os usuários."));
    } finally {
      setProvidersLoading(false);
    }
  }

  function searchProviders(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchInput.trim();
    setSearchQuery(query);
    void loadProviders(query);
  }

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
      <p className="settings-help">Consulte usuários registrados e gerencie os convites de entrada no piloto.</p>

      <Card className="admin-users-card">
        <div className="admin-card-heading">
          <div><p className="eyebrow">Contas ativas</p><h2>Usuários registrados</h2></div>
          {!providersLoading && <small>{providers.length} exibido{providers.length === 1 ? "" : "s"}</small>}
        </div>
        <form className="admin-search" onSubmit={searchProviders}>
          <Input
            aria-label="Buscar usuários"
            type="search"
            placeholder="Nome, e-mail ou WhatsApp"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <Button type="submit" variant="outline" loading={providersLoading}>Buscar</Button>
        </form>
        {providersError && <ErrorNotice message={providersError} />}
        {providersLoading && providers.length === 0 && <Spinner label="Carregando usuários…" />}
        {!providersLoading && !providersError && providers.length === 0 && (
          <p className="admin-empty">Nenhum usuário encontrado.</p>
        )}
        {providers.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table" aria-label="Usuários registrados">
              <thead><tr><th>Usuário</th><th>Contato</th><th>Profissão</th><th>Localização</th><th>Cadastro</th></tr></thead>
              <tbody>
                {providers.map((registeredProvider) => (
                  <tr key={registeredProvider.id}>
                    <td data-label="Usuário"><strong>{registeredProvider.name}</strong><small>{registeredProvider.email ?? "E-mail não informado"}</small></td>
                    <td data-label="Contato">{formatMobile(registeredProvider.whatsapp)}</td>
                    <td data-label="Profissão">{registeredProvider.profession}</td>
                    <td data-label="Localização">{[registeredProvider.city, registeredProvider.state].filter(Boolean).join(" - ") || "—"}</td>
                    <td data-label="Cadastro">{new Date(registeredProvider.createdAt).toLocaleDateString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor && (
          <Button type="button" variant="outline" loading={providersLoading} loadingLabel="Carregando…" onClick={() => void loadProviders(searchQuery, nextCursor)}>
            Carregar mais
          </Button>
        )}
      </Card>

      <Card className="form-card">
        <div className="settings-section-heading">
          <div><p className="eyebrow">Piloto</p><h2>Convites por WhatsApp</h2></div>
        </div>
        <p className="settings-help">
          Ao criar o convite, o Prestou envia uma mensagem para o número informado. O cadastro
          só é ativado quando o próprio número responde ou toca em “Confirmar cadastro”.
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
