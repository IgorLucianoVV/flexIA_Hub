import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { KnowledgeDetail, KnowledgeItem } from "../types";
import { Badge } from "../components/Badge";
import { ScoreBadge } from "../components/ScoreBadge";
import { AttachmentsPanel } from "../components/catalog/AttachmentsPanel";
import { IconAlert, IconExternal } from "../components/icons";
import { KNOWLEDGE_STATUS_LABELS, KNOWLEDGE_TYPE_LABELS, formatDay } from "../lib/format";

const INPUT = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

type Tab = "documentacao" | "visao-geral";

/**
 * Página de um item do catálogo: a documentação (Markdown, diagramas, árvores de diálogo,
 * arquivos e links) e a visão geral de governança, dependências e discussões no fórum.
 *
 * A aba e o anexo abertos ficam na URL (?aba=, ?anexo=), então qualquer link — inclusive as
 * citações do Assistente de IA — abre exatamente o que foi referenciado.
 */
export function CatalogoItemPage() {
  const { id: itemId = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "dev";
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get("aba") === "visao-geral" ? "visao-geral" : "documentacao";
  const selectedAttachment = searchParams.get("anexo");

  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [candidates, setCandidates] = useState<KnowledgeItem[]>([]);
  const [newDependency, setNewDependency] = useState("");
  const [attachmentCount, setAttachmentCount] = useState<number | null>(null);

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
    setAttachmentCount(null);
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
    } catch (err: any) {
      setError(err.message);
    }
  }

  function onOpenItem(id: string) {
    navigate(`/catalogo/${id}`);
  }

  function setParams(next: { aba?: Tab; anexo?: string | null }) {
    const params = new URLSearchParams(searchParams);
    if (next.aba !== undefined) {
      if (next.aba === "documentacao") params.delete("aba");
      else params.set("aba", next.aba);
    }
    if (next.anexo !== undefined) {
      if (next.anexo) params.set("anexo", next.anexo);
      else params.delete("anexo");
    }
    setSearchParams(params, { replace: true });
  }

  if (!detail) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-3">
        <Link to="/catalogo" className="text-xs text-indigo-600 hover:underline">← Catálogo de Conhecimento</Link>
        <p className="text-sm text-gray-400">{error ?? "Carregando…"}</p>
      </div>
    );
  }

  const { item, dependsOn, dependents, threads } = detail;
  const linkedIds = new Set([item.id, ...dependsOn.map((d) => d.id)]);
  const docCount = attachmentCount ?? Object.values(detail.attachmentCounts ?? {}).reduce((a, b) => a + (b ?? 0), 0);

  const tabClass = (active: boolean) =>
    `px-1 pb-2.5 text-sm font-medium border-b-2 -mb-px ${
      active ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-800"
    }`;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="space-y-3">
        <Link to="/catalogo" className="text-xs text-indigo-600 hover:underline">← Catálogo de Conhecimento</Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-semibold text-gray-900">{item.name}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-indigo-600">{KNOWLEDGE_TYPE_LABELS[item.type] ?? item.type}</span>
              <Badge value={item.status} label={KNOWLEDGE_STATUS_LABELS[item.status] ?? item.status} />
              <ScoreBadge scorecard={item.scorecard} />
              {item.client_name && item.client_id && (
                <Link to={`/clientes/${item.client_id}`} className="text-[11px] text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5 hover:underline">
                  {item.client_name}
                </Link>
              )}
              <span className="text-xs text-gray-400">
                Time: {item.owner_team ?? "não definido"} · Revisado {item.last_reviewed_at ? `em ${formatDay(item.last_reviewed_at)}` : "nunca"}
              </span>
            </div>
            {item.description && <p className="text-sm text-gray-600 max-w-3xl">{item.description}</p>}
          </div>
          {item.gitlab_web_url && (
            <a
              href={item.gitlab_web_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 shrink-0"
            >
              <IconExternal className="h-4 w-4" /> Ver no GitLab
            </a>
          )}
        </div>
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

      <div className="flex gap-6 border-b border-gray-200" role="tablist">
        <button role="tab" aria-selected={tab === "documentacao"} onClick={() => setParams({ aba: "documentacao" })} className={tabClass(tab === "documentacao")}>
          Documentação e anexos{docCount ? ` (${docCount})` : ""}
        </button>
        <button role="tab" aria-selected={tab === "visao-geral"} onClick={() => setParams({ aba: "visao-geral" })} className={tabClass(tab === "visao-geral")}>
          Governança e dependências
        </button>
      </div>

      {tab === "documentacao" ? (
        <AttachmentsPanel
          itemId={item.id}
          canEdit={canEdit}
          selectedId={selectedAttachment}
          onSelect={(id) => setParams({ anexo: id })}
          onCountChange={setAttachmentCount}
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6 max-w-4xl">
          {editing ? (
            <EditForm
              item={item}
              candidates={candidates.filter((c) => c.id !== item.id)}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                load();
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
      )}
    </div>
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
