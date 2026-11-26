import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { KnowledgeItem } from "../types";
import { Badge } from "../components/Badge";
import { ScoreBadge } from "../components/ScoreBadge";
import { KNOWLEDGE_STATUS_LABELS, KNOWLEDGE_TYPE_LABELS } from "../lib/format";
import { IconAlert, IconPaperclip } from "../components/icons";

const PAGE_SIZE = 12;

export function Catalogo() {
  // Links antigos (/catalogo?item=…) abrem a página do item.
  const [searchParams] = useSearchParams();
  const legacyItemId = searchParams.get("item");

  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const filters = { type: typeFilter || undefined, status: statusFilter || undefined, q: q || undefined };

  function load() {
    setLoading(true);
    api
      .getKnowledge({ ...filters, limit: Math.max(PAGE_SIZE, Math.min(items.length, 100)), offset: 0 })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .finally(() => setLoading(false));
  }

  // debounce da busca por texto; filtros recarregam na hora
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter, q]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await api.getKnowledge({ ...filters, limit: PAGE_SIZE, offset: items.length });
      setItems((prev) => [...prev, ...res.items]);
      setTotal(res.total);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await api.syncGitlab();
      if (result.synced) {
        setSyncMsg(`Sincronizado: ${result.created} novos, ${result.updated} atualizados de ${result.projectsFound} projetos do GitLab.`);
        load();
      } else {
        setSyncMsg(result.reason);
      }
    } catch (e: any) {
      setSyncMsg(`Erro: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }


  const chip = (active: boolean) =>
    `px-3 py-1.5 text-xs font-medium rounded-full border ${
      active ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200"
    }`;

  if (legacyItemId) return <Navigate to={`/catalogo/${legacyItemId}`} replace />;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Catálogo de Conhecimento</h1>
          <p className="text-gray-500 text-sm mt-1">
            Agentes de IA, chatbots, instructions, árvores de diálogo, integrações e infraestrutura. Fonte primária: GitLab.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-3.5 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shrink-0"
        >
          {syncing ? "Sincronizando…" : "Sincronizar com o GitLab"}
        </button>
      </header>

      {syncMsg && <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3">{syncMsg}</div>}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, descrição ou tag…"
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-72 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button onClick={() => setTypeFilter("")} className={chip(typeFilter === "")}>Todos os tipos</button>
          {Object.entries(KNOWLEDGE_TYPE_LABELS).map(([value, label]) => (
            <button key={value} onClick={() => setTypeFilter(value)} className={chip(typeFilter === value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-400">Ciclo de vida:</span>
          <button onClick={() => setStatusFilter("")} className={chip(statusFilter === "")}>Todos</button>
          {Object.entries(KNOWLEDGE_STATUS_LABELS).map(([value, label]) => (
            <button key={value} onClick={() => setStatusFilter(value)} className={chip(statusFilter === value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400">Carregando…</div>
      ) : items.length === 0 ? (
        <div className="text-gray-400 text-sm">Nenhum item encontrado.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.map((item) => (
              <Link
                key={item.id}
                to={`/catalogo/${item.id}`}
                className="text-left bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2 hover:border-indigo-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-sm">{item.name}</h3>
                  <Badge value={item.status} label={KNOWLEDGE_STATUS_LABELS[item.status] ?? item.status} />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-indigo-600">{KNOWLEDGE_TYPE_LABELS[item.type] ?? item.type}</span>
                  <ScoreBadge scorecard={item.scorecard} />
                  {item.scorecard.stale && (
                    <span className="text-[11px] text-amber-800" title="Sem revisão ou sincronização nos últimos 180 dias">
                      <IconAlert className="inline h-3 w-3 -mt-0.5 mr-1" />
                      {item.scorecard.daysSinceReview === null ? "nunca revisado" : `revisado há ${item.scorecard.daysSinceReview} dias`}
                    </span>
                  )}
                </div>
                {item.description && <p className="text-sm text-gray-500">{item.description}</p>}
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {item.tags.map((t) => (
                    <span key={t} className="text-[11px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">#{t}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 text-xs text-gray-400 w-full">
                  <span>
                    {item.owner_team ?? (
                      <>
                        <IconAlert className="inline h-3.5 w-3.5 -mt-0.5 mr-1" />
                        Sem time definido
                      </>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    {item.attachments_count ? (
                      <span className="inline-flex items-center gap-1 text-indigo-600" title="Documentação e anexos">
                        <IconPaperclip className="h-3.5 w-3.5" />
                        {item.attachments_count}
                      </span>
                    ) : null}
                    <span>
                      {item.depends_on_count ? `depende de ${item.depends_on_count}` : ""}
                      {item.depends_on_count && item.dependents_count ? " · " : ""}
                      {item.dependents_count ? `usado por ${item.dependents_count}` : ""}
                    </span>
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <div className="flex items-center justify-between text-xs text-gray-400 pt-1">
            <span>{items.length} de {total}</span>
            {items.length < total && (
              <button onClick={loadMore} disabled={loadingMore} className="text-indigo-600 font-medium hover:underline disabled:opacity-50">
                {loadingMore ? "Carregando…" : "Carregar mais"}
              </button>
            )}
          </div>
        </>
      )}

    </div>
  );
}
