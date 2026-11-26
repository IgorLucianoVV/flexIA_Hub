import { useEffect, useState } from "react";
import { api } from "../../api";
import { formatDay } from "../../lib/format";
import type { DialogTree, KnowledgeAttachment, KnowledgeAttachmentDetail } from "../../types";
import { IconDownload, IconExternal, IconPencil, IconTrash } from "../icons";
import { DialogTreeView } from "./DialogTreeView";
import { formatBytes, KIND_BY_ID } from "./kinds";
import { MarkdownView } from "./MarkdownView";
import { MermaidDiagram } from "./MermaidDiagram";

const BUTTON = "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50";

/** Mostra um anexo do jeito certo para o tipo dele, com as ações de quem pode editar. */
export function AttachmentViewer({
  itemId,
  attachment,
  canEdit,
  onEdit,
  onDeleted,
  onImportedTree,
}: {
  itemId: string;
  attachment: KnowledgeAttachment;
  canEdit: boolean;
  onEdit: (detail: KnowledgeAttachmentDetail) => void;
  onDeleted: () => void;
  onImportedTree: (id: string) => void;
}) {
  const [detail, setDetail] = useState<KnowledgeAttachmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setShowSource(false);
    api
      .getAttachment(itemId, attachment.id)
      .then(setDetail)
      .catch((err) => setError(err.message));
  }, [itemId, attachment.id, attachment.updated_at]);

  async function remove() {
    if (!window.confirm(`Excluir "${attachment.title}"? ${attachment.kind === "arquivo" ? "O arquivo também será apagado." : ""}`)) return;
    try {
      await api.deleteAttachment(itemId, attachment.id);
      onDeleted();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const meta = KIND_BY_ID[attachment.kind];

  return (
    <article className="space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600 flex items-center gap-1.5">
            <meta.icon className="h-3.5 w-3.5" />
            {meta.label}
            {attachment.kind === "arquivo" && attachment.size_bytes != null && (
              <span className="text-gray-400 normal-case tracking-normal font-normal">· {formatBytes(attachment.size_bytes)}</span>
            )}
          </p>
          <h2 className="text-lg font-semibold text-gray-900 break-words">{attachment.title}</h2>
          <p className="text-xs text-gray-400">
            Atualizado em {formatDay(attachment.updated_at)}
            {attachment.updated_by_name ? ` por ${attachment.updated_by_name}` : ""}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {attachment.kind === "diagrama" && (
            <button type="button" onClick={() => setShowSource((v) => !v)} className={BUTTON}>
              {showSource ? "Ver desenho" : "Ver código"}
            </button>
          )}
          {attachment.kind === "arquivo" && <DownloadButton itemId={itemId} attachment={attachment} />}
          {canEdit && detail && attachment.kind !== "arquivo" && (
            <button type="button" onClick={() => onEdit(detail)} className={BUTTON}>
              <IconPencil className="h-3.5 w-3.5" /> Editar
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={remove} className={`${BUTTON} hover:text-rose-700 hover:border-rose-200`} title="Excluir anexo">
              <IconTrash className="h-3.5 w-3.5" />
              <span className="sr-only">Excluir</span>
            </button>
          )}
        </div>
      </header>

      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
      {!detail && !error && <p className="text-sm text-gray-400">Carregando…</p>}

      {detail && attachment.kind === "documento" && typeof detail.content === "string" && <MarkdownView content={detail.content} />}

      {detail && attachment.kind === "diagrama" && typeof detail.content === "string" &&
        (showSource ? (
          <pre className="text-[13px] bg-slate-900 text-slate-100 rounded-xl p-4 overflow-auto">{detail.content}</pre>
        ) : (
          <MermaidDiagram code={detail.content} />
        ))}

      {detail && attachment.kind === "arvore_dialogo" && detail.content && typeof detail.content === "object" && (
        <DialogTreeView tree={detail.content as DialogTree} />
      )}

      {detail && attachment.kind === "link" && (
        <div className="space-y-3">
          <a
            href={detail.url ?? "#"}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-indigo-300 group"
          >
            <span className="text-sm text-indigo-700 truncate">{detail.url}</span>
            <IconExternal className="h-4 w-4 text-gray-400 group-hover:text-indigo-600" />
          </a>
          {typeof detail.content === "string" && detail.content.trim() && <MarkdownView content={detail.content} />}
        </div>
      )}

      {detail && attachment.kind === "arquivo" && <FileView itemId={itemId} detail={detail} canEdit={canEdit} onImportedTree={onImportedTree} />}
    </article>
  );
}

function DownloadButton({ itemId, attachment }: { itemId: string; attachment: KnowledgeAttachment }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const blob = await api.getAttachmentFile(itemId, attachment.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.file_name ?? attachment.title;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={download} disabled={busy} className={BUTTON}>
      <IconDownload className="h-3.5 w-3.5" /> {busy ? "Baixando…" : "Baixar"}
    </button>
  );
}

const TEXT_EXTENSIONS = ["txt", "md", "csv", "json", "yaml", "yml", "log", "sql", "py", "js", "ts", "xml"];

/** Pré-visualização de arquivo: imagem e PDF na tela, texto formatado; o resto, só download. */
function FileView({
  itemId,
  detail,
  canEdit,
  onImportedTree,
}: {
  itemId: string;
  detail: KnowledgeAttachmentDetail;
  canEdit: boolean;
  onImportedTree: (id: string) => void;
}) {
  const ext = (detail.file_name ?? "").split(".").pop()?.toLowerCase() ?? "";
  const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
  const isPdf = ext === "pdf";
  const isText = TEXT_EXTENSIONS.includes(ext);
  const canPreview = isImage || isPdf || isText;
  const tooBig = (detail.size_bytes ?? 0) > 15 * 1024 * 1024;

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!canPreview || tooBig) return;
    let url: string | null = null;
    let cancelled = false;
    api
      .getAttachmentFile(itemId, detail.id)
      .then(async (blob) => {
        if (cancelled) return;
        if (isText) {
          const raw = await blob.text();
          let pretty = raw;
          if (ext === "json") {
            try {
              pretty = JSON.stringify(JSON.parse(raw), null, 2);
            } catch {
              /* mostra como veio */
            }
          }
          setText(pretty.length > 200_000 ? `${pretty.slice(0, 200_000)}\n\n… (arquivo cortado na pré-visualização)` : pretty);
        } else {
          // PDF precisa do tipo certo no blob para o leitor do navegador abrir.
          url = URL.createObjectURL(isPdf ? new Blob([blob], { type: "application/pdf" }) : blob);
          setObjectUrl(url);
        }
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [itemId, detail.id, canPreview, tooBig, isText, isPdf, ext]);

  async function importAsTree() {
    if (!text) return;
    setImporting(true);
    setError(null);
    try {
      const created = await api.createAttachment(itemId, {
        kind: "arvore_dialogo",
        title: detail.title.replace(/\.json$/i, ""),
        content: text,
      });
      onImportedTree(created.id);
    } catch (err: any) {
      setError(`Não deu para importar como árvore: ${err.message}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

      {!canPreview || tooBig ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
          <p className="text-sm text-gray-600 font-medium">{detail.file_name}</p>
          <p className="text-xs text-gray-400 mt-1">
            {tooBig ? "Arquivo grande demais para pré-visualizar." : "Este tipo de arquivo não tem pré-visualização."} Use o botão Baixar.
          </p>
        </div>
      ) : isImage ? (
        objectUrl && <img src={objectUrl} alt={detail.title} className="max-w-full rounded-xl border border-gray-200 bg-white" />
      ) : isPdf ? (
        objectUrl && <iframe src={objectUrl} title={detail.title} className="w-full h-[75vh] rounded-xl border border-gray-200 bg-white" />
      ) : (
        <>
          {ext === "json" && canEdit && text && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
              <p className="text-xs text-indigo-900">É a exportação de um fluxo de bot? Transforme em árvore de diálogo navegável.</p>
              <button
                type="button"
                onClick={importAsTree}
                disabled={importing}
                className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {importing ? "Importando…" : "Importar como árvore"}
              </button>
            </div>
          )}
          {ext === "md" && text ? (
            <MarkdownView content={text} />
          ) : (
            text !== null && <pre className="text-[13px] bg-slate-900 text-slate-100 rounded-xl p-4 overflow-auto max-h-[70vh]">{text}</pre>
          )}
        </>
      )}

      {objectUrl === null && text === null && canPreview && !tooBig && !error && <p className="text-sm text-gray-400">Carregando arquivo…</p>}

      {detail.text_preview && !isText && (
        <details className="rounded-lg border border-gray-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-600">Texto lido pelo Assistente de IA</summary>
          <p className="px-3 pb-3 text-xs text-gray-500 whitespace-pre-wrap">
            {detail.text_preview}
            {detail.text_preview.length >= 2000 ? " …" : ""}
          </p>
        </details>
      )}
    </div>
  );
}
