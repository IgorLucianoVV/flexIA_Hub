import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { session } from "./session";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const authHeaderOf = (call: Parameters<typeof fetch>) => new Headers(call[1]?.headers).get("Authorization");

describe("cliente de API — renovação de sessão", () => {
  it("envia o access token em cada requisição", async () => {
    session.set({ token: "acesso-1", refreshToken: "renovacao-1" });
    fetchMock.mockResolvedValueOnce(json(200, { unreadCount: 2 }));

    await expect(api.getUnreadCount()).resolves.toEqual({ unreadCount: 2 });
    expect(authHeaderOf(fetchMock.mock.calls[0])).toBe("Bearer acesso-1");
  });

  it("renova o token em silêncio quando recebe 401 e repete a requisição", async () => {
    session.set({ token: "vencido", refreshToken: "renovacao-1" });
    fetchMock
      .mockResolvedValueOnce(json(401, { error: "Token inválido ou expirado" }))
      .mockResolvedValueOnce(json(200, { token: "novo", refreshToken: "renovacao-2", expiresIn: 3600, user: {} }))
      .mockResolvedValueOnce(json(200, { unreadCount: 5 }));

    await expect(api.getUnreadCount()).resolves.toEqual({ unreadCount: 5 });

    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/refresh");
    expect(authHeaderOf(fetchMock.mock.calls[2])).toBe("Bearer novo");
    // o refresh token é rotacionado: o novo substitui o antigo
    expect(session.getRefreshToken()).toBe("renovacao-2");
  });

  it("faz uma única renovação mesmo com várias requisições recebendo 401 juntas", async () => {
    session.set({ token: "vencido", refreshToken: "renovacao-1" });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/auth/refresh") {
        return json(200, { token: "novo", refreshToken: "renovacao-2", expiresIn: 3600, user: {} });
      }
      return new Headers(init?.headers).get("Authorization") === "Bearer novo"
        ? json(200, { unreadCount: 1 })
        : json(401, { error: "expirado" });
    });

    await Promise.all([api.getUnreadCount(), api.getUnreadCount(), api.getUnreadCount()]);

    const refreshCalls = fetchMock.mock.calls.filter((call) => String(call[0]) === "/api/auth/refresh");
    expect(refreshCalls).toHaveLength(1);
  });

  it("encerra a sessão quando a renovação falha", async () => {
    session.set({ token: "vencido", refreshToken: "revogado" });
    const onExpired = vi.fn();
    const unsubscribe = session.onExpired(onExpired);
    fetchMock
      .mockResolvedValueOnce(json(401, { error: "Token inválido ou expirado" }))
      .mockResolvedValueOnce(json(401, { error: "Sessão expirada. Entre de novo." }));

    await expect(api.getUnreadCount()).rejects.toMatchObject({ status: 401 });

    expect(session.getAccessToken()).toBeNull();
    expect(session.getRefreshToken()).toBeNull();
    expect(onExpired).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("não tenta renovar em rotas de autenticação (401 ali é credencial errada)", async () => {
    session.set({ token: "qualquer", refreshToken: "renovacao-1" });
    fetchMock.mockResolvedValueOnce(json(401, { error: "Email ou senha inválidos" }));

    await expect(api.login({ email: "a@b.c", password: "errada" })).rejects.toThrow("Email ou senha inválidos");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("transforma falha de rede em um erro legível", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const error = await api.getDashboard().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toMatch(/Não foi possível falar com o servidor/);
  });
});
