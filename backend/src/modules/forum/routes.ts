import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import { publish } from "../../lib/events";
import { parsePagination, paginatedResponse } from "../../lib/pagination";
import { escapeLike, id, optionalId, optionalText, param, parse, text } from "../../lib/validate";
import { actorOf, AuthedRequest, AuthUser, requireAuth, requireRole } from "../auth/middleware";

export const forumRouter = Router();
forumRouter.use(requireAuth);

const categorySchema = z.object({
  slug: z
    .string({ error: "slug é obrigatório" })
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug aceita só letras minúsculas, números e hífens")
    .max(60),
  name: text(80, "name"),
  description: optionalText(300),
  order: z.number().int().min(0).optional(),
});
const updateCategorySchema = z.object({
  name: text(80, "name").optional(),
  description: z.union([z.string().trim().max(300), z.null()]).optional(),
  order: z.number().int().min(0).optional(),
});

const createThreadSchema = z.object({
  title: text(200, "title"),
  body: text(10_000, "body"),
  categoryId: id,
  clientId: optionalId,
  knowledgeItemId: optionalId,
});
const updateThreadSchema = z
  .object({ title: text(200, "title").optional(), body: text(10_000, "body").optional() })
  .refine((v) => v.title !== undefined || v.body !== undefined, "informe title e/ou body");
const replySchema = z.object({ body: text(10_000, "body") });
const acceptSchema = z.object({ replyId: z.union([z.string().trim().min(1), z.null()]) });

function isOwnerOrAdmin(user: AuthUser | undefined, authorId: string) {
  return !!user && (user.id === authorId || user.role === "admin");
}

const THREAD_SELECT = `
  SELECT t.*, u.name AS author_name, u.role AS author_role,
         cat.slug AS category_slug, cat.name AS category_name,
         cl.name AS client_name, ki.name AS knowledge_item_name,
         (SELECT COUNT(*) FROM forum_replies r WHERE r.thread_id = t.id) AS reply_count
    FROM forum_threads t
    JOIN users u ON u.id = t.author_id
    JOIN forum_categories cat ON cat.id = t.category_id
    LEFT JOIN clients cl ON cl.id = t.client_id
    LEFT JOIN knowledge_items ki ON ki.id = t.knowledge_item_id`;

// GET /api/forum/categories
forumRouter.get("/categories", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM forum_threads t WHERE t.category_id = c.id) AS thread_count
     FROM forum_categories c ORDER BY c."order" ASC, c.name ASC`
  );
  res.json(rows);
});

// POST /api/forum/categories - cria categoria (só admin)
forumRouter.post("/categories", requireRole("admin"), async (req: AuthedRequest, res) => {
  const body = parse(categorySchema, req.body);
  const { rows } = await pool.query(
    `INSERT INTO forum_categories (slug, name, description, "order") VALUES ($1,$2,$3,$4) RETURNING *`,
    [body.slug, body.name, body.description ?? null, body.order ?? 0]
  );
  await publish({
    type: "forum.category.created",
    actor: actorOf(req),
    entityType: "forum_category",
    entityId: rows[0].id,
    summary: `Criou a categoria do fórum "${rows[0].name}"`,
    contentChanged: false,
  });
  res.status(201).json(rows[0]);
});

// PATCH /api/forum/categories/:id - edita categoria (só admin)
forumRouter.patch("/categories/:id", requireRole("admin"), async (req: AuthedRequest, res) => {
  const body = parse(updateCategorySchema, req.body);
  const { rows } = await pool.query(
    `UPDATE forum_categories
        SET name = COALESCE($1, name),
            description = CASE WHEN $2::boolean THEN $3 ELSE description END,
            "order" = COALESCE($4, "order")
      WHERE id = $5 RETURNING *`,
    [body.name ?? null, body.description !== undefined, body.description || null, body.order ?? null, param(req.params.id)]
  );
  if (!rows[0]) throw notFound("Categoria não encontrada");
  await publish({
    type: "forum.category.updated",
    actor: actorOf(req),
    entityType: "forum_category",
    entityId: rows[0].id,
    summary: `Editou a categoria do fórum "${rows[0].name}"`,
    contentChanged: false,
  });
  res.json(rows[0]);
});

// GET /api/forum/threads?category=&clientId=&knowledgeItemId=&q=&limit=&offset=
forumRouter.get("/threads", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const pagination = parsePagination(query);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.category) {
    params.push(query.category);
    conditions.push(`cat.slug = $${params.length}`);
  }
  if (query.clientId) {
    params.push(query.clientId);
    conditions.push(`t.client_id = $${params.length}`);
  }
  if (query.knowledgeItemId) {
    params.push(query.knowledgeItemId);
    conditions.push(`t.knowledge_item_id = $${params.length}`);
  }
  if (query.q?.trim()) {
    params.push(`%${escapeLike(query.q.trim().toLowerCase())}%`);
    conditions.push(
      `(immutable_unaccent(lower(t.title)) LIKE immutable_unaccent($${params.length})
        OR immutable_unaccent(lower(t.body)) LIKE immutable_unaccent($${params.length}))`
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [items, total] = await Promise.all([
    pool.query(
      `${THREAD_SELECT} ${where}
       ORDER BY t.pinned DESC, t.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pagination.limit, pagination.offset]
    ),
    pool.query(
      `SELECT COUNT(*) FROM forum_threads t JOIN forum_categories cat ON cat.id = t.category_id ${where}`,
      params
    ),
  ]);
  res.json(paginatedResponse(items.rows, Number(total.rows[0].count), pagination));
});

