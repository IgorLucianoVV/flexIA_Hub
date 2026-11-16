import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "./types";
import { api } from "./api";
import { session } from "./session";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (tokens: { token: string; refreshToken: string }, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Ao abrir o app: se há sessão guardada, confirma com o servidor quem é o usuário
  // (o cliente de API renova o access token sozinho se ele tiver expirado).
  useEffect(() => {
    if (!session.getAccessToken() && !session.getRefreshToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => {
        session.clear();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // A sessão acabou e não pôde ser renovada (refresh token expirado ou revogado).
  useEffect(() => session.onExpired(() => setUser(null)), []);

  const login = useCallback((tokens: { token: string; refreshToken: string }, newUser: User) => {
    session.set(tokens);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    const refreshToken = session.getRefreshToken();
    // Revoga a sessão no servidor; mesmo que a chamada falhe, o navegador esquece os tokens.
    if (refreshToken) api.logout(refreshToken).catch(() => undefined);
    session.clear();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
