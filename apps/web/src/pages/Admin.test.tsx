import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../api";
import { AdminPage } from "./Admin";

vi.mock("../api", () => ({ api: vi.fn() }));
const authState = vi.hoisted(() => ({ admin: true }));
vi.mock("../auth", () => ({
  useAuth: () => ({ provider: { admin: authState.admin } }),
}));

const mockApi = vi.mocked(api);

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route path="/" element={<div>Painel</div>} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("página de administração", () => {
  beforeEach(() => {
    mockApi.mockReset();
    authState.admin = true;
  });
  afterEach(cleanup);

  it("redireciona quem não é administrador", async () => {
    authState.admin = false;
    renderPage();

    expect(await screen.findByText("Painel")).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("permite ao administrador criar e revogar um convite", async () => {
    let invites: Array<{ id: string; phone: string; status: string; expires_at: string }> = [];
    mockApi.mockImplementation(<T,>(path: string, init?: RequestInit): Promise<T> => {
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
