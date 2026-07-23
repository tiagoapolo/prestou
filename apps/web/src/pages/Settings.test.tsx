import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "../api";
import { UserFacingError } from "../errors";
import { SettingsPage } from "./Settings";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../auth", () => ({ useAuth: () => ({ refreshProvider: vi.fn() }) }));

const mockApi = vi.mocked(api);
const settings = {
  pixKey: "joao@prestou.com",
  whatsapp: "11988887777",
  defaultDueDays: 5 as const,
};

function mockRequests(status: { phone: string | null; verified: boolean }, confirmError = false) {
  let shouldFailConfirmation = confirmError;
  mockApi.mockImplementation(<T,>(path: string): Promise<T> => {
    if (path === "/api/providers/me/settings") return Promise.resolve({ settings } as T);
    if (path === "/api/whatsapp/number") return Promise.resolve(status as T);
    if (path === "/api/whatsapp/number/start") return Promise.resolve({ sent: true } as T);
    if (path === "/api/whatsapp/number/confirm") {
      if (shouldFailConfirmation) {
        shouldFailConfirmation = false;
        return Promise.reject(new UserFacingError("Código incorreto."));
      }
      return Promise.resolve({ verified: true } as T);
    }
    return Promise.reject(new Error(`Request inesperado: ${path}`));
  });
}

function renderPage() {
  render(<MemoryRouter><SettingsPage /></MemoryRouter>);
}

describe("vínculo do WhatsApp nas configurações", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });
  afterEach(cleanup);

  it("mostra o número e o estado verificado atuais", async () => {
    mockRequests({ phone: "5511987654321", verified: true });
    renderPage();

    expect(await screen.findByText("Verificado")).toBeTruthy();
    expect((screen.getByLabelText("Número do WhatsApp") as HTMLInputElement).value).toBe("(11) 98765-4321");
    expect(screen.queryByLabelText("Código de verificação")).toBeNull();
  });

  it("envia o código e confirma o número informado", async () => {
    mockRequests({ phone: null, verified: false });
    renderPage();

    await screen.findByText("Não vinculado");
    fireEvent.change(screen.getByLabelText("Número do WhatsApp"), { target: { value: "11976543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));

    await waitFor(() => expect(mockApi).toHaveBeenCalledWith(
      "/api/whatsapp/number/start",
      { method: "POST", body: JSON.stringify({ phone: "11976543210" }) },
    ));
    expect(await screen.findByText("Aguardando código")).toBeTruthy();
    expect(screen.getByText(/Código enviado/)).toBeTruthy();

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
    mockRequests({ phone: "5511976543210", verified: false }, true);
    renderPage();

    fireEvent.change(await screen.findByLabelText("Código de verificação"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar código" }));

    expect(await screen.findByText("Código incorreto.")).toBeTruthy();
    expect(screen.getByLabelText("Código de verificação")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar código" }));
    expect(await screen.findByText("Número do WhatsApp verificado com sucesso.")).toBeTruthy();
  });
});
