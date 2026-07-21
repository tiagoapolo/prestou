import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorNotice } from "../components";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMobile, isValidMobile, normalizeMobile } from "../formats";
import { CityAutocomplete } from "../components/CityAutocomplete";
import { userMessage } from "../errors";

export function OnboardingPage() {
  const { refreshProvider } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [whatsapp, setWhatsapp] = useState("");
  const [consent, setConsent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const profession = String(data.get("profession") ?? "").trim();
    const pixKey = String(data.get("pixKey") ?? "").trim();
    const city = String(data.get("city") ?? "").trim();
    const state = String(data.get("state") ?? "");
    const municipalityCode = String(data.get("municipalityCode") ?? "");
    if (name.length < 2 || profession.length < 2 || pixKey.length < 3) {
      setError("Preencha todos os campos obrigatórios");
      setBusy(false);
      return;
    }
    if (!isValidMobile(whatsapp)) {
      setError("Informe um celular válido com DDD");
      setBusy(false);
      return;
    }
    if (!consent) {
      setError("Você precisa concordar com o uso dos dados para continuar");
      setBusy(false);
      return;
    }
    if (city && (!state || !municipalityCode)) {
      setError("Selecione uma cidade/município na lista de sugestões");
      setBusy(false);
      return;
    }
    try {
      await api("/api/providers", {
        method: "POST",
        body: JSON.stringify({
          name, profession,
          whatsapp: normalizeMobile(whatsapp), pixKey,
          municipality: city ? { name: city, state, ibgeCode: municipalityCode } : undefined,
          consent,
        }),
      });
      await refreshProvider();
    } catch (err) {
      setError(userMessage(err, "Não foi possível concluir o cadastro. Tente novamente."));
    } finally { setBusy(false); }
  }

  return (
    <main className="auth-page onboarding-page">
      <section className="auth-card">
        <div className="brand">prestou<span>.</span></div>
        <p className="eyebrow">Só falta uma vez</p>
        <h1>Prepare seu recebimento</h1>
        <form onSubmit={submit} className="stack">
          <Label>Seu nome<Input name="name" required minLength={2} autoComplete="name" /></Label>
          <Label>Profissão<Input name="profession" required minLength={2} placeholder="Jardinagem, consultas…" /></Label>
          <Label>Seu WhatsApp<Input name="whatsapp" required inputMode="numeric" autoComplete="tel-national" placeholder="(11) 99999-9999" value={whatsapp} onChange={(event) => setWhatsapp(formatMobile(event.target.value))} maxLength={15} pattern="\([1-9][0-9]\) 9[0-9]{4}-[0-9]{4}" title="Informe um celular válido com DDD" /></Label>
          <Label>Chave Pix<Input name="pixKey" required placeholder="CPF, celular, e-mail ou aleatória" /></Label>
          <Label>Cidade/município <span className="optional">opcional</span><CityAutocomplete /></Label>
          <Label className="check-row"><Checkbox name="consent" required checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} /> <span>Li a <Link className="legal-link" to="/privacidade" target="_blank">Política de Privacidade</Link> e concordo com o uso destes dados para criar e acompanhar minhas cobranças.</span></Label>
          {error && <ErrorNotice message={error} />}
          <Button loading={busy} loadingLabel="Salvando…">Começar a cobrar</Button>
        </form>
      </section>
    </main>
  );
}
