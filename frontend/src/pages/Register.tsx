import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { ROLE_LABELS } from "../types";
import type { UserRole } from "../types";

// "Admin" não aparece aqui de propósito: esse papel só é concedido por outro administrador.
const ROLE_OPTIONS = (Object.entries(ROLE_LABELS) as [UserRole, string][]).filter(([role]) => role !== "admin");

export function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("dev");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, refreshToken, user } = await api.register({ name, email, password, role });
      login({ token, refreshToken }, user);
      navigate("/", { replace: true });
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
          <div className="h-9 w-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-semibold text-sm">
            FX
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">FlexIA Hub</p>
            <p className="text-xs text-gray-400 leading-tight">Squad FlexIA</p>
          </div>
        </div>

        <h1 className="text-lg font-semibold mb-1">Criar conta</h1>
        <p className="text-sm text-gray-500 mb-5">Pra escrever no fórum e conversar com o assistente de IA.</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Nome</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Seu nome"
            />
          </div>
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
            <label className="text-xs font-medium text-gray-600">Senha</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Pelo menos 8 caracteres"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Seu papel</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              {ROLE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">O papel de administrador é concedido por outro admin, no painel de administração.</p>
          </div>

          {error && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Criando conta…" : "Criar conta"}
          </button>
        </form>

        <p className="text-xs text-gray-500 mt-4 text-center">
          Já tem conta?{" "}
          <Link to="/login" className="text-indigo-600 font-medium hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
