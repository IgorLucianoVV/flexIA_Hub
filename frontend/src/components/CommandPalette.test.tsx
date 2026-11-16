import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { api } from "../api";

vi.mock("../api", () => ({ api: { search: vi.fn() } }));
const searchMock = vi.mocked(api.search);

function Where() {
  const location = useLocation();
  return <p data-testid="rota">{location.pathname + location.search}</p>;
}

function renderPalette(onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <CommandPalette open onClose={onClose} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
  return onClose;
}

describe("CommandPalette (busca global)", () => {
  beforeEach(() => searchMock.mockReset());

  it("mostra os atalhos de navegação antes de digitar", () => {
    renderPalette();
    expect(screen.getByText("Catálogo de Conhecimento")).toBeInTheDocument();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("busca enquanto digita e abre o resultado com Enter", async () => {
    searchMock.mockResolvedValue({
      query: "crea",
      results: [{ type: "cliente", id: "c1", title: "CREA", subtitle: "Órgão de classe", path: "/clientes/c1" }],
    });
    const onClose = renderPalette();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Buscar"), "crea");
    await screen.findByText("CREA");
    expect(searchMock).toHaveBeenCalledWith("crea");

    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("rota")).toHaveTextContent("/clientes/c1"));
  });

  it("orienta a usar o Assistente quando não encontra nada", async () => {
    searchMock.mockResolvedValue({ query: "xyz", results: [] });
    renderPalette();
    await userEvent.setup().type(screen.getByLabelText("Buscar"), "xyz");
    expect(await screen.findByText(/Nada encontrado para “xyz”/)).toBeInTheDocument();
  });
});
