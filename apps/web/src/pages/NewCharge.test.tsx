import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "../api";
import { NewChargePage } from "./NewCharge";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../auth", () => ({
  useAuth: () => ({ provider: { defaultDueDays: 0 } }),
}));

const mockApi = vi.mocked(api);

describe("nova cobrança", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    mockApi.mockReset();
    mockApi.mockImplementation(<T,>(path: string): Promise<T> => {
      if (path === "/api/clients") return Promise.resolve({ clients: [] } as T);
      if (path === "/api/charges") {
        return Promise.resolve({
          payment: { id: "payment-1" },
          whatsapp: { deeplink: "https://wa.me/5511999999999", message: "Cobrança" },
        } as T);
      }
      return Promise.reject(new Error(`Request inesperado: ${path}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("não salva o novo cliente por padrão", async () => {
    render(<MemoryRouter><NewChargePage /></MemoryRouter>);

    const checkbox = await screen.findByRole("checkbox", {
      name: "Salvar cliente para futuros serviços",
    });
    expect(checkbox.getAttribute("data-state")).toBe("unchecked");

    fireEvent.change(screen.getByLabelText("Nome do cliente"), {
      target: { value: "Maria Cliente" },
    });
    fireEvent.change(screen.getByLabelText("WhatsApp"), {
      target: { value: "11977776666" },
    });
    fireEvent.change(screen.getByLabelText("Serviço"), {
      target: { value: "Corte de grama" },
    });
    fireEvent.change(screen.getByLabelText("Valor (R$)"), {
      target: { value: "15000" },
    });
    fireEvent.click(screen.getByRole("button", {
      name: "Criar e preparar mensagem",
    }));

    await waitFor(() => {
      const call = mockApi.mock.calls.find(([path]) => path === "/api/charges");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        client: { name: "Maria Cliente", whatsapp: "11977776666" },
        saveClient: false,
      });
    });
  });

  it("exige data final, mostra a prévia e envia a recorrência mensal", async () => {
    render(<MemoryRouter><NewChargePage /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText("Nome do cliente"), {
      target: { value: "Maria Cliente" },
    });
    fireEvent.change(screen.getByLabelText("WhatsApp"), {
      target: { value: "11977776666" },
    });
    fireEvent.change(screen.getByLabelText("Serviço"), {
      target: { value: "Manutenção" },
    });
    fireEvent.change(screen.getByLabelText("Valor (R$)"), {
      target: { value: "15000" },
    });
    fireEvent.change(screen.getByLabelText("Vencimento"), {
      target: { value: "15082026" },
    });
    fireEvent.click(screen.getByRole("checkbox", {
      name: "Repetir esta cobrança todo mês",
    }));
    fireEvent.change(await screen.findByLabelText("Data final da série"), {
      target: { value: "15012027" },
    });

    const preview = screen.getByRole("status").textContent ?? "";
    expect(preview).toContain("6 cobranças mensais");
    expect(preview).toContain("15/08/2026");
    expect(preview).toContain("15/01/2027");
    expect(preview).toContain("Só a primeira será criada agora");

    fireEvent.click(screen.getByRole("button", {
      name: "Criar e preparar mensagem",
    }));

    await waitFor(() => {
      const call = mockApi.mock.calls.find(([path]) => path === "/api/charges");
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        recurrence: { frequency: "monthly", endDate: "2027-01-15" },
      });
    });
  });
});
