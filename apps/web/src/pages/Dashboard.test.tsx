import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "../api";
import { DashboardPage } from "./Dashboard";

vi.mock("../api", () => ({ api: vi.fn() }));

describe("painel de cobranças", () => {
  beforeEach(() => {
    vi.mocked(api).mockResolvedValue({
      items: [{
        paymentId: "payment-2",
        chargeId: "charge-2",
        description: "Aulas de inglês",
        amountCents: 20000,
        amountLabel: "R$ 200,00",
        dueDate: "2026-09-15",
        recurrence: { seriesId: "series-1", sequence: 2, occurrences: 6 },
        status: "em_aberto",
        client: { name: "Maria", whatsapp: "11999999999" },
        paymentUrl: "https://prestou.app/pay/token",
        hasComprovante: false,
        clientConfirmedAt: null,
        paidAt: null,
        paidVia: null,
        whatsappDeeplink: "https://wa.me/5511999999999",
      }],
      totals: {
        aReceberCents: 20000,
        recebidoMesCents: 0,
        atrasadasCount: 0,
        aguardandoValidacaoCount: 0,
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("identifica a mensalidade e abre a competência pelo paymentId", async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    const charge = await screen.findByRole("link", { name: /Mensalidade 2 de 6/i });
    expect(charge.getAttribute("href")).toBe("/cobranca/payment-2");
  });
});
