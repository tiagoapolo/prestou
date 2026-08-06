import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { publicApi } from "../api";
import { isOfficialWhatsAppUrl, StartPage } from "./Start";

vi.mock("../api", () => ({ publicApi: vi.fn() }));
const mockPublicApi = vi.mocked(publicApi);

afterEach(() => {
  cleanup();
  mockPublicApi.mockReset();
});

describe("entrada pública de cadastro", () => {
  it("aceita somente links HTTPS do número oficial no wa.me", () => {
    expect(isOfficialWhatsAppUrl("https://wa.me/5541963491134?text=Quero%20come%C3%A7ar")).toBe(true);
    expect(isOfficialWhatsAppUrl("http://wa.me/5541963491134")).toBe(false);
    expect(isOfficialWhatsAppUrl("https://example.com/5541963491134")).toBe(false);
    expect(isOfficialWhatsAppUrl("https://wa.me/not-a-phone")).toBe(false);
  });

  it("expõe um estado acessível enquanto verifica se a entrada está aberta", () => {
    mockPublicApi.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><StartPage /></MemoryRouter>);
    expect(screen.getByRole("status").textContent).toBe("Preparando o cadastro…");
  });
});
