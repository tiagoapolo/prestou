import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../api";
import { ChargeDetailPage } from "./ChargeDetail";

vi.mock("../api", () => ({ api: vi.fn(), authenticatedFileUrl: vi.fn() }));

describe("detalhe de cobrança recorrente", () => {
  beforeEach(() => {
    vi.mocked(api).mockResolvedValue({
      paymentId: "payment-2",
      description: "Aulas de inglês",
      amountLabel: "R$ 200,00",
      dueDate: "2026-09-15",
      status: "em_aberto",
      client: { name: "Maria", whatsapp: "11999999999" },
      paymentUrl: "https://prestou.app/pay/token",
      comprovanteUrl: null,
      clientConfirmedAt: null,
      paidAt: null,
      recurrence: { seriesId: "series-1", sequence: 2, occurrences: 6 },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("liga a competência à série mensal de origem", async () => {
    render(<MemoryRouter initialEntries={["/cobranca/payment-2"]}><Routes>
      <Route path="/cobranca/:id" element={<ChargeDetailPage />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByText(/Mensalidade 2 de 6/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver série mensal" }).getAttribute("href"))
      .toBe("/series/series-1");
  });
});
