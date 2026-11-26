import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { ActivationProject, ActivationTemplate, Client } from "../types";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { ProgressBar } from "../components/ProgressBar";
import { dueLabel, formatDay } from "../lib/format";
import { IconAlert, IconChevronDown } from "../components/icons";

const PAGE_SIZE = 10;
const STATUS_FILTERS = [
  { value: "", label: "Todos" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "atrasado", label: "Atrasados" },
  { value: "planejado", label: "Planejados" },
  { value: "concluido", label: "Concluídos" },
];

export function Ativacao() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("projeto");

  const [projects, setProjects] = useState<ActivationProject[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(focusId ? [focusId] : []));
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const focusRef = useRef<HTMLDivElement>(null);

  const canPlan = user?.role === "admin" || user?.role === "analista_ativacao";
  const canExecute = canPlan || user?.role === "dev";

  const filters = { status: statusFilter || undefined, q: q || undefined };

  function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    // Recarrega tudo que já estava na tela (não só a primeira página), para o "carregar mais"
    // não ser desfeito a cada artefato marcado.
    const limit = Math.max(PAGE_SIZE, Math.min(projects.length, 100));
    api
      .getActivationProjects({ ...filters, limit, offset: 0 })
      .then((res) => {
        setProjects(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const timer = setTimeout(() => load(), q ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, q]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await api.getActivationProjects({ ...filters, limit: PAGE_SIZE, offset: projects.length });
      setProjects((prev) => [...prev, ...res.items]);
      setTotal(res.total);
    } finally {
      setLoadingMore(false);
    }
  }

  // Link direto (?projeto=id, vindo da busca, do painel ou do assistente): se o projeto não
  // está na página carregada, busca as próximas até encontrá-lo, e rola até ele.
  useEffect(() => {
    if (!focusId || loading || loadingMore) return;
    if (projects.some((p) => p.id === focusId)) {
      focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (projects.length < total && projects.length < 100) {
      loadMore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, loading, loadingMore, projects.length]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function toggleArtifact(artifactId: string, currentStatus: string) {
    setError(null);
    try {
      await api.updateArtifactStatus(artifactId, currentStatus === "concluido" ? "pendente" : "concluido");
      load(false);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function deleteProject(project: ActivationProject) {
    if (!window.confirm(`Apagar o projeto "${project.name}" com todas as fases e artefatos? Essa ação não pode ser desfeita.`)) return;
    setError(null);
    try {
      await api.deleteActivationProject(project.id);
      load(false);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Gestão de Projetos — Ativação</h1>
          <p className="text-gray-500 text-sm mt-1">
            Projetos listados por cliente, com as fases e artefatos de cada um e a barra de progresso do que já foi entregue.
          </p>
        </div>
        {canPlan && (
          <button
            onClick={() => setShowNew(true)}
            className="px-3.5 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shrink-0"
          >
            + Novo projeto
          </button>
        )}
      </header>

      {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2.5">{error}</p>}

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por projeto ou cliente…"
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-64 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border ${
              statusFilter === s.value ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-400">Carregando…</div>
      ) : projects.length === 0 ? (
        <div className="text-gray-400 text-sm">Nenhum projeto encontrado.</div>
      ) : (
        // Projetos empilhados verticalmente, um abaixo do outro
        <div className="flex flex-col gap-4">
          {projects.map((project) => {
            const isOpen = expanded.has(project.id);
            return (
              <div
                key={project.id}
                ref={project.id === focusId ? focusRef : undefined}
                className={`bg-white rounded-xl border overflow-hidden ${
                  project.id === focusId ? "border-indigo-400 ring-2 ring-indigo-100" : "border-gray-200"
                }`}
              >
                <button onClick={() => toggle(project.id)} aria-expanded={isOpen} className="w-full text-left p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium text-indigo-600">{project.client_name}</p>
                      <h3 className="font-semibold">{project.name}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {project.owner_name ? `Responsável: ${project.owner_name} · ` : ""}
                        {project.target_date ? `Prazo: ${formatDay(project.target_date)}` : "Sem prazo definido"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {project.is_overdue && project.status !== "atrasado" && <Badge value="atrasado" label="prazo vencido" alert />}
                      <Badge value={project.status} />
                      <IconChevronDown className={`h-4 w-4 text-gray-300 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>
                        {project.doneArtifacts} de {project.totalArtifacts} artefatos entregues
                        {project.overdueArtifacts ? (
                          <span className="text-rose-700 font-medium">
                            {" · "}
                            <IconAlert className="inline h-3.5 w-3.5 -mt-0.5 mr-1" />
                            {project.overdueArtifacts} vencido(s)
                          </span>
                        ) : null}
                      </span>
                      <span className="font-semibold text-gray-700">
                        {project.progressPct}% entregue · {100 - project.progressPct}% restante
                      </span>
                    </div>
                    <ProgressBar pct={project.progressPct} />
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 divide-y divide-gray-100">
                    {project.phases.length === 0 && (
                      <p className="p-5 text-sm text-gray-400">Projeto sem fases. Crie a partir de um template para já nascer com fases e artefatos.</p>
                    )}
                    {project.phases.map((phase) => (
                      <div key={phase.id} className="p-5">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold">{phase.name}</h4>
                          <span className="text-xs text-gray-400">{phase.progressPct}%</span>
                        </div>
                        <ProgressBar pct={phase.progressPct} size="sm" />
                        <ul className="mt-3 space-y-1.5">
                          {phase.artifacts.map((art) => (
                            <li key={art.id} className="flex items-center gap-2.5 text-sm">
                              <input
                                type="checkbox"
                                checked={art.status === "concluido"}
                                disabled={!canExecute}
                                onChange={() => toggleArtifact(art.id, art.status)}
                                aria-label={`Marcar "${art.name}" como ${art.status === "concluido" ? "pendente" : "concluído"}`}
                                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                              />
                              <span className={art.status === "concluido" ? "line-through text-gray-400" : "text-gray-700"}>{art.name}</span>
                              <span className="ml-auto flex items-center gap-3 text-xs text-gray-400 shrink-0">
                                {art.due_date && art.status !== "concluido" && (
                                  <span className={art.is_overdue ? "text-rose-700 font-medium" : ""} title={formatDay(art.due_date)}>
                                    {art.is_overdue && <IconAlert className="inline h-3.5 w-3.5 -mt-0.5 mr-1" />}
                                    {dueLabel(art.due_date)}
                                  </span>
                                )}
                                {art.responsible && <span>{art.responsible}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {canPlan && (
                      <div className="px-5 py-3 flex justify-end">
                        <button onClick={() => deleteProject(project)} className="text-xs text-gray-400 hover:text-rose-600">
                          Apagar projeto
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>
            {projects.length} de {total}
          </span>
          {projects.length < total && (
            <button onClick={loadMore} disabled={loadingMore} className="text-indigo-600 font-medium hover:underline disabled:opacity-50">
              {loadingMore ? "Carregando…" : "Carregar mais"}
            </button>
          )}
        </div>
      )}

      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            load(false);
          }}
        />
      )}
    </div>
  );
}

const INPUT = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [templates, setTemplates] = useState<ActivationTemplate[]>([]);
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getClients({ limit: 100, sort: "name" }).then((res) => setClients(res.items));
    api.getActivationTemplates().then((list) => {
      setTemplates(list);
      if (list[0]) setTemplateId(list[0].id);
    });
  }, []);

  const template = templates.find((t) => t.id === templateId);
  const artifactCount = template?.phases.reduce((sum, ph) => sum + ph.artifacts.length, 0) ?? 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createActivationProject({
        name,
        clientId,
        templateId: templateId || undefined,
        ownerName: ownerName || undefined,
        startDate: startDate || undefined,
      });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Novo projeto de ativação" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-xs font-medium text-gray-600">
          Cliente
          <select required value={clientId} onChange={(e) => setClientId(e.target.value)} className={INPUT}>
            <option value="">Selecione…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Nome do projeto
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Ativação — Novo canal WhatsApp" className={INPUT} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-gray-600">
            Responsável (opcional)
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className={INPUT} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Início
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT} />
          </label>
        </div>
        <label className="block text-xs font-medium text-gray-600">
          Template
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={INPUT}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
            <option value="">Sem template (projeto vazio)</option>
          </select>
        </label>
        {template && (
          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
            <p>
              O projeto já nasce com <b>{template.phases.length} fases</b> e <b>{artifactCount} artefatos</b>, com prazos
              calculados a partir da data de início:
            </p>
            <p className="mt-1 text-gray-600">{template.phases.map((ph) => ph.name).join(" → ")}</p>
          </div>
        )}
        {error && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Criando…" : "Criar projeto"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
