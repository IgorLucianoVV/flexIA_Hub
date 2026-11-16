import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnswerText } from "./AnswerText";

describe("AnswerText", () => {
  it("renderiza negrito e listas", () => {
    render(<AnswerText text={"**Catálogo**\n- Conector Watson\n- Bot CREA\n\nResumo final."} />);
    expect(screen.getByText("Catálogo").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Resumo final.")).toBeInTheDocument();
  });

  it("trata HTML vindo do conteúdo como texto, nunca como marcação", () => {
    const { container } = render(<AnswerText text={'- <img src=x onerror="alert(1)"> nome malicioso'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });
});
