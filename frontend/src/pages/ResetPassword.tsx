import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { LogoMark } from "../components/icons";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tokenFromUrl = searchParams.get("token") ?? "";
  const [token, setToken] = useState(tokenFromUrl);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("As senhas não coincidem");
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
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

        <h1 className="text-lg font-semibold mb-1">Redefinir senha</h1>

        {done ? (
          <p className="text-sm text-gray-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            Senha redefinida. Levando você pro login…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {!tokenFromUrl && (
              <div>
                <label className="text-xs font-medium text-gray-600">Token de redefinição</label>
                <input
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="cole o token aqui"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-gray-600">Nova senha</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Confirmar nova senha</label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {error && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "Salvando…" : "Redefinir senha"}
            </button>
            <Link to="/login" className="block text-center text-xs text-indigo-600 hover:underline">← Voltar pro login</Link>
          </form>
        )}
      </div>
    </div>
  );
}
