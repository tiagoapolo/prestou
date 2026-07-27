import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { publicApi } from "../api";
import type { PublicPayment } from "../types";
import { PublicPaymentPage } from "./PublicPayment";

vi.mock("../api", () => ({ publicApi: vi.fn() }));

const mockPublicApi = vi.mocked(publicApi);
const payment: PublicPayment = {
  provider: {
    name: "João",
    profession: "Eletricista",
    photoUrl: null,
  },
  description: "Instalação elétrica",
  amountCents: 15000,
  amountLabel: "R$ 150,00",
  dueDate: "2026-07-27",
  status: "em_aberto",
  brCode: "000201010212",
  alreadyConfirmed: false,
};

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/pay/payment-token"]}>
      <Routes>
        <Route path="/pay/:token" element={<PublicPaymentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("página pública de pagamento", () => {
  beforeEach(() => {
    mockPublicApi.mockReset();
    mockPublicApi.mockResolvedValue(payment);
  });
  afterEach(cleanup);

  it("mostra a confirmação de pagamento ao exibir o QR Code", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Ver QR Code" }));

    expect(screen.getByRole("heading", { name: "Já fez o Pix?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Já paguei" })).toBeTruthy();
  });
});
