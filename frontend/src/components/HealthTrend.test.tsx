import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthTrend } from "./HealthTrend";

describe("HealthTrend", () => {
  it("explica que o histórico ainda está se formando quando há menos de dois pontos", () => {
    render(<HealthTrend points={[{ date: "2026-11-15", score: 80 }]} />);
    expect(screen.getByText(/histórico começa a se formar/)).toBeInTheDocument();
  });

  it("descreve a tendência em texto e oferece a tabela como alternativa ao gráfico", () => {
    render(
      <HealthTrend
        points={[
          { date: "2026-11-01", score: 90 },
          { date: "2026-11-08", score: 75 },
          { date: "2026-11-15", score: 49 },
        ]}
      />
    );
    expect(screen.getByText("Caiu 41 pontos desde 01/11/2026")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Health score de 90 em 01\/11\/2026 para 49 em 15\/11\/2026/ })).toBeInTheDocument();
    expect(screen.getByText("Ver como tabela")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});
