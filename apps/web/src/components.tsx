import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./auth";
import { LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function Spinner({ label = "Carregando…" }: { label?: string }) {
  return <div className="loading"><LoaderCircle className="spinner" />{label}</div>;
}

export function ErrorNotice({ message }: { message: string }) {
  return <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>;
}

export function AppShell() {
  const { provider, signOut } = useAuth();
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">prestou<span>.</span></Link>
        <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sair">Sair</Button>
      </header>
      <main className="app-content"><Outlet /></main>
      <nav className="bottom-nav" aria-label="Navegação principal">
        <NavLink to="/" end>Quem me deve</NavLink>
        <NavLink to="/nova">Nova cobrança</NavLink>
        <span className="nav-person">{provider?.name.split(" ")[0]}</span>
      </nav>
    </div>
  );
}
