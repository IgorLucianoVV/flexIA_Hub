import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { KnowledgeDetail, KnowledgeItem } from "../types";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { ScoreBadge } from "../components/ScoreBadge";
import { KNOWLEDGE_STATUS_LABELS, KNOWLEDGE_TYPE_LABELS, formatDay } from "../lib/format";
import { IconAlert } from "../components/icons";

const PAGE_SIZE = 12;

export function Catalogo() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const openItemId = searchParams.get("item");

  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const canEdit = user?.role === "admin" || user?.role === "dev";
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

  function openItem(id: string | null) {
    setSearchParams(id ? { item: id } : {}, { replace: true });
  }

  const chip = (active: boolean) =>
    `px-3 py-1.5 text-xs font-medium rounded-full border ${
      active ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200"
    }`;

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
              <button
                key={item.id}
                onClick={() => openItem(item.id)}
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
                  <span>
                    {item.depends_on_count ? `depende de ${item.depends_on_count}` : ""}
                    {item.depends_on_count && item.dependents_count ? " · " : ""}
                    {item.dependents_count ? `usado por ${item.dependents_count}` : ""}
                  </span>
                </div>
              </button>
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

      {openItemId && (
        <ItemDetailModal
          itemId={openItemId}
          canEdit={canEdit}
          onClose={() => openItem(null)}
          onOpenItem={openItem}
          onChanged={load}
        />
      )}
    </div>
  );
}

const INPUT = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

