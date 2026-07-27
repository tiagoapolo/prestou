import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "../api";
import { UserFacingError } from "../errors";
import { SettingsPage } from "./Settings";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../auth", () => ({
  useAuth: () => ({ refreshProvider: vi.fn() }),
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
  serviceWindow: {
    isOpen: boolean;
    lastInboundAt: string | null;
    expiresAt: string | null;
  };
}

const closedWindow = {
  isOpen: false,
  lastInboundAt: null,
  expiresAt: null,
};

/**
 * Simula os endpoints da página. O estado do número (`/api/whatsapp/number`) é
 * mutável: uma confirmação bem-sucedida promove o candidato a número verificado,
 * como o backend faz, para que o recarregamento reflita o novo estado.
 */
function mockRequests(initial: NumberStatus, confirmError = false, startUnavailable = false) {
  let status = initial;
  let shouldFailConfirmation = confirmError;
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
        serviceWindow: status.serviceWindow,
      };
      return Promise.resolve({ verified: true } as T);
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
  });
  afterEach(cleanup);

  it("mostra o número e o estado verificado atuais", async () => {
    mockRequests({ phone: "11987654321", verified: true, pendingCandidate: null, serviceWindow: closedWindow });
    renderPage();

    expect(await screen.findByText("Verificado")).toBeTruthy();
    expect((screen.getByLabelText("Número do WhatsApp") as HTMLInputElement).value).toBe("(11) 98765-4321");
    expect(screen.queryByLabelText("Código de verificação")).toBeNull();
    expect(screen.getByText(/Janela de atendimento fechada/)).toBeTruthy();
  });

  it("mostra quando a janela de atendimento está aberta", async () => {
    mockRequests({
      phone: "11987654321",
      verified: true,
      pendingCandidate: null,
      serviceWindow: {
        isOpen: true,
        lastInboundAt: "2026-07-27T16:00:00.000Z",
        expiresAt: "2026-07-28T16:00:00.000Z",
      },
    });
    renderPage();

    expect(await screen.findByText(/Janela de atendimento aberta/)).toBeTruthy();
  });

  it("envia o código para o número informado e confirma", async () => {
    mockRequests({ phone: "11988887777", verified: false, pendingCandidate: null, serviceWindow: closedWindow });
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
    mockRequests({ phone: "11976543210", verified: false, pendingCandidate: "11976543210", serviceWindow: closedWindow }, true);
    renderPage();

    fireEvent.change(await screen.findByLabelText("Código de verificação"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar código" }));

    expect(await screen.findByText("Código incorreto.")).toBeTruthy();
    expect(screen.getByLabelText("Código de verificação")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar código" }));
    expect(await screen.findByText("Número do WhatsApp verificado com sucesso.")).toBeTruthy();
  });

  it("não afirma que enviou código quando o servidor não reservou o candidato", async () => {
    mockRequests({ phone: "11987654321", verified: true, pendingCandidate: null, serviceWindow: closedWindow }, false, true);
    renderPage();

    fireEvent.change(await screen.findByLabelText("Número do WhatsApp"), {
      target: { value: "11976543210" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verificar outro número" }));

    expect(await screen.findByText(/Se o número puder ser vinculado/)).toBeTruthy();
    expect(screen.queryByText(/Código enviado/)).toBeNull();
  });
});
