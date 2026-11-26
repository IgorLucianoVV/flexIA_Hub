import express, { Router } from "express";
import { z } from "zod";
import { config } from "../../config";
import { pool } from "../../db";
import { badRequest, notFound } from "../../lib/errors";
import { publish } from "../../lib/events";
import { logger } from "../../lib/logger";
import { deleteFile, fileExists, openFile, saveFile } from "../../lib/storage";
import { param, parse } from "../../lib/validate";
import { actorOf, AuthedRequest, requireRole } from "../auth/middleware";
import { InvalidTreeError, normalizeDialogTree } from "./dialogTree";
import { ACCEPTED_EXTENSIONS, extractFileText, fileTypeFor, sanitizeFileName } from "./files";

/**
 * Anexos de um item do catálogo: documentação (Markdown), diagramas (Mermaid), árvores de
 * diálogo, arquivos e links. Montado em /api/knowledge/:id/attachments.
 *
 * Leitura: qualquer usuário logado. Escrita: quem mantém o catálogo (admin e dev).
 * Toda alteração publica um evento — vai para a auditoria e agenda a reindexação do Assistente,
 * que passa a responder com base no material anexado.
 */
export const attachmentsRouter = Router({ mergeParams: true });

export const ATTACHMENT_EDITORS = ["admin", "dev"] as const;
const TEXT_KINDS = ["documento", "diagrama", "arvore_dialogo", "link"] as const;

const KIND_LABELS: Record<string, string> = {
  documento: "documento",
  diagrama: "diagrama",
  arvore_dialogo: "árvore de diálogo",
  arquivo: "arquivo",
  link: "link",
};

/** Limites de tamanho por tipo de conteúdo (caracteres). */
const CONTENT_LIMITS: Record<string, number> = {
  documento: 300_000,
  diagrama: 50_000,
  arvore_dialogo: 1_500_000,
};

const title = z.string({ error: "title é obrigatório" }).trim().min(1, "title é obrigatório").max(200);
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\/\S+$/i.test(v), "url precisa começar com http:// ou https://");

const createSchema = z.object({
  kind: z.enum(TEXT_KINDS, { error: `kind deve ser um de: ${TEXT_KINDS.join(", ")} (arquivos usam /file)` }),
  title,
  content: z.string().max(1_500_000).optional(),
  url: httpUrl.optional(),
});

const updateSchema = z.object({
  title: title.optional(),
  content: z.string().max(1_500_000).optional(),
  url: httpUrl.optional(),
});

const orderSchema = z.object({ ids: z.array(z.string().min(1).max(100)).max(500) });

/** Colunas devolvidas na listagem (sem o conteúdo, que pode ser grande). */
const SUMMARY_COLUMNS = `a.id, a.item_id, a.kind, a.title, a.url, a.file_name, a.mime_type, a.size_bytes, a.position,
  a.created_at, a.updated_at, (a.extracted_text IS NOT NULL) AS has_text, u.name AS updated_by_name`;

/** O :id do item vem da rota pai (/api/knowledge/:id/attachments). */
const itemIdOf = (req: express.Request) => param((req.params as Record<string, string>).id);

async function findItemOr404(itemId: string) {
  const { rows } = await pool.query(`SELECT id, name FROM knowledge_items WHERE id = $1`, [itemId]);
  if (!rows[0]) throw notFound("Item não encontrado");
  return rows[0] as { id: string; name: string };
}

async function findAttachmentOr404(itemId: string, attachmentId: string) {
  const { rows } = await pool.query(`SELECT * FROM knowledge_attachments WHERE id = $1 AND item_id = $2`, [attachmentId, itemId]);
  if (!rows[0]) throw notFound("Anexo não encontrado");
  return rows[0];
}

/** Valida e prepara o conteúdo de acordo com o tipo. Árvores são normalizadas aqui. */
function prepareContent(kind: string, content: string | undefined, url: string | undefined) {
  if (kind === "link") {
    if (!url) throw badRequest("Informe a url do link");
    return { content: content?.trim() || null, url, warnings: [] as string[] };
  }
  if (content === undefined || !content.trim()) throw badRequest(`Informe o conteúdo do ${KIND_LABELS[kind]}`);
  const limit = CONTENT_LIMITS[kind];
  if (limit && content.length > limit) throw badRequest(`O ${KIND_LABELS[kind]} passa do limite de ${limit.toLocaleString("pt-BR")} caracteres`);

  if (kind === "arvore_dialogo") {
    try {
      const { tree, warnings } = normalizeDialogTree(content);
      return { content: JSON.stringify(tree), url: null, warnings };
    } catch (err) {
      if (err instanceof InvalidTreeError) throw badRequest(err.message);
      throw err;
    }
  }
  return { content, url: null, warnings: [] as string[] };
}

async function summaryById(attachmentId: string) {
  const { rows } = await pool.query(
    `SELECT ${SUMMARY_COLUMNS} FROM knowledge_attachments a LEFT JOIN users u ON u.id = a.updated_by WHERE a.id = $1`,
    [attachmentId]
  );
  return rows[0];
}