function ItemDetailModal({
  itemId,
  canEdit,
  onClose,
  onOpenItem,
  onChanged,
}: {
  itemId: string;
  canEdit: boolean;
  onClose: () => void;
  onOpenItem: (id: string) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [candidates, setCandidates] = useState<KnowledgeItem[]>([]);
  const [newDependency, setNewDependency] = useState("");

  const load = useCallback(() => {
    api
      .getKnowledgeItem(itemId)
      .then(setDetail)
      .catch((err) => setError(err.message));
  }, [itemId]);

  useEffect(() => {
    setDetail(null);
    setEditing(false);
    setError(null);
    load();
  }, [load]);

  useEffect(() => {
    if (canEdit) api.getKnowledge({ limit: 100 }).then((res) => setCandidates(res.items));
  }, [canEdit]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      load();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (!detail) {
    return (
      <Modal title="Item do catálogo" onClose={onClose} width="lg">
        <p className="text-sm text-gray-400">{error ?? "Carregando…"}</p>
      </Modal>
    );
  }

  const { item, dependsOn, dependents, threads } = detail;
  const linkedIds = new Set([item.id, ...dependsOn.map((d) => d.id)]);

  return (
    <Modal title={item.name} onClose={onClose} width="xl">
      <div className="space-y-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-indigo-600">{KNOWLEDGE_TYPE_LABELS[item.type] ?? item.type}</span>
          <Badge value={item.status} label={KNOWLEDGE_STATUS_LABELS[item.status] ?? item.status} />
          <ScoreBadge scorecard={item.scorecard} />
          {item.client_name && item.client_id && (
            <Link to={`/clientes/${item.client_id}`} className="text-[11px] text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5 hover:underline">
              {item.client_name}
            </Link>
          )}
          {item.gitlab_web_url && (
            <a href={item.gitlab_web_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline ml-auto">
              Ver no GitLab ↗
            </a>
          )}
        </div>

        {error && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

        {item.status === "deprecado" && (
          <div className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-gray-700">
            <b>Item descontinuado.</b> {item.deprecation_note}
            {item.replaced_by_id && item.replaced_by_name && (
              <>
                {" "}
                Substituído por{" "}
                <button onClick={() => onOpenItem(item.replaced_by_id!)} className="text-indigo-600 hover:underline font-medium">
                  {item.replaced_by_name}
                </button>
                .
              </>
            )}
          </div>
        )}

        {editing ? (
          <EditForm
            item={item}
            candidates={candidates.filter((c) => c.id !== item.id)}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              load();
              onChanged();
            }}
          />
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-700">{item.description ?? <span className="text-gray-400">Sem descrição.</span>}</p>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((t) => (
                <span key={t} className="text-[11px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">#{t}</span>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              Time responsável: <b className="text-gray-700">{item.owner_team ?? "não definido"}</b> · Última revisão:{" "}
              <b className="text-gray-700">{item.last_reviewed_at ? formatDay(item.last_reviewed_at) : "nunca"}</b>
              {item.last_synced_at ? ` · Último sync com o GitLab: ${formatDay(item.last_synced_at)}` : ""}
            </p>
            {canEdit && (
              <div className="flex gap-3 pt-1">
                <button onClick={() => setEditing(true)} className="text-xs font-medium text-indigo-600 hover:underline">
                  Editar dados e ciclo de vida
                </button>
                <button onClick={() => run(() => api.reviewKnowledgeItem(item.id))} className="text-xs font-medium text-indigo-600 hover:underline">
                  ✓ Marcar como revisado hoje
                </button>
              </div>
            )}
          </div>
        )}

        <section>
          <h3 className="text-sm font-semibold mb-1">Governança — {item.scorecard.score}%</h3>
          <p className="text-xs text-gray-500 mb-3">
            {item.scorecard.passed} de {item.scorecard.total} verificações atendidas. Ouro exige todas.
          </p>
          <ul className="space-y-1.5">
            {item.scorecard.checks.map((check) => (
              <li key={check.key} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 ${check.passed ? "text-emerald-600" : "text-gray-400"}`} aria-hidden="true">
                  {check.passed ? "✓" : "○"}
                </span>
                <span>
                  <span className={check.passed ? "text-gray-700" : "text-gray-900 font-medium"}>{check.label}</span>
                  <span className="sr-only">{check.passed ? " — atendida" : " — pendente"}</span>
                  {check.hint && <span className="block text-xs text-gray-500">{check.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <section>
            <h3 className="text-sm font-semibold mb-2">Depende de</h3>
            {dependsOn.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhuma dependência registrada.</p>
            ) : (
              <ul className="space-y-1.5">
                {dependsOn.map((d) => (
                  <li key={d.relation_id} className="flex items-center justify-between gap-2 text-sm">
                    <button onClick={() => onOpenItem(d.id)} className="text-left hover:text-indigo-600 truncate">
                      {d.name}
                      {d.status === "deprecado" && <span className="text-amber-800 text-xs">
                          {" "}
                          <IconAlert className="inline h-3.5 w-3.5 -mt-0.5 mr-1" />
                          descontinuado
                        </span>}
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => run(() => api.removeKnowledgeRelation(item.id, d.relation_id))}
                        aria-label={`Remover dependência de ${d.name}`}
                        className="text-xs text-gray-400 hover:text-rose-600 shrink-0"
                      >
                        remover
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <form
                className="flex gap-2 mt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newDependency) run(() => api.addKnowledgeRelation(item.id, newDependency)).then(() => setNewDependency(""));
                }}
              >
                <select
                  value={newDependency}
                  onChange={(e) => setNewDependency(e.target.value)}
                  aria-label="Adicionar dependência"
                  className="flex-1 min-w-0 rounded-lg border border-gray-300 px-2 py-1.5 text-xs bg-white"
                >
                  <option value="">Adicionar dependência…</option>
                  {candidates
                    .filter((c) => !linkedIds.has(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                <button type="submit" disabled={!newDependency} className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white font-medium disabled:opacity-50">
                  Adicionar
                </button>
              </form>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-2">Usado por</h3>
            {dependents.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhum item depende deste.</p>
            ) : (
              <ul className="space-y-1.5">
                {dependents.map((d) => (
                  <li key={d.relation_id} className="text-sm">
                    <button onClick={() => onOpenItem(d.id)} className="text-left hover:text-indigo-600">{d.name}</button>
                  </li>
                ))}
              </ul>
            )}
            {item.status === "deprecado" && dependents.length > 0 && (
              <p className="text-xs text-amber-800 mt-2">
                <IconAlert className="inline h-3.5 w-3.5 -mt-0.5 mr-1" />
                Estes itens ainda dependem de um item descontinuado.</p>
            )}
          </section>
        </div>

        {threads.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold mb-2">Discussões no fórum</h3>
            <ul className="space-y-1.5">
              {threads.map((t) => (
                <li key={t.id} className="text-sm">
                  <Link to={`/forum/${t.id}`} className="hover:text-indigo-600">{t.title}</Link>
                  <span className="text-xs text-gray-400"> · {t.reply_count} resposta(s)</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}

function EditForm({
  item,
  candidates,
  onCancel,
  onSaved,
}: {
  item: KnowledgeDetail["item"];
  candidates: KnowledgeItem[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(item.description ?? "");
  const [ownerTeam, setOwnerTeam] = useState(item.owner_team ?? "");
  const [tags, setTags] = useState(item.tags.join(", "));
  const [gitlabWebUrl, setGitlabWebUrl] = useState(item.gitlab_web_url ?? "");
  const [status, setStatus] = useState(item.status);
  const [deprecationNote, setDeprecationNote] = useState(item.deprecation_note ?? "");
  const [replacedById, setReplacedById] = useState(item.replaced_by_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.updateKnowledgeItem(item.id, {
        description: description.trim() || null,
        ownerTeam: ownerTeam.trim() || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        gitlabWebUrl: gitlabWebUrl.trim() || null,
        status,
        deprecationNote: status === "deprecado" ? deprecationNote.trim() || null : null,
        replacedById: status === "deprecado" ? replacedById || null : null,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
      <label className="block text-xs font-medium text-gray-600">
        Descrição
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-gray-600">
          Time responsável
          <input value={ownerTeam} onChange={(e) => setOwnerTeam(e.target.value)} className={INPUT} />
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Tags (separadas por vírgula)
          <input value={tags} onChange={(e) => setTags(e.target.value)} className={INPUT} />
        </label>
      </div>
      <label className="block text-xs font-medium text-gray-600">
        Link do repositório no GitLab
        <input type="url" value={gitlabWebUrl} onChange={(e) => setGitlabWebUrl(e.target.value)} placeholder="https://gitlab.com/…" className={INPUT} />
      </label>
      <label className="block text-xs font-medium text-gray-600">
        Ciclo de vida
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT}>
          {Object.entries(KNOWLEDGE_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      {status === "deprecado" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-gray-600">
            Motivo da descontinuação
            <input value={deprecationNote} onChange={(e) => setDeprecationNote(e.target.value)} className={INPUT} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Substituído por
            <select value={replacedById} onChange={(e) => setReplacedById(e.target.value)} className={INPUT}>
              <option value="">—</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm rounded-lg text-gray-600 hover:bg-white">Cancelar</button>
        <button type="submit" disabled={saving} className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}
