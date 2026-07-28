import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Check, Copy, Trash2 } from "lucide-react";
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

interface AdminInboundMessage {
  id: string;
  senderPhone: string;
  kind: "text" | "button";
  content: string;
  receivedAt: string;
  provider: { id: string; name: string } | null;
}

export function AdminPage() {
  const { provider } = useAuth();
  const [invitePhone, setInvitePhone] = useState("");
  const [manualInvite, setManualInvite] = useState(false);
  const [manualInviteMessage, setManualInviteMessage] = useState("");
  const [manualMessageCopied, setManualMessageCopied] = useState(false);
  const [invites, setInvites] = useState<WhatsappInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState("");
  const [messages, setMessages] = useState<AdminInboundMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [providerToDelete, setProviderToDelete] = useState<AdminProvider | null>(null);
  const [deletingProvider, setDeletingProvider] = useState(false);
  const [deletionError, setDeletionError] = useState("");
  const deletionDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!provider?.admin) return;
    loadInvites();
    loadProviders();
    loadMessages();
  }, [provider?.admin]);

  async function loadMessages() {
    setMessagesLoading(true);
    setMessagesError("");
    try {
      const result = await api<{ messages: AdminInboundMessage[] }>("/api/admin/inbound-messages");
      setMessages(result.messages);
    } catch (cause) {
      setMessagesError(userMessage(cause, "Não foi possível carregar as mensagens."));
    } finally {
      setMessagesLoading(false);
    }
  }

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

  function requestProviderDeletion(registeredProvider: AdminProvider) {
    setProviderToDelete(registeredProvider);
    setDeletionError("");
    deletionDialog.current?.showModal();
  }

  function closeDeletionDialog() {
    if (deletingProvider) return;
    deletionDialog.current?.close();
    setProviderToDelete(null);
    setDeletionError("");
  }

  async function deleteProvider() {
    if (!providerToDelete) return;
    setDeletingProvider(true);
    setDeletionError("");
    try {
      await api(`/api/admin/providers/${providerToDelete.id}`, { method: "DELETE" });
      setProviders((current) => current.filter((item) => item.id !== providerToDelete.id));
      deletionDialog.current?.close();
      setProviderToDelete(null);
    } catch (cause) {
      setDeletionError(userMessage(cause, "Não foi possível remover o usuário."));
    } finally {
      setDeletingProvider(false);
    }
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
      const result = await api<{ manualMessage?: string }>("/api/admin/whatsapp-invites", {
        method: "POST",
        body: JSON.stringify({
          phone: normalizeMobile(invitePhone),
          expiresInDays: 7,
          manual: manualInvite,
        }),
      });
      setInvitePhone("");
      setManualInviteMessage(result.manualMessage ?? "");
      setManualMessageCopied(false);
      await loadInvites();
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível criar o convite."));
    } finally {
      setBusy(false);
    }
  }

  async function copyManualInviteMessage() {
    setError("");
    try {
      await navigator.clipboard.writeText(manualInviteMessage);
      setManualMessageCopied(true);
    } catch {
      setManualMessageCopied(false);
      setError("Não foi possível copiar a mensagem. Tente novamente.");
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
      <p className="settings-help">Acompanhe as mensagens recebidas, consulte usuários e gerencie os convites de entrada no piloto.</p>

      <Card className="admin-users-card">
        <div className="admin-card-heading">
          <div><p className="eyebrow">Todos os chats</p><h2>Últimas mensagens recebidas</h2></div>
          {!messagesLoading && <small>{messages.length} mensagem{messages.length === 1 ? "" : "s"}</small>}
        </div>
        {messagesError && <ErrorNotice message={messagesError} />}
        {messagesLoading && <Spinner label="Carregando mensagens…" />}
        {!messagesLoading && !messagesError && messages.length === 0 && (
          <p className="admin-empty">Nenhuma mensagem recebida ainda.</p>
        )}
        {messages.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table admin-messages-table" aria-label="Últimas mensagens recebidas">
              <thead><tr><th>Chat</th><th>Mensagem</th><th>Tipo</th><th>Recebida em</th></tr></thead>
              <tbody>
                {messages.map((message) => (
                  <tr key={message.id}>
                    <td data-label="Chat">
                      <strong>{message.provider?.name ?? "Número não cadastrado"}</strong>
                      <small>{formatMobile(message.senderPhone)}</small>
                    </td>
                    <td data-label="Mensagem" className="admin-message-content">{message.content}</td>
                    <td data-label="Tipo">{message.kind === "text" ? "Texto" : "Botão"}</td>
                    <td data-label="Recebida em">
                      {new Date(message.receivedAt).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
              <thead><tr><th>Usuário</th><th>Contato</th><th>Profissão</th><th>Localização</th><th>Cadastro</th><th>Ações</th></tr></thead>
              <tbody>
                {providers.map((registeredProvider) => (
                  <tr key={registeredProvider.id}>
                    <td data-label="Usuário"><strong>{registeredProvider.name}</strong><small>{registeredProvider.email ?? "E-mail não informado"}</small></td>
                    <td data-label="Contato">{formatMobile(registeredProvider.whatsapp)}</td>
                    <td data-label="Profissão">{registeredProvider.profession}</td>
                    <td data-label="Localização">{[registeredProvider.city, registeredProvider.state].filter(Boolean).join(" - ") || "—"}</td>
                    <td data-label="Cadastro">{new Date(registeredProvider.createdAt).toLocaleDateString("pt-BR")}</td>
                    <td data-label="Ações">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="admin-delete-button"
                        disabled={registeredProvider.id === provider.id}
                        aria-label={registeredProvider.id === provider.id ? "Sua conta administrativa não pode ser removida" : `Remover ${registeredProvider.name}`}
                        title={registeredProvider.id === provider.id ? "Sua conta administrativa não pode ser removida" : `Remover ${registeredProvider.name}`}
                        onClick={() => requestProviderDeletion(registeredProvider)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </td>
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

      <dialog
        ref={deletionDialog}
        className="action-dialog"
        aria-labelledby="delete-provider-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDeletionDialog();
        }}
      >
        {providerToDelete && <div className="action-dialog-content">
          <div className="action-dialog-heading">
            <span className="action-dialog-icon"><Trash2 aria-hidden="true" /></span>
            <div><p className="eyebrow">Exclusão definitiva</p><h2 id="delete-provider-title">Remover usuário?</h2></div>
          </div>
          <p className="action-dialog-summary">{providerToDelete.name} · {providerToDelete.email ?? formatMobile(providerToDelete.whatsapp)}</p>
          <p className="action-dialog-warning">
            Esta ação removerá permanentemente a conta, clientes, cobranças, recebimentos,
            histórico e comprovantes vinculados. Não será possível desfazer.
          </p>
          {deletionError && <ErrorNotice message={deletionError} />}
          <div className="action-dialog-actions">
            <Button type="button" variant="secondary" disabled={deletingProvider} onClick={closeDeletionDialog}>Cancelar</Button>
            <Button type="button" variant="destructive" loading={deletingProvider} loadingLabel="Removendo…" onClick={() => void deleteProvider()}>
              Remover definitivamente
            </Button>
          </div>
        </div>}
      </dialog>

      <Card className="form-card">
        <div className="settings-section-heading">
          <div><p className="eyebrow">Piloto</p><h2>Convites por WhatsApp</h2></div>
        </div>
        <p className="settings-help">
          Ao criar o convite, o Prestou envia uma mensagem para o número informado. O cadastro
          só é ativado quando o próprio número responde ou toca em “Confirmar cadastro”.
        </p>
        <form onSubmit={createInvite} className="stack">
          <div className="invite-create-row">
            <Label>Número convidado<Input required inputMode="numeric" autoComplete="tel-national" placeholder="(11) 99999-9999" value={invitePhone} onChange={(event) => setInvitePhone(formatMobile(event.target.value))} maxLength={15} /></Label>
            <label className="invite-manual-toggle">
              <span>Envio manual</span>
              <input
                type="checkbox"
                role="switch"
                checked={manualInvite}
                onChange={(event) => setManualInvite(event.target.checked)}
              />
              <span className="invite-toggle-track" aria-hidden="true"><span /></span>
            </label>
          </div>
          {manualInvite && <small>A mensagem não será enviada automaticamente. Você poderá copiá-la após criar o convite.</small>}
          <Button variant="outline" loading={busy} loadingLabel="Convidando…">Criar convite</Button>
        </form>
        {manualInviteMessage && (
          <Button
            type="button"
            variant="link"
            className="invite-copy-message"
            aria-live="polite"
            onClick={() => void copyManualInviteMessage()}
          >
            {manualMessageCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {manualMessageCopied ? "Mensagem copiada!" : "Copiar mensagem de convite"}
          </Button>
        )}
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
