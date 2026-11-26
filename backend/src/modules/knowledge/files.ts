import path from "path";
import { extractText, getDocumentProxy } from "unpdf";
import { logger } from "../../lib/logger";

/**
 * Tipos de arquivo aceitos como anexo do catálogo.
 *
 * O tipo é decidido pela extensão, no servidor — o Content-Type enviado pelo navegador não é
 * confiável. `inline` diz se o arquivo pode ser aberto direto na tela (PDF, imagem, texto);
 * o resto é sempre baixado. SVG fica de fora do `inline` porque pode conter script.
 */
interface FileType {
  mime: string;
  inline: boolean;
  text: "pdf" | "utf8" | null;
}

const TYPES: Record<string, FileType> = {
  pdf: { mime: "application/pdf", inline: true, text: "pdf" },
  png: { mime: "image/png", inline: true, text: null },
  jpg: { mime: "image/jpeg", inline: true, text: null },
  jpeg: { mime: "image/jpeg", inline: true, text: null },
  gif: { mime: "image/gif", inline: true, text: null },
  webp: { mime: "image/webp", inline: true, text: null },
  svg: { mime: "image/svg+xml", inline: false, text: null },
  txt: { mime: "text/plain; charset=utf-8", inline: true, text: "utf8" },
  md: { mime: "text/markdown; charset=utf-8", inline: true, text: "utf8" },
  csv: { mime: "text/csv; charset=utf-8", inline: true, text: "utf8" },
  json: { mime: "application/json; charset=utf-8", inline: true, text: "utf8" },
  yaml: { mime: "text/yaml; charset=utf-8", inline: true, text: "utf8" },
  yml: { mime: "text/yaml; charset=utf-8", inline: true, text: "utf8" },
  xml: { mime: "application/xml; charset=utf-8", inline: false, text: "utf8" },
  log: { mime: "text/plain; charset=utf-8", inline: true, text: "utf8" },
  sql: { mime: "text/plain; charset=utf-8", inline: true, text: "utf8" },
  py: { mime: "text/plain; charset=utf-8", inline: true, text: "utf8" },
  js: { mime: "text/plain; charset=utf-8", inline: true, text: "utf8" },
  ts: { mime: "text/plain; charset=utf-8", inline: true, text: "utf8" },
  drawio: { mime: "application/xml; charset=utf-8", inline: false, text: null },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false, text: null },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false, text: null },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", inline: false, text: null },
  zip: { mime: "application/zip", inline: false, text: null },
};

export const ACCEPTED_EXTENSIONS = Object.keys(TYPES);

/** Texto extraído é cortado aqui: o suficiente para o RAG sem estourar o banco. */
const MAX_EXTRACTED_CHARS = 200_000;

export function extensionOf(fileName: string): string {
  return path.extname(fileName).slice(1).toLowerCase();
}

export function fileTypeFor(fileName: string): FileType | null {
  return TYPES[extensionOf(fileName)] ?? null;
}

/** Nome seguro para exibir/baixar: sem caminho, sem caracteres de controle, tamanho limitado. */
export function sanitizeFileName(raw: string): string {
  const base = path.basename(raw.replace(/\\/g, "/"));
  // oxlint-disable-next-line no-control-regex -- remove caracteres de controle de propósito
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim();
  return cleaned.slice(-180) || "arquivo";
}

/** Lê o texto de um arquivo para o Assistente. Falhar aqui nunca impede o upload. */
export async function extractFileText(fileName: string, data: Buffer): Promise<string | null> {
  const type = fileTypeFor(fileName);
  if (!type?.text) return null;
  try {
    let text: string;
    if (type.text === "pdf") {
      const doc = await getDocumentProxy(new Uint8Array(data));
      text = (await extractText(doc, { mergePages: true })).text;
    } else {
      text = data.toString("utf8");
    }
    // oxlint-disable-next-line no-control-regex -- o PDF às vezes traz NUL no texto
    const normalized = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
    return normalized ? normalized.slice(0, MAX_EXTRACTED_CHARS) : null;
  } catch (err) {
    logger.warn({ err, fileName }, "Não foi possível extrair o texto do anexo");
    return null;
  }
}
