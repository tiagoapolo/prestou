import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "../api";
import { UserFacingError } from "../errors";
import { SettingsPage } from "./Settings";

vi.mock("../api", () => ({ api: vi.fn() }));
const authState = vi.hoisted(() => ({ admin: false }));
vi.mock("../auth", () => ({
  useAuth: () => ({ provider: { admin: authState.admin }, refreshProvider: vi.fn() }),
}));

const mockApi = vi.mocked(api);
const settings = {
  pixKey: "joao@prestou.com",
  whatsapp: "11988887777",
  defaultDueDays: 5 as const,
};

interface NumberStatus {
  phone: string;
  verified: boolean;
  pendingCandidate: string | null;
}

/**
 * Simula os endpoints da página. O estado do número (`/api/whatsapp/number`) é
 * mutável: uma confirmação bem-sucedida promove o candidato a número verificado,
 * como o backend faz, para que o recarregamento reflita o novo estado.
 */
function mockRequests(initial: NumberStatus, confirmError = false, startUnavailable = false) {
  let status = initial;
  let shouldFailConfirmation = confirmError;
  let invites: Array<{ id: string; phone: string; status: string; expires_at: string }> = [];
  mockApi.mockImplementation(<T,>(path: string, init?: RequestInit): Promise<T> => {
    if (path === "/api/providers/me/settings") return Promise.resolve({ settings } as T);
    if (path === "/api/whatsapp/number") return Promise.resolve(status as T);
    if (path === "/api/whatsapp/number/start") {
      // O backend passa a refletir o candidato pendente no GET seguinte.
      const phone = JSON.parse(String(init?.body ?? "{}")).phone as string;
      if (!startUnavailable) status = { ...status, pendingCandidate: phone };
      return Promise.resolve({ sent: true } as T);
    }
    if (path === "/api/whatsapp/number/confirm") {
      if (shouldFailConfirmation) {
        shouldFailConfirmation = false;
        return Promise.reject(new UserFacingError("Código incorreto."));
      }
      status = {
        phone: status.pendingCandidate ?? status.phone,
        verified: true,
        pendingCandidate: null,
      };
      return Promise.resolve({ verified: true } as T);
    }
    if (path === "/api/admin/whatsapp-invites") {
      if (init?.method === "POST") {
        const phone = JSON.parse(String(init.body ?? "{}")).phone as string;
        invites = [{
          id: "11111111-1111-4111-8111-111111111111",
          phone,
          status: "pending",
          expires_at: "2026-07-31T12:00:00.000Z",
        }, ...invites];
        return Promise.resolve({ invite: invites[0] } as T);
      }
      return Promise.resolve({ invites } as T);
    }
    if (path.endsWith("/revoke")) {
      const id = path.split("/").at(-2);
      invites = invites.map((invite) =>
        invite.id === id ? { ...invite, status: "revoked" } : invite
      );
      return Promise.resolve({ revoked: true } as T);
    }
    return Promise.reject(new Error(`Request inesperado: ${path}`));
  });
}

function renderPage() {
  render(<MemoryRouter><SettingsPage /></MemoryRouter>);
}

describe("número do WhatsApp nas configurações", () => {
  beforeEach(() => {
    mockApi.mockReset();
    authState.admin = false;
  });
  afterEach(cleanup);

  it("mostra o número e o estado verificado atuais", async () => {
    mockRequests({ phone: "11987654321", verified: true, pendingCandidate: null });
    renderPage();

    expect(await screen.findByText("Verificado")).toBeTruthy();
    expect((screen.getByLabelText("Número do WhatsApp") as HTMLInputElement).value).toBe("(11) 98765-4321");
    expect(screen.queryByLabelText("Código de verificação")).toBeNull();
  });

  it("envia o código para o número informado e confirma", async () => {
    mockRequests({ phone: "11988887777", verified: false, pendingCandidate: null });
    renderPage();

    await screen.findByText("Não verificado");
    fireEvent.change(screen.getByLabelText("Número do WhatsApp"), { target: { value: "11976543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));

    await waitFor(() => expect(mockApi).toHaveBeenCalledWith(
      "/api/whatsapp/number/start",
      { method: "POST", body: JSON.stringify({ phone: "11976543210" }) },
    ));
    expect(await screen.findByText(/Código enviado/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Código de verificação"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar código" }));

    await waitFor(() => expect(mockApi).toHaveBeenCalledWith(
      "/api/whatsapp/number/confirm",
      { method: "POST", body: JSON.stringify({ code: "123456" }) },
    ));
    expect(await screen.findByText("Número do WhatsApp verificado com sucesso.")).toBeTruthy();
    expect(screen.getByText("Verificado")).toBeTruthy();
  });

  it("mantém a confirmação disponível após erro da API e permite tentar novamente", async () => {
    mockRequests({ phone: "11976543210", verified: false, pendingCandidate: "11976543210" }, true);
    renderPage();

    fireEvent.change(await screen.findByLabelText("Código de verificação"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar código" }));

    expect(await screen.findByText("Código incorreto.")).toBeTruthy();
    expect(screen.getByLabelText("Código de verificação")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar código" }));
    expect(await screen.findByText("Número do WhatsApp verificado com sucesso.")).toBeTruthy();
  });

  it("não afirma que enviou código quando o servidor não reservou o candidato", async () => {
    mockRequests({ phone: "11987654321", verified: true, pendingCandidate: null }, false, true);
    renderPage();

    fireEvent.change(await screen.findByLabelText("Número do WhatsApp"), {
      target: { value: "11976543210" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verificar outro número" }));

    expect(await screen.findByText(/Se o número puder ser vinculado/)).toBeTruthy();
    expect(screen.queryByText(/Código enviado/)).toBeNull();
  });

  it("permite ao administrador criar e revogar um convite", async () => {
    authState.admin = true;
    mockRequests({ phone: "11987654321", verified: true, pendingCandidate: null });
    renderPage();

    const input = await screen.findByLabelText("Número convidado");
    fireEvent.change(input, { target: { value: "11976543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar convite" }));

    expect(await screen.findByText("(11) 97654-3210")).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith(
      "/api/admin/whatsapp-invites",
      {
        method: "POST",
        body: JSON.stringify({ phone: "11976543210", expiresInDays: 7 }),
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Revogar" }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith(
      "/api/admin/whatsapp-invites/11111111-1111-4111-8111-111111111111/revoke",
      { method: "POST" },
    ));
    expect(await screen.findByText("revoked")).toBeTruthy();
  });
});
