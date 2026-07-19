import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { api, ApiError } from "./api";
import { env } from "./config";
import { supabase } from "./supabase";
import type { Provider } from "./types";

interface AuthValue {
  loading: boolean;
  authenticated: boolean;
  needsOnboarding: boolean;
  provider: Provider | null;
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

  async function loadProvider() {
    try {
      const data = await api<{ provider: Provider }>("/api/providers/me");
      setProvider(data.provider);
      setNeedsOnboarding(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === "ONBOARDING_REQUIRED") {
        setProvider(null);
        setNeedsOnboarding(true);
      } else {
        setProvider(null);
      }
    }
  }

  useEffect(() => {
    if (env.devApiToken) {
      loadProvider().finally(() => setLoading(false));
      return;
    }
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadProvider().finally(() => setLoading(false));
      else setLoading(false);
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
    authenticated: Boolean(session || env.devApiToken),
    needsOnboarding,
    provider,
    async sendMagicLink(email) {
      if (!supabase) throw new Error("Supabase não configurado");
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
    },
    async signOut() {
      await supabase?.auth.signOut();
      setSession(null);
      setProvider(null);
    },
    refreshProvider: loadProvider,
  }), [loading, needsOnboarding, provider, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth fora de AuthProvider");
  return value;
}
