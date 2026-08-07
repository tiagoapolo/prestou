import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { AppShell, Spinner } from "./components";
import { ChargeDetailPage } from "./pages/ChargeDetail";
import { DashboardPage } from "./pages/Dashboard";
import { LoginPage } from "./pages/Login";
import { NewChargePage } from "./pages/NewCharge";
import { OnboardingPage } from "./pages/Onboarding";
import { PublicPaymentPage } from "./pages/PublicPayment";
import { SettingsPage } from "./pages/Settings";
import { PrivacyPage } from "./pages/Privacy";
import { FinancialPage } from "./pages/Financial";
import { AdminPage } from "./pages/Admin";
import { StartPage } from "./pages/Start";
import { ChargeSeriesPage } from "./pages/ChargeSeries";

function PrivateApp() {
  const auth = useAuth();
  if (auth.loading) return <Spinner label="Abrindo o Prestou…" />;
  if (!auth.authenticated) return <LoginPage />;
  if (auth.needsOnboarding) return <OnboardingPage />;
  if (!auth.provider) return <LoginPage />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="financeiro" element={<FinancialPage />} />
        <Route path="nova" element={<NewChargePage />} />
        <Route path="cobranca/:id" element={<ChargeDetailPage />} />
        <Route path="series/:id" element={<ChargeSeriesPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/privacidade" element={<PrivacyPage />} />
      <Route path="/comecar" element={<StartPage />} />
      <Route path="/pay/:token" element={<PublicPaymentPage />} />
      <Route path="/*" element={<PrivateApp />} />
    </Routes>
  );
}
