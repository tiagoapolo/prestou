import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../api";
import { ChargeSeriesPage } from "./ChargeSeries";

vi.mock("../api", () => ({ api: vi.fn() }));

const mockApi = vi.mocked(api);
const series = {
  id: "series-1",
  status: "ativa" as const,
  description: "Aulas de inglês",
  amountCents: 20000,
  amountLabel: "R$ 200,00",
  firstDueDate: "2026-08-15",
  dueDay: 15,
  endDate: "2027-01-15",
  nextDueDate: "2026-09-15",
  occurrences: 6,
  generatedCount: 1,
  client: { id: "client-1", name: "Maria", whatsapp: "11999999999" },
  createdAt: "2026-08-06T12:00:00.000Z",
  updatedAt: "2026-08-06T12:00:00.000Z",
};

function detail(status = series.status) {
  return {
    series: { ...series, status },
    charges: [{
      paymentId: "payment-1",
      chargeId: "charge-1",
      description: "Aulas de inglês",
      sequence: 1,
      amountCents: 20000,
      amountLabel: "R$ 200,00",
      dueDate: "2026-08-15",
      status: "em_aberto",
    }],
  };
}

function renderPage() {
  return render(<MemoryRouter initialEntries={["/series/series-1"]}><Routes>
    <Route path="/series/:id" element={<ChargeSeriesPage />} />
  </Routes></MemoryRouter>);
}

describe("série mensal", () => {
  beforeEach(() => {
    mockApi.mockReset();
    vi.stubGlobal("confirm", vi.fn(() => true));
    mockApi.mockImplementation(<T,>(path: string, options?: RequestInit): Promise<T> => {
      if (path === "/api/charge-series/series-1" && !options) return Promise.resolve(detail() as T);
      if (path === "/api/charge-series/series-1" && options?.method === "PATCH") {
        return Promise.resolve({ series: { ...series, description: "Mentoria mensal" } } as T);
      }
      if (path === "/api/charge-series/series-1/pause") {
        return Promise.resolve({ series: { ...series, status: "pausada" } } as T);
      }
      return Promise.reject(new Error(`Request inesperado: ${path}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("exibe competências e permite editar apenas as futuras", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Maria" })).toBeTruthy();
    expect(screen.getByText("1 de 6 cobranças geradas")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Aulas de inglês/ }).getAttribute("href"))
      .toBe("/cobranca/payment-1");

    fireEvent.change(screen.getByLabelText("Serviço das próximas cobranças"), {
      target: { value: "Mentoria mensal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => {
      const call = mockApi.mock.calls.find(([, options]) => options?.method === "PATCH");
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        description: "Mentoria mensal",
        amountCents: 20000,
        dueDay: 15,
        endDate: "2027-01-15",
      });
    });
  });

  it("confirma e pausa a geração sem alterar cobranças existentes", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Pausar série" }));

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("não serão criados retroativamente"));
      expect(mockApi).toHaveBeenCalledWith("/api/charge-series/series-1/pause", { method: "POST" });
    });
    expect(await screen.findByText("Pausada")).toBeTruthy();
  });

  it("mostra erro quando a série não pode ser carregada", async () => {
    mockApi.mockRejectedValueOnce(new Error("indisponível"));
    renderPage();
    expect(await screen.findByText("Não foi possível carregar a série mensal.")).toBeTruthy();
  });
});
