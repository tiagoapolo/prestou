import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { publicApi } from "../api";
import { ErrorNotice } from "../components";
import { userMessage } from "../errors";

interface PublicSignupStatus {
  isAvailable: boolean;
}

interface SignupEntry {
  whatsappUrl: string;
}

const attributionKeys = ["source", "medium", "campaign", "content"] as const;
type AttributionKey = typeof attributionKeys[number];
type Attribution = Partial<Record<AttributionKey, string>>;

export function isOfficialWhatsAppUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "wa.me" && /^\/\d{10,15}$/.test(url.pathname);
  } catch {
    return false;
  }
}

function attributionFrom(searchParams: URLSearchParams): Attribution {
  return attributionKeys.reduce<Attribution>((result, key) => {
    const value = searchParams.get(key);
    if (value) result[key] = value;
    return result;
  }, {});
}

export function StartPage() {
  const [searchParams] = useSearchParams();
  const [available, setAvailable] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    publicApi<PublicSignupStatus>("/public/whatsapp-signup")
      .then((result) => setAvailable(result.isAvailable))
      .catch(() => {
        setAvailable(false);
        setError("Não foi possível verificar o cadastro agora. Tente novamente em alguns minutos.");
      });
  }, []);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const entry = await publicApi<SignupEntry>("/public/whatsapp-signup-entries", {
        method: "POST",
        body: JSON.stringify(attributionFrom(searchParams)),
      });
      if (!isOfficialWhatsAppUrl(entry.whatsappUrl)) {
        throw new Error("Destino de WhatsApp inválido.");
      }
      window.location.assign(entry.whatsappUrl);
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível abrir o WhatsApp. Tente novamente."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="start-page">
      <section className="start-card" aria-busy={available === undefined}>
        <Link to="/" className="brand">prestou<span>.</span></Link>
        <p className="eyebrow">Cadastro pelo WhatsApp</p>
        <h1>Comece a organizar suas cobranças</h1>
        <p className="start-description">Vamos abrir uma conversa segura no WhatsApp para confirmar seu número e iniciar seu cadastro.</p>
        {error && <ErrorNotice message={error} />}
        {available === undefined ? (
          <p role="status">Preparando o cadastro…</p>
        ) : available ? (
          <button type="button" className="whatsapp-button" onClick={start} disabled={busy}>
            {busy ? "Abrindo WhatsApp…" : "Começar pelo WhatsApp"}
          </button>
        ) : (
          <p className="notice">O cadastro pelo WhatsApp não está disponível neste momento.</p>
        )}
        <Link className="legal-link" to="/privacidade">Política de Privacidade</Link>
      </section>
    </main>
  );
}
