import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState<{ message: string; devModeToken?: string; devModeNote?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.forgotPassword(email);
      setSent(res);
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

        <h1 className="text-lg font-semibold mb-1">Esqueci minha senha</h1>
        <p className="text-sm text-gray-500 mb-5">Informe seu email pra gerar um link de redefinição.</p>

        {sent ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{sent.message}</p>
            {sent.devModeToken && (
              <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 space-y-2">
                <p className="text-amber-800">{sent.devModeNote}</p>
                <Link
                  to={`/redefinir-senha?token=${sent.devModeToken}`}
                  className="block text-center bg-amber-600 text-white rounded-lg py-1.5 font-medium hover:bg-amber-700"
                >
                  Abrir link de redefinição (modo dev)
                </Link>
              </div>
            )}
            <Link to="/login" className="block text-center text-xs text-indigo-600 hover:underline">← Voltar pro login</Link>
          </div>
        ) : (
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
            {error && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "Enviando…" : "Gerar link de redefinição"}
            </button>
            <Link to="/login" className="block text-center text-xs text-indigo-600 hover:underline">← Voltar pro login</Link>
          </form>
        )}
      </div>
    </div>
  );
}
