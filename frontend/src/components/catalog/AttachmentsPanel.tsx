import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { api } from "../../api";
import type { AttachmentKind, KnowledgeAttachment, KnowledgeAttachmentDetail } from "../../types";
import { IconPlus, IconUpload } from "../icons";
import { AttachmentEditor } from "./AttachmentEditor";
import { AttachmentViewer } from "./AttachmentViewer";
import { ACCEPTED_FILES, ATTACHMENT_KINDS, formatBytes } from "./kinds";

type Mode =
  | { type: "view" }
  | { type: "create"; kind: Exclude<AttachmentKind, "arquivo"> }
  | { type: "edit"; detail: KnowledgeAttachmentDetail }
  | { type: "upload" };

/**
 * Documentação e anexos de um item do catálogo: lista à esquerda (agrupada por tipo) e o anexo
 * aberto à direita. O anexo aberto fica na URL (?anexo=), então dá para mandar o link direto
 * para um diagrama ou documento — é o link que o Assistente de IA usa nas citações.
 */
export function AttachmentsPanel({
  itemId,
  canEdit,
  selectedId,
  onSelect,
  onCountChange,
}: {
  itemId: string;
  canEdit: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCountChange?: (count: number) => void;
}) {
  const [list, setList] = useState<KnowledgeAttachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ type: "view" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (select?: string) => {
      try {
        const rows = await api.getAttachments(itemId);
        setList(rows);
        onCountChange?.(rows.length);
        if (select) onSelect(select);
        else if (!rows.some((r) => r.id === selectedId)) onSelect(rows[0]?.id ?? null);
      } catch (err: any) {
        setError(err.message);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemId, selectedId]
  );

  useEffect(() => {
    load();
    // Recarrega só ao trocar de item; trocar de anexo selecionado não precisa buscar a lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  function startCreate(kind: AttachmentKind) {
    setMenuOpen(false);
    setNotice(null);
    setMode(kind === "arquivo" ? { type: "upload" } : { type: "create", kind });
  }

  async function afterSave(id: string, warnings: string[]) {
    setMode({ type: "view" });
    setNotice(warnings.length ? `Salvo com ${warnings.length} aviso(s): ${warnings.slice(0, 3).join(" ")}` : null);
    await load(id);
  }

  const selected = list?.find((a) => a.id === selectedId) ?? null;

  if (error) return <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>;
  if (!list) return <p className="text-sm text-gray-400">Carregando documentação…</p>;

  const editing = mode.type !== "view";

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Anexos do item" className="space-y-4 lg:sticky lg:top-20 h-fit">
        {canEdit && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 [--icon-accent:#c7d2fe]"
            >
              <IconPlus className="h-4 w-4" /> Adicionar
            </button>
            {menuOpen && (
              <div className="absolute z-20 mt-1 w-72 rounded-xl border border-gray-200 bg-white shadow-xl p-1">
                {ATTACHMENT_KINDS.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    onClick={() => startCreate(k.kind)}
                    className="w-full text-left flex gap-3 rounded-lg px-3 py-2 hover:bg-indigo-50"
                  >
                    <k.icon className="h-5 w-5 text-indigo-600 mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">{k.label}</span>
                      <span className="block text-xs text-gray-500">{k.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {list.length === 0 ? (
          <p className="text-xs text-gray-400 px-1">Nenhum anexo ainda.</p>
        ) : (
          ATTACHMENT_KINDS.map((k) => {
            const group = list.filter((a) => a.kind === k.kind);
            if (group.length === 0) return null;
            return (
              <div key={k.kind}>
                <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">{k.plural}</p>
                <ul className="space-y-0.5">
                  {group.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setMode({ type: "view" });
                          setNotice(null);
                          onSelect(a.id);
                        }}
                        className={`w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                          a.id === selectedId && !editing ? "bg-indigo-50 text-indigo-800 font-medium" : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <k.icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{a.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </nav>

      <section className="min-w-0 bg-white rounded-xl border border-gray-200 p-5 lg:p-6">
        {notice && <p className="mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{notice}</p>}

        {mode.type === "create" && (
          <AttachmentEditor itemId={itemId} kind={mode.kind} onSaved={afterSave} onCancel={() => setMode({ type: "view" })} />
        )}
        {mode.type === "edit" && (
          <AttachmentEditor
            itemId={itemId}
            kind={mode.detail.kind as Exclude<AttachmentKind, "arquivo">}
            existing={mode.detail}
            onSaved={afterSave}
            onCancel={() => setMode({ type: "view" })}
          />
        )}
        {mode.type === "upload" && (
          <Uploader
            itemId={itemId}
            onDone={async (lastId) => {
              setMode({ type: "view" });
              await load(lastId ?? undefined);
            }}
            onCancel={() => setMode({ type: "view" })}
          />
        )}

        {mode.type === "view" &&
          (selected ? (
            <AttachmentViewer
              itemId={itemId}
              attachment={selected}
              canEdit={canEdit}
              onEdit={(detail) => setMode({ type: "edit", detail })}
              onDeleted={() => load()}
              onImportedTree={(id) => load(id)}
            />
          ) : (
            <EmptyState canEdit={canEdit} onAdd={startCreate} />
          ))}
      </section>
    </div>
  );
}

function EmptyState({ canEdit, onAdd }: { canEdit: boolean; onAdd: (kind: AttachmentKind) => void }) {
  return (
    <div className="py-6 text-center space-y-5">
      <div>
        <p className="font-medium text-gray-900">Este item ainda não tem documentação</p>
        <p className="text-sm text-gray-500 mt-1">
          {canEdit
            ? "Explique como ele funciona, desenhe a arquitetura, importe a árvore de diálogo ou anexe os arquivos de referência. O Assistente de IA passa a usar esse material nas respostas."
            : "Quem mantém o catálogo (dev ou admin) pode adicionar documentação, diagramas, árvores de diálogo e arquivos."}
        </p>
      </div>
      {canEdit && (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 text-left">
          {ATTACHMENT_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              onClick={() => onAdd(k.kind)}
              className="flex gap-3 text-left rounded-xl border border-gray-200 px-4 py-3 hover:border-indigo-300 hover:bg-indigo-50/40"
            >
              <k.icon className="h-5 w-5 text-indigo-600 mt-0.5 shrink-0" />
              <span>
                <span className="block text-sm font-medium text-gray-900">{k.label}</span>
                <span className="block text-xs text-gray-500">{k.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface UploadRow {
  name: string;
  size: number;
  status: "enviando" | "ok" | "erro";
  message?: string;
}

/** Envio de arquivos: arrastar e soltar ou escolher vários de uma vez (um por requisição). */
function Uploader({ itemId, onDone, onCancel }: { itemId: string; onDone: (lastId: string | null) => void; onCancel: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);

  async function send(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    const start = rows.length;
    setRows((prev) => [...prev, ...files.map((f) => ({ name: f.name, size: f.size, status: "enviando" as const }))]);
    let last: string | null = lastId;
    for (const [i, file] of files.entries()) {
      try {
        const created = await api.uploadAttachment(itemId, file);
        last = created.id;
        setRows((prev) => prev.map((r, j) => (j === start + i ? { ...r, status: "ok" } : r)));
      } catch (err: any) {
        setRows((prev) => prev.map((r, j) => (j === start + i ? { ...r, status: "erro", message: err.message } : r)));
      }
    }
    setLastId(last);
    setBusy(false);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    send([...e.dataTransfer.files]);
  }

  const doneCount = rows.filter((r) => r.status === "ok").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <IconUpload className="h-5 w-5 text-indigo-600" /> Anexar arquivos
        </h3>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50">
            {doneCount ? "Fechar" : "Cancelar"}
          </button>
          {doneCount > 0 && (
            <button type="button" onClick={() => onDone(lastId)} disabled={busy} className="px-3.5 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              Ver arquivos
            </button>
          )}
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        className={`rounded-xl border-2 border-dashed px-6 py-12 text-center cursor-pointer transition-colors ${
          dragging ? "border-indigo-400 bg-indigo-50" : "border-gray-300 bg-gray-50 hover:border-indigo-300"
        }`}
      >
        <IconUpload className="h-8 w-8 text-indigo-500 mx-auto" />
        <p className="mt-2 text-sm font-medium text-gray-800">Arraste os arquivos para cá ou clique para escolher</p>
        <p className="mt-1 text-xs text-gray-500">PDF, imagens, texto, JSON, YAML, planilhas, Word, PowerPoint, draw.io, zip · até 25 MB cada</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          className="hidden"
          onChange={(e) => {
            send([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {rows.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span className="truncate text-gray-800">
                {r.name} <span className="text-xs text-gray-400">{formatBytes(r.size)}</span>
              </span>
              <span
                className={`shrink-0 text-xs font-medium ${
                  r.status === "ok" ? "text-emerald-700" : r.status === "erro" ? "text-rose-700" : "text-gray-400"
                }`}
                title={r.message}
              >
                {r.status === "ok" ? "Anexado" : r.status === "erro" ? r.message : "Enviando…"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-400">
        O texto de PDFs, Markdown, JSON e outros arquivos de texto é lido e passa a ser usado pelo Assistente de IA.
      </p>
    </div>
  );
}
