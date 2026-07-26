import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorNotice, Spinner } from "../components";
import { userMessage } from "../errors";
import { formatMobile, isValidMobile, normalizeMobile, onlyDigits } from "../formats";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DefaultDueDays } from "../types";

interface ProviderSettings {
  pixKey: string;
  whatsapp: string;
  defaultDueDays: DefaultDueDays;
}

interface WhatsappNumberStatus {
  /** Número canônico (formato nacional), destino das notificações e do inbound. */
  phone: string;
  /** Já provado (por OTP ou pelo inbound). */
  verified: boolean;
  /** Número aguardando confirmação de código, se houver. */
  pendingCandidate: string | null;
}

export function SettingsPage() {
  const { refreshProvider } = useAuth();
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [pixKey, setPixKey] = useState("");
  const [defaultDueDays, setDefaultDueDays] = useState<DefaultDueDays>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [numberStatus, setNumberStatus] = useState<WhatsappNumberStatus | null>(null);
  const [candidatePhone, setCandidatePhone] = useState("");
  const [code, setCode] = useState("");
  const [verificationBusy, setVerificationBusy] = useState<"start" | "confirm" | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(true);
  const [verificationError, setVerificationError] = useState("");
  const [verificationNotice, setVerificationNotice] = useState("");

  useEffect(() => {
    api<{ settings: ProviderSettings }>("/api/providers/me/settings")
      .then(({ settings: current }) => {
        setSettings(current);
        setPixKey(current.pixKey);
        setDefaultDueDays(current.defaultDueDays);
      })
      .catch((cause) => setError(userMessage(cause, "Não foi possível carregar suas configurações.")));

    loadNumberStatus();
  }, []);

  async function loadNumberStatus() {
    setVerificationLoading(true);
    setVerificationError("");
    try {
      const current = await api<WhatsappNumberStatus>("/api/whatsapp/number");
      setNumberStatus(current);
      // Semeia o campo com o número pendente ou o atual, formatado.
      setCandidatePhone(formatMobile(current.pendingCandidate ?? current.phone));
      return current;
    } catch (cause) {
      setVerificationError(userMessage(cause, "Não foi possível carregar o vínculo do WhatsApp."));
      return null;
    } finally {
      setVerificationLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);

    if (pixKey.trim().length < 3) {
      setError("Informe uma chave Pix válida");
      return;
    }

    setBusy(true);
    try {
      const result = await api<{ settings: ProviderSettings }>("/api/providers/me/settings", {
        method: "PATCH",
        body: JSON.stringify({ pixKey: pixKey.trim(), defaultDueDays }),
      });
      setSettings(result.settings);
      setPixKey(result.settings.pixKey);
      setDefaultDueDays(result.settings.defaultDueDays);
      await refreshProvider();
      setSaved(true);
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível salvar suas configurações. Tente novamente."));
    } finally {
      setBusy(false);
    }
  }

  async function startVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVerificationError("");
    setVerificationNotice("");

    if (!isValidMobile(candidatePhone)) {
      setVerificationError("Informe um celular válido com DDD.");
      return;
    }

    const phone = normalizeMobile(candidatePhone);
    setVerificationBusy("start");
    try {
      await api<{ sent: true }>("/api/whatsapp/number/start", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      setCode("");
      // Recarrega o estado autoritativo do servidor (candidato pendente,
      // verificado) em vez de assumir localmente o resultado do envio.
      const current = await loadNumberStatus();
      setVerificationNotice(
        current?.pendingCandidate === phone
          ? "Código enviado. Digite os 6 números recebidos nesse WhatsApp."
          : "Se o número puder ser vinculado, ele receberá as próximas instruções.",
      );
    } catch (cause) {
      setVerificationError(userMessage(cause, "Não foi possível enviar o código. Tente novamente."));
    } finally {
      setVerificationBusy(null);
    }
  }

  async function confirmVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVerificationError("");
    setVerificationNotice("");

    if (code.length !== 6) {
      setVerificationError("O código tem 6 dígitos.");
      return;
    }

    setVerificationBusy("confirm");
    try {
      await api<{ verified: true }>("/api/whatsapp/number/confirm", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setCode("");
      await loadNumberStatus();
      await refreshProvider();
      setVerificationNotice("Número do WhatsApp verificado com sucesso.");
    } catch (cause) {
      setVerificationError(userMessage(cause, "Não foi possível confirmar o código. Tente novamente."));
    } finally {
      setVerificationBusy(null);
    }
  }

  const pending = numberStatus?.pendingCandidate ?? null;
  const statusLabel = numberStatus?.verified ? "Verificado" : "Não verificado";

  return (
    <div className="page settings-page">
      <div className="back-title"><Link to="/" aria-label="Voltar">‹</Link><div><p className="eyebrow">Sua conta</p><h1>Configurações</h1></div></div>
      <p className="settings-help">Mantenha atualizados os dados usados nas cobranças e no contato com seus clientes.</p>
      {!settings && !error && <Spinner label="Carregando configurações…" />}
      {!settings && error && <ErrorNotice message={error} />}
      {settings && <>
        <Card className="form-card">
          <form onSubmit={submit} className="stack">
            <Label>Chave Pix<Input name="pixKey" required value={pixKey} onChange={(event) => setPixKey(event.target.value)} placeholder="CPF, celular, e-mail ou aleatória" autoComplete="off" /></Label>
            <Label>Vencimento padrão<Select value={String(defaultDueDays)} onValueChange={(value) => setDefaultDueDays(Number(value) as DefaultDueDays)}><SelectTrigger aria-label="Vencimento padrão das cobranças"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">No dia (D+0)</SelectItem><SelectItem value="1">No dia seguinte (D+1)</SelectItem><SelectItem value="5">Em 5 dias (D+5)</SelectItem><SelectItem value="15">Em 15 dias (D+15)</SelectItem><SelectItem value="30">Em 30 dias (D+30)</SelectItem></SelectContent></Select></Label>
            {error && <ErrorNotice message={error} />}
            {saved && <div className="notice success" role="status">Configurações salvas com sucesso.</div>}
            <Button loading={busy} loadingLabel="Salvando…">Salvar alterações</Button>
          </form>
        </Card>

        <Card className="form-card whatsapp-link-card">
          <div className="settings-section-heading">
            <div><p className="eyebrow">Assistente</p><h2>Número do WhatsApp</h2></div>
            {!verificationLoading && numberStatus && (
              <span className={`whatsapp-link-status ${numberStatus.verified ? "verified" : "pending"}`}>
                {statusLabel}
              </span>
            )}
          </div>
          <p className="settings-help">
            Este é o número que recebe as notificações e conversa com o assistente.
            Ele só muda depois de confirmar o código enviado ao número novo.
          </p>

          {verificationLoading && <Spinner label="Carregando vínculo do WhatsApp…" />}

          {!verificationLoading && !numberStatus && verificationError && <>
            <ErrorNotice message={verificationError} />
            <Button type="button" variant="outline" onClick={loadNumberStatus}>Tentar novamente</Button>
          </>}

          {!verificationLoading && numberStatus && <div className="stack">
            {pending && (
              <p className="settings-help">
                Aguardando o código enviado para <strong>{formatMobile(pending)}</strong>.
              </p>
            )}

            <form onSubmit={startVerification} className="stack">
              <Label>Número do WhatsApp<Input name="candidatePhone" required disabled={verificationBusy !== null} inputMode="numeric" autoComplete="tel-national" placeholder="(11) 99999-9999" value={candidatePhone} onChange={(event) => setCandidatePhone(formatMobile(event.target.value))} maxLength={15} pattern="\([1-9][0-9]\) 9[0-9]{4}-[0-9]{4}" title="Informe um celular válido com DDD" /></Label>
              <Button variant="outline" disabled={verificationBusy !== null} loading={verificationBusy === "start"} loadingLabel="Enviando código…">
                {pending ? "Reenviar código" : numberStatus.verified ? "Verificar outro número" : "Enviar código"}
              </Button>
            </form>

            {pending && <form onSubmit={confirmVerification} className="stack verification-code-form">
              <Label>Código de verificação<Input name="code" required disabled={verificationBusy !== null} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={code} onChange={(event) => setCode(onlyDigits(event.target.value).slice(0, 6))} maxLength={6} pattern="[0-9]{6}" title="Informe os 6 dígitos recebidos" /></Label>
              <Button disabled={verificationBusy !== null} loading={verificationBusy === "confirm"} loadingLabel="Confirmando…">Confirmar código</Button>
            </form>}

            {verificationError && <ErrorNotice message={verificationError} />}
            {verificationNotice && <div className="notice success" role="status">{verificationNotice}</div>}
          </div>}
        </Card>

      </>}
    </div>
  );
}
