import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daysUntil, dueLabel, formatDay } from "./format";

describe("formatDay", () => {
  it("formata AAAA-MM-DD sem deslocar o dia por fuso horário", () => {
    expect(formatDay("2026-11-20")).toBe("20/11/2026");
    expect(formatDay("2026-01-01T00:00:00.000Z")).toBe("01/01/2026");
  });

  it("mostra um traço quando não há data", () => {
    expect(formatDay(null)).toBe("—");
    expect(formatDay(undefined)).toBe("—");
  });
});

describe("prazos relativos", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 15, 14, 30)); // 15/11/2026, horário local
  });
  afterEach(() => vi.useRealTimers());

  it("conta dias corridos a partir de hoje", () => {
    expect(daysUntil("2026-11-15")).toBe(0);
    expect(daysUntil("2026-11-18")).toBe(3);
    expect(daysUntil("2026-11-10")).toBe(-5);
  });

  it("descreve o prazo em linguagem natural", () => {
    expect(dueLabel("2026-11-15")).toBe("vence hoje");
    expect(dueLabel("2026-11-16")).toBe("vence amanhã");
    expect(dueLabel("2026-11-22")).toBe("vence em 7 dias");
    expect(dueLabel("2026-11-14")).toBe("venceu ontem");
    expect(dueLabel("2026-11-05")).toBe("venceu há 10 dias");
  });
});
