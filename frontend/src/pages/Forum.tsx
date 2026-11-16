import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { Client, ForumCategory, ForumThread, KnowledgeItem } from "../types";
import { ROLE_LABELS } from "../types";
import { timeAgo } from "../lib/format";

const PAGE_SIZE = 15;

export function ForumPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = searchParams.get("categoria") ?? "";

  const [categories, setCategories] = useState<ForumCategory[]>([]);
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showNewThread, setShowNewThread] = useState(false);
  const [q, setQ] = useState("");

  function load() {
    setLoading(true);
    Promise.all([
      api.getForumCategories(),
      api.getForumThreads({ category: activeCategory || undefined, q: q || undefined, limit: PAGE_SIZE, offset: 0 }),
    ])
      .then(([cats, ts]) => {
        setCategories(cats);
        setThreads(ts.items);
        setTotal(ts.total);
      })
      .finally(() => setLoading(false));
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const ts = await api.getForumThreads({ category: activeCategory || undefined, q: q || undefined, limit: PAGE_SIZE, offset: threads.length });
      setThreads((prev) => [...prev, ...ts.items]);
      setTotal(ts.total);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, q]);

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Fórum</h1>
          <p className="text-gray-500 text-sm mt-1">
            Feedback, notas e discussões do time sobre a plataforma, clientes e funcionalidades.
          </p>
        </div>
        {user ? (
          <button
            onClick={() => setShowNewThread(true)}
            className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700"
          >
            + Novo tópico
          </button>
        ) : (
          <Link to="/login" className="text-sm text-indigo-600 hover:underline">Entre para participar →</Link>
        )}
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar nos tópicos…"
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-56 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={() => setSearchParams({})}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
            !activeCategory ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
          }`}
        >
          Todos
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setSearchParams({ categoria: c.slug })}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              activeCategory === c.slug ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}
            title={c.description ?? undefined}
          >
            {c.name} <span className="opacity-60">· {c.thread_count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Carregando…</p>
      ) : threads.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhum tópico ainda{activeCategory ? " nessa categoria" : ""}.</p>
      ) : (
        <ul className="divide-y divide-gray-100 bg-white rounded-xl border border-gray-200">
          {threads.map((t) => (
            <li key={t.id}>
              <Link to={`/forum/${t.id}`} className="flex items-start justify-between gap-4 px-5 py-4 hover:bg-gray-50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {t.pinned && <span className="text-xs">📌</span>}
                    <span className="font-medium text-sm truncate">{t.title}</span>
                    {t.accepted_reply_id && (
                      <span className="text-[11px] text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">✓ Resolvido</span>
                    )}
                    <span className="text-[11px] text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{t.category_name}</span>
                    {t.client_name && (
                      <span className="text-[11px] text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5">{t.client_name}</span>
                    )}
                    {t.knowledge_item_name && (
                      <span className="text-[11px] text-violet-600 bg-violet-50 rounded-full px-2 py-0.5">{t.knowledge_item_name}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {t.author_name} · {ROLE_LABELS[t.author_role]} · {timeAgo(t.created_at)}
                  </p>
                </div>
                <div className="text-xs text-gray-400 shrink-0 whitespace-nowrap">{t.reply_count} resposta(s)</div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {threads.length > 0 && threads.length < total && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50"
          >
            {loadingMore ? "Carregando…" : `Carregar mais (${threads.length} de ${total})`}
          </button>
        </div>
      )}

      {showNewThread && (
        <NewThreadModal
          categories={categories}
          defaultCategoryId={categories.find((c) => c.slug === activeCategory)?.id}
          onClose={() => setShowNewThread(false)}
          onCreated={() => {
            setShowNewThread(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function NewThreadModal({
  categories,
  defaultCategoryId,
  onClose,
  onCreated,
}: {
  categories: ForumCategory[];
  defaultCategoryId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? categories[0]?.id ?? "");
  const [clientId, setClientId] = useState("");
  const [knowledgeItemId, setKnowledgeItemId] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getClients({ limit: 100, sort: "name" }).then((res) => setClients(res.items));
    api.getKnowledge({ limit: 100 }).then((res) => setKnowledgeItems(res.items));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!categoryId) {
      setError("Escolha uma categoria");
      return;
    }
    setLoading(true);
    try {
      await api.createForumThread({
        title,
        body,
        categoryId,
        clientId: clientId || undefined,
        knowledgeItemId: knowledgeItemId || undefined,
      });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl border border-gray-200 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-lg mb-4">Novo tópico</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Título</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Mensagem</label>
            <textarea
              required
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Categoria</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Cliente (opcional)</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">—</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Item do catálogo (opcional)</label>
              <select
                value={knowledgeItemId}
                onChange={(e) => setKnowledgeItemId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">—</option>
                {knowledgeItems.map((k) => (
                  <option key={k.id} value={k.id}>{k.name}</option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "Publicando…" : "Publicar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
