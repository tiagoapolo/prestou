import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorNotice, Spinner } from "../components";
import { userMessage } from "../errors";
import { formatMobile, isValidMobile, normalizeMobile } from "../formats";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProviderSettings {
  pixKey: string;
  whatsapp: string;
}

export function SettingsPage() {
  const { refreshProvider } = useAuth();
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [pixKey, setPixKey] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<{ settings: ProviderSettings }>("/api/providers/me/settings")
      .then(({ settings: current }) => {
        setSettings(current);
        setPixKey(current.pixKey);
        setWhatsapp(formatMobile(current.whatsapp));
      })
      .catch((cause) => setError(userMessage(cause, "Não foi possível carregar suas configurações.")));
  }, []);

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
        body: JSON.stringify({ pixKey: pixKey.trim(), whatsapp: normalizeMobile(whatsapp) }),
      });
      setSettings(result.settings);
      setPixKey(result.settings.pixKey);
      setWhatsapp(formatMobile(result.settings.whatsapp));
      await refreshProvider();
      setSaved(true);
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível salvar suas configurações. Tente novamente."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page settings-page">
      <div className="back-title"><Link to="/" aria-label="Voltar">‹</Link><div><p className="eyebrow">Sua conta</p><h1>Configurações</h1></div></div>
      <p className="settings-help">Mantenha atualizados os dados usados nas cobranças e no contato com seus clientes.</p>
      {!settings && !error && <Spinner label="Carregando configurações…" />}
      {!settings && error && <ErrorNotice message={error} />}
      {settings && (
        <Card className="form-card">
          <form onSubmit={submit} className="stack">
            <Label>Chave Pix<Input name="pixKey" required value={pixKey} onChange={(event) => setPixKey(event.target.value)} placeholder="CPF, celular, e-mail ou aleatória" autoComplete="off" /></Label>
            <Label>Telefone de contato da empresa<Input name="whatsapp" required inputMode="numeric" autoComplete="tel-national" placeholder="(11) 99999-9999" value={whatsapp} onChange={(event) => setWhatsapp(formatMobile(event.target.value))} maxLength={15} pattern="\([1-9][0-9]\) 9[0-9]{4}-[0-9]{4}" title="Informe um celular válido com DDD" /></Label>
            {error && <ErrorNotice message={error} />}
            {saved && <div className="notice success" role="status">Configurações salvas com sucesso.</div>}
            <Button disabled={busy}>{busy ? "Salvando…" : "Salvar alterações"}</Button>
          </form>
        </Card>
      )}
    </div>
  );
}
