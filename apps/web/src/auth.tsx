import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthError, Session } from "@supabase/supabase-js";
import { api, ApiError } from "./api";
import { UserFacingError, userMessage } from "./errors";
import { supabase } from "./supabase";
import type { Provider } from "./types";

interface AuthValue {
  loading: boolean;
  authenticated: boolean;
  needsOnboarding: boolean;
  provider: Provider | null;
  error: string;
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  refreshProvider(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [authError, setAuthError] = useState("");

  async function loadProvider() {
    try {
      const data = await api<{ provider: Provider }>("/api/providers/me");
      setProvider(data.provider);
      setNeedsOnboarding(false);
      setAuthError("");
    } catch (error) {
      if (error instanceof ApiError && error.code === "ONBOARDING_REQUIRED") {
        setProvider(null);
        setNeedsOnboarding(true);
      } else {
        setProvider(null);
        setAuthError(userMessage(error, "Não foi possível carregar sua conta. Atualize a página e tente novamente."));
      }
    }
  }

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        setSession(data.session);
        if (data.session) loadProvider().finally(() => setLoading(false));
        else setLoading(false);
      })
      .catch((error) => {
        console.error("Session initialization failed", error);
        setAuthError("Não foi possível validar sua sessão. Atualize a página e tente novamente.");
        setLoading(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) loadProvider();
      else {
        setProvider(null);
        setNeedsOnboarding(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthValue>(() => ({
    loading,
    authenticated: Boolean(session),
    needsOnboarding,
    provider,
    error: authError,
    async sendMagicLink(email) {
      setAuthError("");
      if (!supabase) throw new UserFacingError("O acesso está temporariamente indisponível. Tente novamente mais tarde.");
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          shouldCreateUser: true,
        },
      });
      if (error) throw magicLinkError(error);
    },
    async signOut() {
      const { error } = (await supabase?.auth.signOut()) ?? { error: null };
      if (error) {
        console.error("Sign out failed", error);
        throw new UserFacingError("Não foi possível sair da conta. Tente novamente.");
      }
      setSession(null);
      setProvider(null);
    },
    refreshProvider: loadProvider,
  }), [authError, loading, needsOnboarding, provider, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function magicLinkError(error: AuthError): UserFacingError {
  console.error("Magic link sign-in failed", error);
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return new UserFacingError("Você solicitou links demais. Aguarde alguns minutos e tente novamente.");
  }
  if (error.code === "email_address_invalid" || error.code === "validation_failed") {
    return new UserFacingError("Informe um e-mail válido para receber o link de acesso.");
  }
  return new UserFacingError("Não foi possível enviar o link de acesso. Tente novamente em alguns instantes.");
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth fora de AuthProvider");
  return value;
}
