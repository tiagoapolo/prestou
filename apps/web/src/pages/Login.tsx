import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { ErrorNotice } from "../components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { userMessage } from "../errors";

export function LoginPage() {
  const { sendMagicLink, error: authError } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError("E-mail é obrigatório");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sendMagicLink(normalizedEmail);
      setEmail(normalizedEmail);
      setSent(true);
    } catch (err) {
      setError(userMessage(err, "Não foi possível enviar o link de acesso. Tente novamente."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand hero-brand">prestou<span>.</span></div>
        <p className="eyebrow">Seu Pix, sem perseguição</p>
        <h1>{sent ? "Confira seu e-mail" : "Entre no seu painel"}</h1>
        {sent ? (
          <>
            <p>Enviamos um link seguro para <strong>{email}</strong>. Toque nele para entrar.</p>
            <Button variant="secondary" onClick={() => setSent(false)}>Usar outro e-mail</Button>
          </>
        ) : (
          <form onSubmit={submit} className="stack">
            <Label>E-mail
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="voce@exemplo.com" />
            </Label>
            {(error || authError) && <ErrorNotice message={error || authError} />}
            <Button disabled={busy}>{busy ? "Enviando…" : "Receber link para entrar"}</Button>
            <small>Sem senha. O link expira e só funciona para você.</small>
          </form>
        )}
      </section>
    </main>
  );
}
