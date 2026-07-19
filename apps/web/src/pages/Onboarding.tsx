import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorNotice } from "../components";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OnboardingPage() {
  const { refreshProvider } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api("/api/providers", {
        method: "POST",
        body: JSON.stringify({
          name: data.get("name"), profession: data.get("profession"),
          whatsapp: data.get("whatsapp"), pixKey: data.get("pixKey"),
          city: data.get("city") || undefined, consent: true,
        }),
      });
      await refreshProvider();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir o cadastro");
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
          <Label>Seu WhatsApp<Input name="whatsapp" required inputMode="tel" placeholder="(11) 99999-9999" /></Label>
          <Label>Chave Pix<Input name="pixKey" required placeholder="CPF, celular, e-mail ou aleatória" /></Label>
          <Label>Cidade <span className="optional">opcional</span><Input name="city" /></Label>
          <Label className="check-row"><Checkbox name="consent" required /> <span>Concordo com o uso destes dados para criar e acompanhar minhas cobranças.</span></Label>
          {error && <ErrorNotice message={error} />}
          <Button disabled={busy}>{busy ? "Salvando…" : "Começar a cobrar"}</Button>
        </form>
      </section>
    </main>
  );
}
