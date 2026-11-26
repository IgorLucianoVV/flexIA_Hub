import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DialogTree } from "../../types";
import { DialogTreeView } from "./DialogTreeView";
import { dialogTreeToMermaid } from "./dialogTreeMermaid";
import { MarkdownView } from "./MarkdownView";

// O Mermaid de verdade precisa de layout de navegador; nos testes basta saber o que seria desenhado.
vi.mock("./MermaidDiagram", () => ({
  MermaidDiagram: ({ code }: { code: string }) => <pre data-testid="mermaid">{code}</pre>,
}));

const tree: DialogTree = {
  root: "inicio",
  nodes: [
    { id: "inicio", label: "Boas-vindas", text: "Olá! Como posso ajudar?" },
    { id: "cartao", label: "Cartão", text: "O que deseja fazer com o cartão?" },
    { id: "bloqueio", label: "Bloqueio", text: "Informe os 4 últimos dígitos." },
    { id: "orfao", label: "Pesquisa de satisfação" },
  ],
  edges: [
    { from: "inicio", to: "cartao", label: "Cartão" },
    { from: "cartao", to: "bloqueio", label: "Perdi o cartão" },
    { from: "bloqueio", to: "inicio", label: "Voltar ao menu" },
  ],
};

describe("Árvore de diálogo", () => {
  it("mostra estatísticas, o nó inicial selecionado e os nós fora do fluxo", () => {
    render(<DialogTreeView tree={tree} />);
    expect(screen.getByText(/4 nós · 3 ligações/)).toBeInTheDocument();
    expect(screen.getByText("Olá! Como posso ajudar?")).toBeInTheDocument();
    expect(screen.getByText(/1 fora do fluxo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pesquisa de satisfação" })).toBeInTheDocument();
  });

  it("busca um nó pelo texto (sem acento) e abre o caminho até ele", async () => {
    const user = userEvent.setup();
    render(<DialogTreeView tree={tree} />);
    await user.type(screen.getByPlaceholderText(/Buscar nó/), "ultimos digitos");
    await user.click(screen.getByRole("button", { name: /Bloqueio Informe os 4/ }));
    // Painel do nó selecionado: o texto e de onde se chega nele.
    expect(screen.getAllByText("Informe os 4 últimos dígitos.").length).toBeGreaterThan(0);
    expect(screen.getByText("Chega de")).toBeInTheDocument();
    // Abrindo o nó, o laço de volta para o início aparece como atalho, sem repetir a árvore.
    await user.click(screen.getByRole("button", { name: "Expandir" }));
    expect(screen.getByText("volta")).toBeInTheDocument();
  });

  it("gera o mapa em Mermaid com textos escapados e a raiz destacada", () => {
    const code = dialogTreeToMermaid({
      root: "a",
      nodes: [
        { id: "a", label: 'Diga "oi"' },
        { id: "b", label: "Fim" },
      ],
      edges: [{ from: "a", to: "b", label: "ok" }],
    });
    expect(code).toContain('n0["Diga #quot;oi#quot;"]');
    expect(code).toContain('n0 -->|"ok"| n1');
    expect(code).toContain("class n0 raiz");
  });
});

describe("Documentação em Markdown", () => {
  it("formata Markdown, desenha blocos mermaid e não executa HTML cru", () => {
    const { container } = render(
      <MarkdownView content={"# Título\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n<img src=x onerror=alert(1)>"} />
    );
    expect(screen.getByRole("heading", { name: "Título" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByTestId("mermaid")).toHaveTextContent("flowchart LR");
    expect(container.querySelector("img")).toBeNull();
  });
});