// GET /api/forum/threads/:id - tópico + respostas
forumRouter.get("/threads/:id", async (req, res) => {
  const threadId = param(req.params.id);
  const threadResult = await pool.query(`${THREAD_SELECT} WHERE t.id = $1`, [threadId]);
  const thread = threadResult.rows[0];
  if (!thread) throw notFound("Tópico não encontrado");

  const repliesResult = await pool.query(
    `SELECT r.*, u.name AS author_name, u.role AS author_role
     FROM forum_replies r
     JOIN users u ON u.id = r.author_id
     WHERE r.thread_id = $1
     ORDER BY r.created_at ASC`,
    [threadId]
  );
  res.json({ thread, replies: repliesResult.rows });
});

// POST /api/forum/threads - cria tópico
forumRouter.post("/threads", async (req: AuthedRequest, res) => {
  const body = parse(createThreadSchema, req.body);
  const { rows } = await pool.query(
    `INSERT INTO forum_threads (title, body, category_id, author_id, client_id, knowledge_item_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [body.title, body.body, body.categoryId, req.user!.id, body.clientId ?? null, body.knowledgeItemId ?? null]
  );
  await publish({
    type: "forum.thread.created",
    actor: actorOf(req),
    entityType: "forum_thread",
    entityId: rows[0].id,
    summary: `Abriu o tópico "${rows[0].title}" no fórum`,
  });
  res.status(201).json(rows[0]);
});

// POST /api/forum/threads/:id/replies - responde um tópico
forumRouter.post("/threads/:id/replies", async (req: AuthedRequest, res) => {
  const threadId = param(req.params.id);
  const body = parse(replySchema, req.body);

  const threadCheck = await pool.query(`SELECT id, title FROM forum_threads WHERE id = $1`, [threadId]);
  const thread = threadCheck.rows[0];
  if (!thread) throw notFound("Tópico não encontrado");

  const { rows } = await pool.query(
    `INSERT INTO forum_replies (body, thread_id, author_id) VALUES ($1,$2,$3) RETURNING *`,
    [body.body, threadId, req.user!.id]
  );
  await pool.query(`UPDATE forum_threads SET updated_at = now() WHERE id = $1`, [threadId]);
  await publish({
    type: "forum.reply.created",
    actor: actorOf(req),
    entityType: "forum_thread",
    entityId: threadId,
    summary: `Respondeu no tópico "${thread.title}"`,
    metadata: { threadId, threadTitle: thread.title, replyId: rows[0].id },
  });
  res.status(201).json(rows[0]);
});

// PATCH /api/forum/threads/:id - edita um tópico (autor ou admin)
forumRouter.patch("/threads/:id", async (req: AuthedRequest, res) => {
  const threadId = param(req.params.id);
  const body = parse(updateThreadSchema, req.body);

  const existing = await pool.query(`SELECT author_id FROM forum_threads WHERE id = $1`, [threadId]);
  if (!existing.rows[0]) throw notFound("Tópico não encontrado");
  if (!isOwnerOrAdmin(req.user, existing.rows[0].author_id)) {
    throw forbidden("Só o autor ou um admin pode editar este tópico");
  }

  const { rows } = await pool.query(
    `UPDATE forum_threads SET title = COALESCE($1, title), body = COALESCE($2, body), updated_at = now()
     WHERE id = $3 RETURNING *`,
    [body.title ?? null, body.body ?? null, threadId]
  );
  await publish({
    type: "forum.thread.updated",
    actor: actorOf(req),
    entityType: "forum_thread",
    entityId: threadId,
    summary: `Editou o tópico "${rows[0].title}"`,
  });
  res.json(rows[0]);
});

// DELETE /api/forum/threads/:id - apaga um tópico (autor ou admin); respostas somem em cascata
forumRouter.delete("/threads/:id", async (req: AuthedRequest, res) => {
  const threadId = param(req.params.id);
  const existing = await pool.query(`SELECT author_id, title FROM forum_threads WHERE id = $1`, [threadId]);
  if (!existing.rows[0]) throw notFound("Tópico não encontrado");
  if (!isOwnerOrAdmin(req.user, existing.rows[0].author_id)) {
    throw forbidden("Só o autor ou um admin pode apagar este tópico");
  }

  await pool.query(`DELETE FROM forum_threads WHERE id = $1`, [threadId]);
  await publish({
    type: "forum.thread.deleted",
    actor: actorOf(req),
    entityType: "forum_thread",
    entityId: threadId,
    // O título vai no log porque, depois de apagado, o registro não existe mais para consulta.
    summary: `Apagou o tópico "${existing.rows[0].title}" (e suas respostas)`,
  });
  res.status(204).send();
});

// POST /api/forum/threads/:id/accept { replyId | null } - marca (ou desmarca) a resposta que
// resolveu o tópico. Só o autor do tópico ou um admin.
forumRouter.post("/threads/:id/accept", async (req: AuthedRequest, res) => {
  const threadId = param(req.params.id);
  const { replyId } = parse(acceptSchema, req.body);

  const existing = await pool.query(`SELECT author_id, title FROM forum_threads WHERE id = $1`, [threadId]);
  const thread = existing.rows[0];
  if (!thread) throw notFound("Tópico não encontrado");
  if (!isOwnerOrAdmin(req.user, thread.author_id)) {
    throw forbidden("Só o autor do tópico ou um admin pode marcar a solução");
  }

  let replyAuthorId: string | null = null;
  if (replyId) {
    const reply = await pool.query(`SELECT author_id FROM forum_replies WHERE id = $1 AND thread_id = $2`, [
      replyId,
      threadId,
    ]);
    if (!reply.rows[0]) throw badRequest("Essa resposta não pertence a este tópico");
    replyAuthorId = reply.rows[0].author_id;
  }

  const { rows } = await pool.query(
    `UPDATE forum_threads SET accepted_reply_id = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [replyId, threadId]
  );
  await publish({
    type: replyId ? "forum.reply.accepted" : "forum.reply.unaccepted",
    actor: actorOf(req),
    entityType: "forum_thread",
    entityId: threadId,
    summary: replyId
      ? `Marcou uma resposta como solução do tópico "${thread.title}"`
      : `Desmarcou a solução do tópico "${thread.title}"`,
    metadata: { threadId, threadTitle: thread.title, replyId, replyAuthorId },
    contentChanged: false,
  });
  res.json(rows[0]);
});

