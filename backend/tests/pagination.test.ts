import { describe, it, expect } from "vitest";
import { parsePagination, paginatedResponse } from "../src/lib/pagination";

describe("parsePagination", () => {
  it("usa os defaults quando limit/offset não vêm na query", () => {
    expect(parsePagination({})).toEqual({ limit: 20, offset: 0 });
  });

  it("respeita limit e offset válidos", () => {
    expect(parsePagination({ limit: "5", offset: "10" })).toEqual({ limit: 5, offset: 10 });
  });

  it("nunca deixa passar de MAX_LIMIT (100), mesmo se pedirem mais", () => {
    expect(parsePagination({ limit: "500" })).toEqual({ limit: 100, offset: 0 });
  });

  it("ignora limit/offset inválidos (negativo, não numérico, zero) e cai no default", () => {
    expect(parsePagination({ limit: "-5", offset: "-1" })).toEqual({ limit: 20, offset: 0 });
    expect(parsePagination({ limit: "abc", offset: "xyz" })).toEqual({ limit: 20, offset: 0 });
    expect(parsePagination({ limit: "0" })).toEqual({ limit: 20, offset: 0 });
  });

  it("arredonda limit/offset fracionários para baixo", () => {
    expect(parsePagination({ limit: "10.9", offset: "3.9" })).toEqual({ limit: 10, offset: 3 });
  });

  it("aceita um defaultLimit customizado (usado por /clients/:id/clickup-tasks)", () => {
    expect(parsePagination({}, 5)).toEqual({ limit: 5, offset: 0 });
  });
});

describe("paginatedResponse", () => {
  it("monta o envelope {items, total, limit, offset}", () => {
    const result = paginatedResponse(["a", "b"], 42, { limit: 2, offset: 0 });
    expect(result).toEqual({ items: ["a", "b"], total: 42, limit: 2, offset: 0 });
  });
});
