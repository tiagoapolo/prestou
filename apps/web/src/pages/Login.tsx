import { useEffect, useRef, useState, type FormEvent } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useAuth } from "../auth";
import { ErrorNotice } from "../components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { userMessage } from "../errors";
import { Link, useSearchParams } from "react-router-dom";
import { publicApi } from "../api";
import { env } from "../config";

function openEmailClient(appUrl: string, webUrl: string) {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile) {
    window.open(webUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const fallback = window.setTimeout(() => {
    if (document.visibilityState === "visible") window.location.assign(webUrl);
  }, 1200);

  window.addEventListener("pagehide", () => window.clearTimeout(fallback), { once: true });
  window.location.assign(appUrl);
}

export function LoginPage() {
  const { sendMagicLink, sendOnboardingMagicLink, error: authError } = useAuth();
  const [searchParams] = useSearchParams();
  const onboardingToken = searchParams.get("token") ?? "";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(
    onboardingToken && !env.turnstileSiteKey && import.meta.env.DEV ? "development" : "",
  );
  const [phoneMasked, setPhoneMasked] = useState("");
  const turnstileRef = useRef<TurnstileInstance>(undefined);

  useEffect(() => {
    if (!onboardingToken) return;
    publicApi<{ phoneMasked: string }>(
      `/public/whatsapp-onboarding/${encodeURIComponent(onboardingToken)}`,
    ).then((result) => setPhoneMasked(result.phoneMasked))
      .catch((cause) => setError(userMessage(cause, "Este convite é inválido ou expirou.")));
  }, [onboardingToken]);

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
      if (onboardingToken) {
        if (!captchaToken) {
          setError("Confirme que você não é um robô.");
          return;
        }
        await sendOnboardingMagicLink(normalizedEmail, onboardingToken, captchaToken);
      } else {
        await sendMagicLink(normalizedEmail);
      }
      setEmail(normalizedEmail);
      setSent(true);
    } catch (err) {
      if (onboardingToken && env.turnstileSiteKey) {
        setCaptchaToken("");
        turnstileRef.current?.reset();
      }
      setError(userMessage(err, "Não foi possível enviar o link de acesso. Tente novamente."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand hero-brand">prestou<span>.</span></div>
        <p className="eyebrow">{onboardingToken ? "Cadastro pelo WhatsApp" : "Seu Pix, sem perseguição"}</p>
        <h1>{sent ? "Confira seu e-mail" : onboardingToken ? "Conclua seu cadastro" : "Entre no seu painel"}</h1>
        {sent ? (
          <div className="stack">
            <p>Enviamos um link seguro para <strong>{email}</strong>. Toque nele para entrar.</p>
            <div className="email-client-actions" aria-label="Escolha seu aplicativo de e-mail">
              <Button type="button" className="email-client-button gmail-button" onClick={() => openEmailClient("googlegmail://", "https://mail.google.com/mail/u/0/#inbox")}>Abrir Gmail</Button>
              <Button type="button" className="email-client-button outlook-button" onClick={() => openEmailClient("ms-outlook://", "https://outlook.live.com/mail/0/inbox")}>Abrir Outlook</Button>
            </div>
            <Button variant="secondary" onClick={() => setSent(false)}>Usar outro e-mail</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="stack">
            <Label>E-mail
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="voce@exemplo.com" />
            </Label>
            {onboardingToken && phoneMasked && (
              <p>WhatsApp validado: <strong>{phoneMasked}</strong></p>
            )}
            {onboardingToken && env.turnstileSiteKey && (
              <Turnstile
                ref={turnstileRef}
                siteKey={env.turnstileSiteKey}
                onSuccess={setCaptchaToken}
                onExpire={() => setCaptchaToken("")}
                onError={() => setCaptchaToken("")}
              />
            )}
            {(error || authError) && <ErrorNotice message={error || authError} />}
            <Button loading={busy} loadingLabel="Enviando…">
              {onboardingToken ? "Receber link para concluir" : "Receber link para entrar"}
            </Button>
            <small>Sem senha. O link expira e só funciona para você.</small>
            {onboardingToken ? null : <Link className="legal-link" to="/comecar">Ainda não tem conta? Comece pelo WhatsApp</Link>}
          </form>
        )}
        <Link className="legal-link auth-legal-link" to="/privacidade">Política de Privacidade</Link>
      </section>
    </main>
  );
}
