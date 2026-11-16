/**
 * Guarda os tokens da sessão no navegador.
 *
 *  - access token: curto (1h por padrão), vai no cabeçalho de cada requisição;
 *  - refresh token: longo, serve só para pedir um access token novo e é trocado a cada uso.
 *
 * Ficam em localStorage, o que mantém a pessoa logada entre abas e recarregamentos. O custo
 * conhecido é que um script injetado na página (XSS) conseguiria lê-los; o access token
 * curto e a revogação do refresh token no servidor limitam o estrago.
 */
const ACCESS_KEY = "flexia_hub_token";
const REFRESH_KEY = "flexia_hub_refresh_token";

type Listener = () => void;
const expiredListeners = new Set<Listener>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // navegação privada ou armazenamento bloqueado
  }
}

export const session = {
  getAccessToken: () => read(ACCESS_KEY),
  getRefreshToken: () => read(REFRESH_KEY),

  set(tokens: { token: string; refreshToken?: string }) {
    try {
      localStorage.setItem(ACCESS_KEY, tokens.token);
      if (tokens.refreshToken) localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    } catch {
      /* sem armazenamento: a sessão vale só enquanto a página estiver aberta */
    }
  },

  clear() {
    try {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* nada a limpar */
    }
  },

  /** Avisa quem estiver ouvindo (o AuthContext) que a sessão acabou e não pôde ser renovada. */
  notifyExpired() {
    expiredListeners.forEach((listener) => listener());
  },

  onExpired(listener: Listener): () => void {
    expiredListeners.add(listener);
    return () => expiredListeners.delete(listener);
  },
};