// GET /api/knowledge/:id/attachments — lista (sem conteúdo)
attachmentsRouter.get("/", async (req, res) => {
  const itemId = itemIdOf(req);
  await findItemOr404(itemId);
  const { rows } = await pool.query(
    `SELECT ${SUMMARY_COLUMNS} FROM knowledge_attachments a LEFT JOIN users u ON u.id = a.updated_by
      WHERE a.item_id = $1 ORDER BY a.position, a.created_at`,
    [itemId]
  );
  res.json(rows);
});

// GET /api/knowledge/:id/attachments/:attachmentId — anexo com o conteúdo
attachmentsRouter.get("/:attachmentId", async (req, res) => {
  const itemId = itemIdOf(req);
  const attachment = await findAttachmentOr404(itemId, param(req.params.attachmentId));
  const summary = await summaryById(attachment.id);
  res.json({
    ...summary,
    content: attachment.kind === "arvore_dialogo" && attachment.content ? JSON.parse(attachment.content) : attachment.content,
    // Para arquivos, um trecho do texto extraído ajuda a conferir o que o Assistente "leu".
    text_preview: attachment.extracted_text ? attachment.extracted_text.slice(0, 2000) : null,
  });
});

// GET /api/knowledge/:id/attachments/:attachmentId/file — baixa/abre o arquivo
attachmentsRouter.get("/:attachmentId/file", async (req, res) => {
  const itemId = itemIdOf(req);
  const attachment = await findAttachmentOr404(itemId, param(req.params.attachmentId));
  if (attachment.kind !== "arquivo" || !attachment.storage_key) throw notFound("Este anexo não tem arquivo");
  if (!(await fileExists(attachment.storage_key))) throw notFound("O arquivo não está mais no armazenamento");

  const type = fileTypeFor(attachment.file_name);
  const inline = type?.inline && req.query.download === undefined;
  const encoded = encodeURIComponent(attachment.file_name);
  res.setHeader("Content-Type", type?.mime ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`);
  res.setHeader("Content-Length", String(attachment.size_bytes));
  // O arquivo é conteúdo enviado por usuário: nunca roda script nem carrega nada de fora.
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  res.setHeader("Cache-Control", "private, max-age=300");
  openFile(attachment.storage_key)
    .on("error", (err) => {
      logger.error({ err, attachmentId: attachment.id }, "Falha ao ler o arquivo anexado");
      res.destroy(err);
    })
    .pipe(res);
});

// POST /api/knowledge/:id/attachments — documento, diagrama, árvore de diálogo ou link
attachmentsRouter.post("/", requireRole(...ATTACHMENT_EDITORS), async (req: AuthedRequest, res) => {
  const itemId = itemIdOf(req);
  const item = await findItemOr404(itemId);
  const body = parse(createSchema, req.body);
  const prepared = prepareContent(body.kind, body.content, body.url);

  const { rows } = await pool.query(
    `INSERT INTO knowledge_attachments (item_id, kind, title, content, url, position, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5, (SELECT COALESCE(MAX(position) + 1, 0) FROM knowledge_attachments WHERE item_id = $1), $6, $6)
     RETURNING id`,
    [itemId, body.kind, body.title, prepared.content, prepared.url, req.user!.id]
  );
  await publish({
    type: "knowledge.attachment.created",
    actor: actorOf(req),
    entityType: "knowledge_item",
    entityId: itemId,
    summary: `Anexou o ${KIND_LABELS[body.kind]} "${body.title}" a "${item.name}"`,
    metadata: { attachmentId: rows[0].id, kind: body.kind },
  });
  res.status(201).json({ ...(await summaryById(rows[0].id)), warnings: prepared.warnings });
});

// POST /api/knowledge/:id/attachments/file — upload de arquivo
// Corpo = os bytes do arquivo; nome no cabeçalho X-File-Name (codificado com encodeURIComponent)
// e título opcional em X-Title. Sem multipart: um arquivo por requisição, sem dependência extra.
attachmentsRouter.post(
  "/file",
  requireRole(...ATTACHMENT_EDITORS),
  express.raw({ type: () => true, limit: config.maxUploadBytes }),
  async (req: AuthedRequest, res) => {
    const itemId = itemIdOf(req);
    const item = await findItemOr404(itemId);

    const rawName = req.header("x-file-name");
    if (!rawName) throw badRequest("Informe o nome do arquivo no cabeçalho X-File-Name");
    let decodedName: string;
    let decodedTitle: string | undefined;
    try {
      decodedName = decodeURIComponent(rawName);
      decodedTitle = req.header("x-title") ? decodeURIComponent(req.header("x-title")!) : undefined;
    } catch {
      throw badRequest("Nome ou título do arquivo mal codificado");
    }
    const fileName = sanitizeFileName(decodedName);
    const type = fileTypeFor(fileName);
    if (!type) throw badRequest(`Tipo de arquivo não aceito. Aceitos: ${ACCEPTED_EXTENSIONS.join(", ")}`);

    const data = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) throw badRequest("O arquivo está vazio");

    const storageKey = await saveFile(data);
    try {
      const extracted = await extractFileText(fileName, data);
      const attachmentTitle = (decodedTitle?.trim() || fileName).slice(0, 200);
      const { rows } = await pool.query(
        `INSERT INTO knowledge_attachments
           (item_id, kind, title, file_name, mime_type, size_bytes, storage_key, extracted_text, position, created_by, updated_by)
         VALUES ($1,'arquivo',$2,$3,$4,$5,$6,$7,
           (SELECT COALESCE(MAX(position) + 1, 0) FROM knowledge_attachments WHERE item_id = $1), $8, $8)
         RETURNING id`,
        [itemId, attachmentTitle, fileName, type.mime, data.length, storageKey, extracted, req.user!.id]
      );
      await publish({
        type: "knowledge.attachment.created",
        actor: actorOf(req),
        entityType: "knowledge_item",
        entityId: itemId,
        summary: `Anexou o arquivo "${fileName}" a "${item.name}"`,
        metadata: { attachmentId: rows[0].id, kind: "arquivo", sizeBytes: data.length },
      });
      res.status(201).json(await summaryById(rows[0].id));
    } catch (err) {
      // Não deixa arquivo órfão no disco se a gravação no banco falhar.
      await deleteFile(storageKey).catch(() => undefined);
      throw err;
    }
  }
);

// PATCH /api/knowledge/:id/attachments/:attachmentId — título, conteúdo ou url
attachmentsRouter.patch("/:attachmentId", requireRole(...ATTACHMENT_EDITORS), async (req: AuthedRequest, res) => {
  const itemId = itemIdOf(req);
  const item = await findItemOr404(itemId);
  const current = await findAttachmentOr404(itemId, param(req.params.attachmentId));
  const body = parse(updateSchema, req.body);

  const columns: Record<string, unknown> = {};
  let warnings: string[] = [];
  if (body.title !== undefined) columns.title = body.title;
  if (body.content !== undefined || body.url !== undefined) {
    if (current.kind === "arquivo") throw badRequest("O conteúdo de um arquivo não é editável — envie um arquivo novo");
    const prepared = prepareContent(current.kind, body.content ?? current.content ?? undefined, body.url ?? current.url ?? undefined);
    columns.content = prepared.content;
    if (current.kind === "link") columns.url = prepared.url;
    warnings = prepared.warnings;
  }
  const names = Object.keys(columns);
  if (names.length === 0) throw badRequest("Nenhum campo para atualizar");

  await pool.query(
    `UPDATE knowledge_attachments SET ${names.map((n, i) => `${n} = $${i + 1}`).join(", ")},
       updated_by = $${names.length + 1}, updated_at = now()
     WHERE id = $${names.length + 2}`,
    [...names.map((n) => columns[n]), req.user!.id, current.id]
  );
  await publish({
    type: "knowledge.attachment.updated",
    actor: actorOf(req),
    entityType: "knowledge_item",
    entityId: itemId,
    summary: `Editou o ${KIND_LABELS[current.kind]} "${body.title ?? current.title}" de "${item.name}"`,
    metadata: { attachmentId: current.id, fields: names },
  });
  res.json({ ...(await summaryById(current.id)), warnings });
});

// PUT /api/knowledge/:id/attachments/order { ids } — nova ordem de exibição
attachmentsRouter.put("/order", requireRole(...ATTACHMENT_EDITORS), async (req: AuthedRequest, res) => {
  const itemId = itemIdOf(req);
  await findItemOr404(itemId);
  const { ids } = parse(orderSchema, req.body);
  await pool.query(
    `UPDATE knowledge_attachments a SET position = o.pos
       FROM unnest($1::text[]) WITH ORDINALITY AS o(id, pos)
      WHERE a.id = o.id AND a.item_id = $2`,
    [ids, itemId]
  );
  res.status(204).send();
});

// DELETE /api/knowledge/:id/attachments/:attachmentId
attachmentsRouter.delete("/:attachmentId", requireRole(...ATTACHMENT_EDITORS), async (req: AuthedRequest, res) => {
  const itemId = itemIdOf(req);
  const item = await findItemOr404(itemId);
  const current = await findAttachmentOr404(itemId, param(req.params.attachmentId));
  await pool.query(`DELETE FROM knowledge_attachments WHERE id = $1`, [current.id]);
  if (current.storage_key) {
    await deleteFile(current.storage_key).catch((err) =>
      logger.warn({ err, attachmentId: current.id }, "Anexo apagado, mas o arquivo não pôde ser removido do disco")
    );
  }
  await publish({
    type: "knowledge.attachment.deleted",
    actor: actorOf(req),
    entityType: "knowledge_item",
    entityId: itemId,
    summary: `Removeu o ${KIND_LABELS[current.kind]} "${current.title}" de "${item.name}"`,
    metadata: { attachmentId: current.id, kind: current.kind },
  });
  res.status(204).send();
});