// PATCH /api/forum/threads/:threadId/replies/:replyId - edita uma resposta (autor ou admin)
forumRouter.patch("/threads/:threadId/replies/:replyId", async (req: AuthedRequest, res) => {
  const threadId = param(req.params.threadId);
  const replyId = param(req.params.replyId);
  const body = parse(replySchema, req.body);

  const existing = await pool.query(`SELECT author_id FROM forum_replies WHERE id = $1 AND thread_id = $2`, [
    replyId,
    threadId,
  ]);
  if (!existing.rows[0]) throw notFound("Resposta não encontrada");
  if (!isOwnerOrAdmin(req.user, existing.rows[0].author_id)) {
    throw forbidden("Só o autor ou um admin pode editar esta resposta");
  }

  const { rows } = await pool.query(
    `UPDATE forum_replies SET body = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [body.body, replyId]
  );
  await publish({
    type: "forum.reply.updated",
    actor: actorOf(req),
    entityType: "forum_thread",
    entityId: threadId,
    summary: "Editou uma resposta no fórum",
    metadata: { replyId },
  });
  res.json(rows[0]);
});

// DELETE /api/forum/threads/:threadId/replies/:replyId - apaga uma resposta (autor ou admin)
forumRouter.delete("/threads/:threadId/replies/:replyId", async (req: AuthedRequest, res) => {
  const threadId = param(req.params.threadId);
  const replyId = param(req.params.replyId);

  const existing = await pool.query(`SELECT author_id FROM forum_replies WHERE id = $1 AND thread_id = $2`, [
    replyId,
    threadId,
  ]);
  if (!existing.rows[0]) throw notFound("Resposta não encontrada");
  if (!isOwnerOrAdmin(req.user, existing.rows[0].author_id)) {
    throw forbidden("Só o autor ou um admin pode apagar esta resposta");
  }

  await pool.query(`DELETE FROM forum_replies WHERE id = $1`, [replyId]);
  await publish({
    type: "forum.reply.deleted",
    actor: actorOf(req),
    entityType: "forum_thread",
    entityId: threadId,
    summary: "Apagou uma resposta no fórum",
    metadata: { replyId },
  });
  res.status(204).send();
});
