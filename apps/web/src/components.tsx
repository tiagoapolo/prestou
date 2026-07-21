import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { Link, Outlet } from "react-router-dom";
import { useAuth } from "./auth";
import { userMessage } from "./errors";
import { LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function Spinner({ label = "Carregando…" }: { label?: string }) {
  return <div className="loading"><LoaderCircle className="spinner" />{label}</div>;
}

export function ErrorNotice({ message }: { message: string }) {
  return <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unexpected interface error", error, info);
  }

  render() {
    if (this.state.failed) {
      return <main className="error-page"><section><ErrorNotice message="Ocorreu um erro inesperado ao abrir esta tela. Recarregue a página para tentar novamente." /><Button onClick={() => window.location.reload()}>Recarregar página</Button></section></main>;
    }
    return this.props.children;
  }
}

export function AppShell() {
  const { signOut } = useAuth();
  const [error, setError] = useState("");
  async function handleSignOut() {
    setError("");
    try {
      await signOut();
    } catch (cause) {
      setError(userMessage(cause, "Não foi possível sair da conta. Tente novamente."));
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">prestou<span>.</span></Link>
        <Button variant="ghost" size="sm" onClick={handleSignOut} aria-label="Sair">Sair</Button>
      </header>
      {error && <div className="shell-error"><ErrorNotice message={error} /></div>}
      <main className="app-content"><Outlet /></main>
    </div>
  );
}
