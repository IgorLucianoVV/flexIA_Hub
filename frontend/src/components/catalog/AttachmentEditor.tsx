import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../api";
import type { AttachmentKind, DialogTree, KnowledgeAttachmentDetail } from "../../types";
import { DialogTreeView } from "./DialogTreeView";
import { DIAGRAM_TEMPLATES, DOC_TEMPLATE, KIND_BY_ID, TREE_EXAMPLE } from "./kinds";
import { MarkdownView } from "./MarkdownView";
import { MermaidDiagram } from "./MermaidDiagram";

const INPUT = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
const CODE_INPUT = `${INPUT} font-mono text-[13px] leading-relaxed`;

/**
 * Cria ou edita um anexo de texto (documentação, diagrama, árvore de diálogo ou link), sempre
 * com pré-visualização ao lado do que está sendo escrito.
 */
export function AttachmentEditor({
  itemId,
  kind,
  existing,
  onSaved,
  onCancel,
}: {
  itemId: string;
  kind: Exclude<AttachmentKind, "arquivo">;
  existing?: KnowledgeAttachmentDetail;
  onSaved: (id: string, warnings: string[]) => void;
  onCancel: () => void;
}) {
  const initialContent = existing
    ? typeof existing.content === "string"
      ? existing.content
      : existing.content
        ? JSON.stringify(existing.content, null, 2)
        : ""
    : kind === "documento"
      ? DOC_TEMPLATE
      : kind === "diagrama"
        ? DIAGRAM_TEMPLATES[0].code
        : "";

  const [title, setTitle] = useState(existing?.title ?? "");
  const [content, setContent] = useState(initialContent);
  const [url, setUrl] = useState(existing?.url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = kind === "link" ? { title, url, content } : { title, content };
      const saved = existing
        ? await api.updateAttachment(itemId, existing.id, data)
        : await api.createAttachment(itemId, { kind, ...data });
      onSaved(saved.id, saved.warnings ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const meta = KIND_BY_ID[kind];
  const titlePlaceholder: Record<typeof kind, string> = {
    documento: "Ex.: Como o bot decide o transbordo",
    diagrama: "Ex.: Arquitetura de integração com o CRM",
    arvore_dialogo: "Ex.: Fluxo principal de atendimento",
    link: "Ex.: Protótipo no Figma",
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <meta.icon className="h-5 w-5 text-indigo-600" />
          {existing ? `Editar ${meta.label.toLowerCase()}` : `Novo: ${meta.label.toLowerCase()}`}
        </h3>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim() || (kind === "link" ? !url.trim() : !content.trim())}
            className="px-3.5 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

      <label className="block">
        <span className="text-xs font-medium text-gray-600">Título</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={titlePlaceholder[kind]} className={`mt-1 ${INPUT}`} autoFocus />
      </label>

      {kind === "link" && (
        <>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Endereço</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={`mt-1 ${INPUT}`} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Descrição (opcional, aceita Markdown)</span>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} className={`mt-1 ${INPUT}`} placeholder="O que tem lá e quando consultar." />
          </label>
        </>
      )}

      {kind === "documento" && (
        <SplitEditor
          label="Markdown"
          help={
            <>
              Títulos com <code>#</code>, listas, tabelas, <code>`código`</code> e blocos <code>```mermaid</code> viram diagramas.
            </>
          }
          value={content}
          onChange={setContent}
          showPreview={showPreview}
          onTogglePreview={() => setShowPreview((v) => !v)}
          preview={content.trim() ? <MarkdownView content={content} /> : <p className="text-sm text-gray-400">A pré-visualização aparece aqui.</p>}
        />
      )}

      {kind === "diagrama" && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Começar de um modelo:</span>
            {DIAGRAM_TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => setContent(t.code)}
                className="text-xs px-2.5 py-1 rounded-full border border-gray-200 bg-white text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
              >
                {t.label}
              </button>
            ))}
          </div>
          <SplitEditor
            label="Código Mermaid"
            help={
              <>
                flowchart, sequenceDiagram, stateDiagram-v2, erDiagram, C4…{" "}
                <a className="text-indigo-600 hover:underline" href="https://mermaid.js.org/intro/syntax-reference.html" target="_blank" rel="noreferrer">
                  ver sintaxe
                </a>
              </>
            }
            value={content}
            onChange={setContent}
            showPreview={showPreview}
            onTogglePreview={() => setShowPreview((v) => !v)}
            preview={content.trim() ? <MermaidDiagram code={content} /> : <p className="text-sm text-gray-400">O desenho aparece aqui.</p>}
          />
        </>
      )}

      {kind === "arvore_dialogo" && <TreeInput value={content} onChange={setContent} />}
    </form>
  );
}

function SplitEditor({
  label,
  help,
  value,
  onChange,
  preview,
  showPreview,
  onTogglePreview,
}: {
  label: string;
  help: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  preview: React.ReactNode;
  showPreview: boolean;
  onTogglePreview: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-600">
          {label} <span className="font-normal text-gray-400">· {help}</span>
        </span>
        <button type="button" onClick={onTogglePreview} className="text-xs text-indigo-600 hover:underline shrink-0">
          {showPreview ? "Esconder pré-visualização" : "Mostrar pré-visualização"}
        </button>
      </div>
      <div className={`grid gap-4 ${showPreview ? "lg:grid-cols-2" : ""}`}>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className={`${CODE_INPUT} min-h-[28rem] resize-y`}
        />
        {showPreview && <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 min-h-[28rem] max-h-[70vh] overflow-auto">{preview}</div>}
      </div>
    </div>
  );
}

/** JSON da árvore: colar, carregar de arquivo, e ver como o Hub entendeu antes de salvar. */
function TreeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ tree: DialogTree; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!value.trim()) {
      setPreview(null);
      setError(null);
      return;
    }
    const timer = setTimeout(() => {
      api
        .previewDialogTree(value)
        .then((res) => {
          setPreview(res);
          setError(null);
        })
        .catch((err) => {
          setPreview(null);
          setError(err.message);
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [value]);

  async function loadFile(file: File) {
    onChange(await file.text());
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 font-medium"
        >
          Carregar arquivo .json
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
        />
        <button type="button" onClick={() => onChange(TREE_EXAMPLE)} className="text-indigo-600 hover:underline">
          Usar exemplo
        </button>
        <span className="text-gray-400">
          Aceita o formato do Hub (nodes + edges), árvores aninhadas (options/children) e listas de nós com transições por id.
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder="Cole aqui o JSON exportado da ferramenta do bot…"
        className={`${CODE_INPUT} min-h-[14rem] resize-y`}
      />
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
      {preview && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-600">Como o Hub entendeu o fluxo</p>
          {preview.warnings.length > 0 && (
            <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
              {preview.warnings.slice(0, 8).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {preview.warnings.length > 8 && <li>… e mais {preview.warnings.length - 8} avisos.</li>}
            </ul>
          )}
          <DialogTreeView key={JSON.stringify(preview.tree).length} tree={preview.tree} />
        </div>
      )}
    </div>
  );
}
