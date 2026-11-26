import { useState, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { LogoMark } from "../components/icons";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const from = (location.state as any)?.from?.pathname || "/";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, refreshToken, user } = await api.login({ email, password });
      login({ token, refreshToken }, user);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f7f7fb] px-4">
      <div className="w-full max-w-sm bg-white rounded-xl border border-gray-200 p-7">
        <div className="flex items-center gap-2 mb-6">
          <LogoMark className="h-9 w-9" />
          <div>
            <p className="font-semibold text-sm leading-tight">FlexIA Hub</p>
            <p className="text-xs text-gray-400 leading-tight">Squad FlexIA</p>
          </div>
        </div>

        <h1 className="text-lg font-semibold mb-1">Entrar</h1>
        <p className="text-sm text-gray-500 mb-5">Use sua conta pra participar do fórum e do assistente de IA.</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="voce@flexia.local"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-600">Senha</label>
              <Link to="/esqueci-senha" className="text-xs text-indigo-600 hover:underline">Esqueci minha senha</Link>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="text-xs text-gray-500 mt-4 text-center">
          Ainda não tem conta?{" "}
          <Link to="/cadastro" className="text-indigo-600 font-medium hover:underline">
            Criar conta
          </Link>
        </p>

        <p className="text-[11px] text-gray-400 mt-4 text-center">
          Contas de demonstração (senha <code className="bg-gray-50 px-1 rounded">demo1234</code>):{" "}
          <code className="bg-gray-50 px-1 rounded">demo@flexia.local</code> (admin) e{" "}
          <code className="bg-gray-50 px-1 rounded">ana@flexia.local</code> (analista de ativação)
        </p>
      </div>
    </div>
  );
}
