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
  phone: string | null;
  verified: boolean;
}

export function SettingsPage() {
  const { refreshProvider } = useAuth();
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [pixKey, setPixKey] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [defaultDueDays, setDefaultDueDays] = useState<DefaultDueDays>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState<WhatsappNumberStatus | null>(null);
  const [verificationPhone, setVerificationPhone] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationBusy, setVerificationBusy] = useState<"start" | "confirm" | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(true);
  const [verificationError, setVerificationError] = useState("");
  const [verificationNotice, setVerificationNotice] = useState("");

  useEffect(() => {
    api<{ settings: ProviderSettings }>("/api/providers/me/settings")
      .then(({ settings: current }) => {
        setSettings(current);
        setPixKey(current.pixKey);
        setWhatsapp(formatMobile(current.whatsapp));
        setDefaultDueDays(current.defaultDueDays);
        setVerificationPhone((phone) => phone || formatMobile(current.whatsapp));
      })
      .catch((cause) => setError(userMessage(cause, "Não foi possível carregar suas configurações.")));

    loadWhatsappNumber();
  }, []);

  async function loadWhatsappNumber() {
    setVerificationLoading(true);
    setVerificationError("");
    try {
      const current = await api<WhatsappNumberStatus>("/api/whatsapp/number");
      setWhatsappNumber(current);
      if (current.phone) setVerificationPhone(formatMobile(current.phone));
    } catch (cause) {
      setVerificationError(userMessage(cause, "Não foi possível carregar o vínculo do WhatsApp."));
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
    if (!isValidMobile(whatsapp)) {
      setError("Informe um celular válido com DDD");
      return;
    }

    setBusy(true);
    try {
      const result = await api<{ settings: ProviderSettings }>("/api/providers/me/settings", {
        method: "PATCH",
        body: JSON.stringify({
          pixKey: pixKey.trim(),
          whatsapp: normalizeMobile(whatsapp),
          defaultDueDays,
        }),
      });
      setSettings(result.settings);
      setPixKey(result.settings.pixKey);
      setWhatsapp(formatMobile(result.settings.whatsapp));
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

    if (!isValidMobile(verificationPhone)) {
      setVerificationError("Informe um celular válido com DDD.");
      return;
    }

    const phone = normalizeMobile(verificationPhone);
    setVerificationBusy("start");
    try {
      await api<{ sent: true }>("/api/whatsapp/number/start", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      setWhatsappNumber({ phone: `55${phone}`, verified: false });
      setVerificationCode("");
      setVerificationNotice("Código enviado. Digite os 6 números recebidos no WhatsApp.");
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

    if (verificationCode.length !== 6) {
      setVerificationError("O código tem 6 dígitos.");
      return;
    }

    setVerificationBusy("confirm");
    try {
      await api<{ verified: true }>("/api/whatsapp/number/confirm", {
        method: "POST",
        body: JSON.stringify({ code: verificationCode }),
      });
      setWhatsappNumber((current) => current && { ...current, verified: true });
      setVerificationCode("");
      setVerificationNotice("Número do WhatsApp verificado com sucesso.");
    } catch (cause) {
      setVerificationError(userMessage(cause, "Não foi possível confirmar o código. Tente novamente."));
    } finally {
      setVerificationBusy(null);
    }
  }

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
            <Label>Telefone de contato da empresa<Input name="whatsapp" required inputMode="numeric" autoComplete="tel-national" placeholder="(11) 99999-9999" value={whatsapp} onChange={(event) => setWhatsapp(formatMobile(event.target.value))} maxLength={15} pattern="\([1-9][0-9]\) 9[0-9]{4}-[0-9]{4}" title="Informe um celular válido com DDD" /></Label>
            <Label>Vencimento padrão<Select value={String(defaultDueDays)} onValueChange={(value) => setDefaultDueDays(Number(value) as DefaultDueDays)}><SelectTrigger aria-label="Vencimento padrão das cobranças"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">No dia (D+0)</SelectItem><SelectItem value="1">No dia seguinte (D+1)</SelectItem><SelectItem value="5">Em 5 dias (D+5)</SelectItem><SelectItem value="15">Em 15 dias (D+15)</SelectItem><SelectItem value="30">Em 30 dias (D+30)</SelectItem></SelectContent></Select></Label>
            {error && <ErrorNotice message={error} />}
            {saved && <div className="notice success" role="status">Configurações salvas com sucesso.</div>}
            <Button loading={busy} loadingLabel="Salvando…">Salvar alterações</Button>
          </form>
        </Card>
        <Card className="form-card whatsapp-link-card">
          <div className="settings-section-heading">
            <div><p className="eyebrow">Assistente</p><h2>WhatsApp vinculado</h2></div>
            {!verificationLoading && whatsappNumber && (
              <span className={`whatsapp-link-status ${whatsappNumber.verified ? "verified" : "pending"}`}>
                {whatsappNumber.verified ? "Verificado" : whatsappNumber.phone ? "Aguardando código" : "Não vinculado"}
              </span>
            )}
          </div>
          <p className="settings-help">Verifique o número que você usará para conversar com o assistente do Prestou.</p>
          {verificationLoading && <Spinner label="Carregando vínculo do WhatsApp…" />}
          {!verificationLoading && !whatsappNumber && verificationError && <>
            <ErrorNotice message={verificationError} />
            <Button type="button" variant="outline" onClick={loadWhatsappNumber}>Tentar novamente</Button>
          </>}
          {!verificationLoading && whatsappNumber && <div className="stack">
            <form onSubmit={startVerification} className="stack">
              <Label>Número do WhatsApp<Input name="verificationPhone" required disabled={verificationBusy !== null} inputMode="numeric" autoComplete="tel-national" placeholder="(11) 99999-9999" value={verificationPhone} onChange={(event) => setVerificationPhone(formatMobile(event.target.value))} maxLength={15} pattern="\([1-9][0-9]\) 9[0-9]{4}-[0-9]{4}" title="Informe um celular válido com DDD" /></Label>
              <Button variant="outline" disabled={verificationBusy !== null} loading={verificationBusy === "start"} loadingLabel="Enviando código…">
                {whatsappNumber.verified ? "Verificar outro número" : whatsappNumber.phone ? "Reenviar código" : "Enviar código"}
              </Button>
            </form>
            {!whatsappNumber.verified && whatsappNumber.phone && <form onSubmit={confirmVerification} className="stack verification-code-form">
              <Label>Código de verificação<Input name="verificationCode" required disabled={verificationBusy !== null} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={verificationCode} onChange={(event) => setVerificationCode(onlyDigits(event.target.value).slice(0, 6))} maxLength={6} pattern="[0-9]{6}" title="Informe os 6 dígitos recebidos" /></Label>
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
