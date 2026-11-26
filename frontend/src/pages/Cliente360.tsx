import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { Client360, ClickupTask, ForumThread } from "../types";
import { Badge } from "../components/Badge";
import { HealthTrend } from "../components/HealthTrend";
import { Modal } from "../components/Modal";
import { ProgressBar } from "../components/ProgressBar";
import { formatDay } from "../lib/format";
import { IconAlert } from "../components/icons";

const TASKS_PAGE_SIZE = 20;
const SEVERITY_LABELS: Record<string, string> = { baixa: "Baixa", media: "Média", alta: "Alta", critica: "Crítica" };

export function Cliente360Page() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<Client360 | null>(null);
  const [tasks, setTasks] = useState<ClickupTask[]>([]);
  const [tasksTotal, setTasksTotal] = useState(0);
  const [loadingMoreTasks, setLoadingMoreTasks] = useState(false);
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"alert" | "document" | null>(null);

  // Quem cuida da relação com o cliente pode abrir/resolver alertas e anexar documentos.
  const canEdit = !!user && ["admin", "analista_ativacao", "analista_suporte"].includes(user.role);

  function load(showSpinner = true) {
    if (!id) return;
    if (showSpinner) setLoading(true);
    api
      .getClient360(id)
      .then((res) => {
        setData(res);
        setTasks(res.clickupTasks);
        setTasksTotal(res.clickupTasksTotal);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    api
      .getForumThreads({ clientId: id })
      .then((res) => setThreads(res.items))
      .catch(() => undefined);
  }

  useEffect(load, [id]);

  async function loadMoreTasks() {
    if (!id) return;
    setLoadingMoreTasks(true);
    try {
      const res = await api.getClientClickupTasks(id, { limit: TASKS_PAGE_SIZE, offset: tasks.length });
      setTasks((prev) => [...prev, ...res.items]);
      setTasksTotal(res.total);
    } finally {
      setLoadingMoreTasks(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await api.syncClickup();
      setSyncMsg(result.synced ? `${result.tasksSynced} tasks sincronizadas.` : result.reason);
      load(false);
    } catch (e: any) {
      setSyncMsg(`Erro: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function resolveAlert(alertId: string) {
    if (!id) return;
    setError(null);
    try {
      await api.resolveClientAlert(id, alertId);
      load(false);
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Carregando…</div>;
  if (!data) return <div className="p-8 text-gray-400">{error ?? "Cliente não encontrado."}</div>;

  const { client, documents, alerts, metrics, activationProjects, healthHistory } = data;
  const openAlerts = alerts.filter((a) => !a.resolved);
  const breakdown = client.health_breakdown;
  const totalPenalty = breakdown?.components.reduce((sum, c) => sum + c.penalty, 0) ?? 0;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <Link to="/clientes" className="text-xs text-indigo-600 hover:underline">← Todos os clientes</Link>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{client.name}</h1>
            <Badge value={client.status} />
          </div>
          <p className="text-gray-500 text-sm mt-1">
            {client.segment ?? "Segmento não informado"} · CSM: {client.csm_owner ?? "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">Health score</p>
          <p className="text-3xl font-semibold">{client.health_score ?? "—"}</p>
          {client.health_score != null && client.health_score < 70 && (
            <p className="text-xs text-rose-700 font-medium flex items-center gap-1">
              <IconAlert className="h-3.5 w-3.5" /> Cliente em risco
            </p>
          )}
        </div>
      </header>

      {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2.5">{error}</p>}

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm">Alertas abertos</h2>
          {canEdit && (
            <button onClick={() => setModal("alert")} className="text-xs font-medium text-indigo-600 hover:underline">
              + Abrir alerta
            </button>
          )}
        </div>
        {openAlerts.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum alerta aberto.</p>
        ) : (
          <ul className="space-y-2">
            {openAlerts.map((a) => {
              const automatic = a.source?.startsWith("Cálculo automático");
              return (
                <li key={a.id} className="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2.5 text-sm">
                  <Badge value={a.severity} label={SEVERITY_LABELS[a.severity] ?? a.severity} />
                  <span className="text-rose-900 min-w-0">{a.message}</span>
                  <span className="ml-auto flex items-center gap-3 shrink-0 text-xs">
                    {a.source && <span className="text-rose-700/70">{a.source}</span>}
                    {automatic ? (
                      <span className="text-rose-700/70" title="Alertas automáticos se resolvem sozinhos quando a causa deixa de existir">
                        resolve sozinho
                      </span>
                    ) : (
                      canEdit && (
                        <button onClick={() => resolveAlert(a.id)} className="font-medium text-rose-800 hover:underline">
                          Resolver
                        </button>
                      )
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <section className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-sm mb-3">Evolução do health score (90 dias)</h2>
          <HealthTrend points={healthHistory} />
        </section>

        <section className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-sm mb-1">Por que {client.health_score ?? "esse score"}?</h2>
          <p className="text-xs text-gray-500 mb-4">O score parte de 100 e cada sinal abaixo desconta pontos, até um teto.</p>
          {!breakdown ? (
            <p className="text-sm text-gray-400">Ainda não calculado.</p>
          ) : (
            <>
              <ul className="space-y-3">
                {breakdown.components.map((c) => (
                  <li key={c.key}>
                    <div className="flex items-center justify-between text-sm gap-2">
                      <span className="text-gray-700">
                        {c.label} <span className="text-gray-400">({c.count})</span>
                      </span>
                      <span className={`font-semibold tabular-nums ${c.penalty > 0 ? "text-gray-900" : "text-gray-400"}`}>
                        {c.penalty > 0 ? `−${c.penalty}` : "0"}
                      </span>
                    </div>
                    {/* Barra: quanto do teto de desconto deste sinal já foi usado. */}
                    <div
                      className="mt-1 h-1.5 rounded-full bg-indigo-100 overflow-hidden"
                      title={`${c.penalty} de no máximo ${c.maxPenalty} pontos`}
                    >
                      <div className="h-1.5 rounded-full bg-indigo-600" style={{ width: `${(c.penalty / c.maxPenalty) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-500 mt-4 pt-3 border-t border-gray-100">
                100 − {totalPenalty} = <b className="text-gray-800">{client.health_score}</b>
              </p>
            </>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-sm">Tasks do ClickUp</h2>
            <button onClick={handleSync} disabled={syncing} className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50">
              {syncing ? "Sincronizando…" : "Sincronizar agora"}
            </button>
          </div>
          {syncMsg && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">{syncMsg}</p>}
          {tasks.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhuma task sincronizada ainda.</p>
          ) : (
            <>
              <ul className="divide-y divide-gray-100">
                {tasks.map((t) => (
                  <li key={t.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <a href={t.url ?? "#"} target="_blank" rel="noreferrer" className="font-medium hover:text-indigo-600 truncate block">
                        {t.name}
                      </a>
                      <p className="text-xs text-gray-400">
                        {t.list_name}
                        {t.assignee ? ` · ${t.assignee}` : ""}
                        {t.due_date ? ` · prazo ${formatDay(t.due_date)}` : ""}
                      </p>
                    </div>
                    <Badge value={t.status} label={t.status} />
                  </li>
                ))}
              </ul>
              {tasks.length < tasksTotal && (
                <div className="flex justify-center pt-3">
                  <button onClick={loadMoreTasks} disabled={loadingMoreTasks} className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50">
                    {loadingMoreTasks ? "Carregando…" : `Carregar mais (${tasks.length} de ${tasksTotal})`}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-sm mb-4">Métricas</h2>
          {metrics.length === 0 ? (
            <p className="text-sm text-gray-400">Sem métricas registradas.</p>
          ) : (
            <ul className="space-y-3">
              {metrics.map((m) => (
                <li key={m.id} className="flex items-center justify-between text-sm gap-2">
                  <span className="text-gray-500">
                    {m.metric_key.replace(/_/g, " ")} <span className="text-gray-400 text-xs">({m.period})</span>
                  </span>
                  <span className="font-semibold">
                    {m.value}
                    {m.unit ? ` ${m.unit}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-sm mb-4">Projetos de Ativação</h2>
        {activationProjects.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum projeto de ativação para este cliente.</p>
        ) : (
          <div className="space-y-4">
            {activationProjects.map((p) => (
              <div key={p.id}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <Link to={`/ativacao?projeto=${p.id}`} className="font-medium hover:text-indigo-600">
                    {p.name}
                  </Link>
                  <span className="text-xs text-gray-400">
                    {p.target_date ? `prazo ${formatDay(p.target_date)} · ` : ""}
                    {p.progressPct}%
                  </span>
                </div>
                <ProgressBar pct={p.progressPct} size="sm" />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm">Fórum — notas e discussões sobre este cliente</h2>
          <Link to="/forum" className="text-xs font-medium text-indigo-600 hover:underline">ver fórum →</Link>
        </div>
        {threads.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum tópico do fórum vinculado a este cliente ainda.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {threads.map((t) => (
              <li key={t.id} className="py-2.5 text-sm">
                <Link to={`/forum/${t.id}`} className="font-medium hover:text-indigo-600">{t.title}</Link>
                <p className="text-xs text-gray-400">
                  {t.author_name} · {t.reply_count} resposta(s)
                  {t.accepted_reply_id ? " · ✓ resolvido" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm">Documentação</h2>
          {canEdit && (
            <button onClick={() => setModal("document")} className="text-xs font-medium text-indigo-600 hover:underline">
              + Adicionar documento
            </button>
          )}
        </div>
        {documents.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum documento associado.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {documents.map((d) => (
              <li key={d.id} className="py-2 flex items-center justify-between text-sm gap-3">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="hover:text-indigo-600 truncate">
                    {d.title} ↗
                  </a>
                ) : (
                  <span className="truncate">{d.title}</span>
                )}
                <span className="text-xs text-gray-400 shrink-0">
                  {d.source}
                  {d.category ? ` · ${d.category}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {modal === "alert" && id && (
        <AlertModal
          clientId={id}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load(false);
          }}
        />
      )}
      {modal === "document" && id && (
        <DocumentModal
          clientId={id}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load(false);
          }}
        />
      )}
    </div>
  );
}

const INPUT = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

function AlertModal({ clientId, onClose, onSaved }: { clientId: string; onClose: () => void; onSaved: () => void }) {
  const [severity, setSeverity] = useState("media");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createClientAlert(clientId, { severity, message });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Abrir alerta" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs text-gray-500">
          Alertas manuais pesam no health score do cliente até serem resolvidos. Os de severidade alta ou crítica notificam o time.
        </p>
        <label className="block text-xs font-medium text-gray-600">
          Severidade
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={INPUT}>
            {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-gray-600">
          O que está acontecendo
          <textarea required rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} className={INPUT} />
        </label>
        {error && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Salvando…" : "Abrir alerta"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DocumentModal({ clientId, onClose, onSaved }: { clientId: string; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createClientDocument(clientId, { title, url: url || undefined, category: category || undefined });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Adicionar documento" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-xs font-medium text-gray-600">
          Título
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} />
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Link (opcional)
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={INPUT} />
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Categoria (opcional)
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex.: contrato, ata, manual técnico" className={INPUT} />
        </label>
        {error && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Salvando…" : "Adicionar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
