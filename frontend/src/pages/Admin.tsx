import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { AdminUser, AssistantInsights, AuditEntry, ForumCategory, UserRole } from "../types";
import { ROLE_LABELS } from "../types";
import { formatDateTime, formatDay, timeAgo } from "../lib/format";

const TABS = [
  { id: "usuarios", label: "Usuários" },
  { id: "auditoria", label: "Auditoria" },
  { id: "assistente", label: "Uso do Assistente" },
  { id: "forum", label: "Categorias do fórum" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function AdminPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === searchParams.get("aba"))?.id ?? "usuarios") as TabId;

  // A API recusa quem não é admin de qualquer forma; aqui só evitamos mostrar uma tela vazia.
  if (user && user.role !== "admin") return <Navigate to="/" replace />;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Administração</h1>
        <p className="text-gray-500 text-sm mt-1">Contas e papéis, histórico de alterações e uso do Assistente de IA.</p>
      </header>

      <div className="flex gap-1 border-b border-gray-200" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setSearchParams({ aba: t.id })}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.id ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "usuarios" && <UsersTab currentUserId={user?.id} />}
      {tab === "auditoria" && <AuditTab />}
      {tab === "assistente" && <AssistantTab />}
      {tab === "forum" && <ForumCategoriesTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------
function UsersTab({ currentUserId }: { currentUserId?: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .getAdminUsers({ q: q || undefined })
      .then((res) => setUsers(res.items))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function update(id: string, data: { role?: UserRole; isActive?: boolean }) {
    setError(null);
    try {
      const updated = await api.updateAdminUser(id, data);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
    } catch (err: any) {
      setError(err.message);
      load(); // desfaz a escolha otimista no <select>
    }
  }

  return (
    <div className="space-y-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nome ou email…"
        className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-72 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2.5">{error}</p>}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="px-4 py-3 font-medium">Pessoa</th>
              <th className="px-4 py-3 font-medium">Papel</th>
              <th className="px-4 py-3 font-medium">Último login</th>
              <th className="px-4 py-3 font-medium">Situação</th>
              <th className="px-4 py-3 font-medium text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-gray-400">Carregando…</td>
              </tr>
            ) : (
              users.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id} className={u.is_active ? "" : "bg-gray-50 text-gray-400"}>
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {u.name}
                        {isSelf && <span className="text-xs text-gray-400 font-normal"> (você)</span>}
                      </p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        disabled={isSelf || !u.is_active}
                        onChange={(e) => update(u.id, { role: e.target.value as UserRole })}
                        aria-label={`Papel de ${u.name}`}
                        title={isSelf ? "Você não pode alterar o seu próprio papel" : undefined}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60"
                      >
                        {(Object.entries(ROLE_LABELS) as [UserRole, string][]).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{u.last_login_at ? timeAgo(u.last_login_at) : "nunca"}</td>
                    <td className="px-4 py-3 text-xs">{u.is_active ? <span className="text-emerald-700">● Ativa</span> : "○ Desativada"}</td>
                    <td className="px-4 py-3 text-right">
                      {!isSelf && (
                        <button
                          onClick={() => {
                            if (u.is_active && !window.confirm(`Desativar a conta de ${u.name}? A pessoa perde o acesso e as sessões abertas são encerradas.`)) return;
                            update(u.id, { isActive: !u.is_active });
                          }}
                          className={`text-xs font-medium hover:underline ${u.is_active ? "text-rose-600" : "text-indigo-600"}`}
                        >
                          {u.is_active ? "Desativar" : "Reativar"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        Quem se cadastra pela tela de cadastro escolhe o próprio papel, exceto admin. Mudanças de papel valem a partir da
        próxima renovação da sessão da pessoa (no máximo 1 hora).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------
const AUDIT_AREAS = [
  { value: "", label: "Tudo" },
  { value: "client", label: "Clientes" },
  { value: "knowledge", label: "Catálogo" },
  { value: "activation", label: "Ativação" },
  { value: "forum", label: "Fórum" },
  { value: "user", label: "Contas" },
];
const AUDIT_PAGE = 30;

function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [area, setArea] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(
      () =>
        api
          .getAuditLog({ action: area || undefined, q: q || undefined, limit: AUDIT_PAGE, offset: 0 })
          .then((res) => {
            setEntries(res.items);
            setTotal(res.total);
          })
          .finally(() => setLoading(false)),
      q ? 300 : 0
    );
    return () => clearTimeout(timer);
  }, [area, q]);

  async function loadMore() {
    const res = await api.getAuditLog({ action: area || undefined, q: q || undefined, limit: AUDIT_PAGE, offset: entries.length });
    setEntries((prev) => [...prev, ...res.items]);
    setTotal(res.total);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por pessoa ou ação…"
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-72 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {AUDIT_AREAS.map((a) => (
          <button
            key={a.value}
            onClick={() => setArea(a.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border ${
              area === a.value ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <p className="px-5 py-6 text-sm text-gray-400">Carregando…</p>
        ) : entries.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-400">
            Nenhum registro. O log começa a ser preenchido a partir das próximas alterações feitas no Hub.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {entries.map((e) => (
              <li key={e.id} className="px-5 py-3 flex items-start justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <p>
                    <span className="font-medium">{e.actor_name}</span> <span className="text-gray-600">— {e.summary}</span>
                  </p>
                  <p className="text-[11px] text-gray-400 font-mono mt-0.5">{e.action}</p>
                </div>
                <time className="text-xs text-gray-400 shrink-0" dateTime={e.created_at} title={formatDateTime(e.created_at)}>
                  {timeAgo(e.created_at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{entries.length} de {total} registros</span>
        {entries.length < total && (
          <button onClick={loadMore} className="text-indigo-600 font-medium hover:underline">Carregar mais</button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uso do Assistente de IA
// ---------------------------------------------------------------------------
function AssistantTab() {
  const [data, setData] = useState<AssistantInsights | null>(null);

  useEffect(() => {
    api.getAssistantInsights().then(setData);
  }, []);

  if (!data) return <p className="text-sm text-gray-400">Carregando…</p>;
  const { totals, recent, negative } = data;
  const rated = totals.positive + totals.negative;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Perguntas (total)" value={totals.questions} sub={`${totals.last_7_days} nos últimos 7 dias`} />
        <Stat label="Pessoas usando" value={totals.users} />
        <Stat
          label="Respostas avaliadas como úteis"
          value={rated > 0 ? `${Math.round((totals.positive / rated) * 100)}%` : "—"}
          sub={rated > 0 ? `${totals.positive} 👍 · ${totals.negative} 👎` : "ainda sem avaliações"}
        />
        <Stat label="Tempo médio de resposta" value={totals.questions > 0 ? `${(totals.avg_duration_ms / 1000).toFixed(1)}s` : "—"} />
      </div>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-sm mb-1">Respostas que não ajudaram</h2>
        <p className="text-xs text-gray-500 mb-4">
          Onde o time procurou e não achou: cada item é uma lacuna de conhecimento para cobrir no catálogo ou no fórum.
        </p>
        {negative.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhuma resposta avaliada negativamente.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {negative.map((n) => (
              <li key={n.id} className="py-3 text-sm">
                <p className="font-medium">{n.question}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {n.user_name} · {formatDay(n.created_at)}
                </p>
                <details className="mt-1 text-xs text-gray-500">
                  <summary className="cursor-pointer hover:text-gray-700">Ver a resposta dada</summary>
                  <p className="mt-1 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{n.answer}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-sm mb-4">Perguntas recentes</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-400">Ninguém perguntou nada ainda.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recent.map((r) => (
              <li key={r.id} className="py-2.5 flex items-start justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{r.question}</p>
                  <p className="text-xs text-gray-400">{r.user_name}</p>
                </div>
                <span className="text-xs text-gray-400 shrink-0 flex items-center gap-2">
                  {r.feedback === 1 && <span title="Avaliada como útil">👍</span>}
                  {r.feedback === -1 && <span title="Avaliada como não útil">👎</span>}
                  {timeAgo(r.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categorias do fórum
// ---------------------------------------------------------------------------
function ForumCategoriesTab() {
  const [categories, setCategories] = useState<ForumCategory[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => api.getForumCategories().then(setCategories);
  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // O identificador da URL (slug) é derivado do nome: minúsculas, sem acento, com hífens.
    const slug = name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    try {
      await api.createForumCategory({ slug, name, description: description || undefined, order: categories.length });
      setName("");
      setDescription("");
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function rename(category: ForumCategory) {
    const next = window.prompt("Novo nome da categoria:", category.name);
    if (!next || next.trim() === category.name) return;
    try {
      await api.updateForumCategory(category.id, { name: next.trim() });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2.5">{error}</p>}
      <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {categories.map((c) => (
          <li key={c.id} className="px-5 py-3 flex items-center justify-between gap-4 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{c.name}</p>
              <p className="text-xs text-gray-400 truncate">
                {c.description ?? "Sem descrição"} · {c.thread_count} tópico(s)
              </p>
            </div>
            <button onClick={() => rename(c)} className="text-xs text-indigo-600 font-medium hover:underline shrink-0">Renomear</button>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-sm">Nova categoria</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome"
            aria-label="Nome da categoria"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descrição (opcional)"
            aria-label="Descrição da categoria"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex justify-end">
          <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
            Criar categoria
          </button>
        </div>
      </form>
    </div>
  );
}
