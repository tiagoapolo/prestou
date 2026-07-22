import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { ErrorNotice } from "../components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { userMessage } from "../errors";
import { Link } from "react-router-dom";

function emailClient(email: string) {
  const domain = email.split("@").at(-1)?.toLowerCase();

  if (domain === "gmail.com" || domain === "googlemail.com") {
    return { href: "https://mail.google.com/mail/u/0/#inbox", label: "Abrir Gmail", opensNewTab: true };
  }

  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain ?? "")) {
    return { href: "https://outlook.live.com/mail/0/inbox", label: "Abrir Outlook", opensNewTab: true };
  }

  return { href: "mailto:", label: "Abrir aplicativo de e-mail", opensNewTab: false };
}

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

  const client = emailClient(email);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand hero-brand">prestou<span>.</span></div>
        <p className="eyebrow">Seu Pix, sem perseguição</p>
        <h1>{sent ? "Confira seu e-mail" : "Entre no seu painel"}</h1>
        {sent ? (
          <div className="stack">
            <p>Enviamos um link seguro para <strong>{email}</strong>. Toque nele para entrar.</p>
            <Button asChild>
              <a href={client.href} target={client.opensNewTab ? "_blank" : undefined} rel={client.opensNewTab ? "noreferrer" : undefined}>
                {client.label}
              </a>
            </Button>
            <Button variant="secondary" onClick={() => setSent(false)}>Usar outro e-mail</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="stack">
            <Label>E-mail
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="voce@exemplo.com" />
            </Label>
            {(error || authError) && <ErrorNotice message={error || authError} />}
            <Button loading={busy} loadingLabel="Enviando…">Receber link para entrar</Button>
            <small>Sem senha. O link expira e só funciona para você.</small>
          </form>
        )}
        <Link className="legal-link auth-legal-link" to="/privacidade">Política de Privacidade</Link>
      </section>
    </main>
  );
}
