import { Router } from "express";
import { pool } from "../../db";
import { notFound } from "../../lib/errors";
import { parsePagination, paginatedResponse } from "../../lib/pagination";
import { param } from "../../lib/validate";
import { AuthedRequest, requireAuth } from "../auth/middleware";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

// GET /api/notifications?unread=1&limit=&offset= — notificações do usuário logado
notificationsRouter.get("/", async (req: AuthedRequest, res) => {
  const query = req.query as Record<string, string | undefined>;
  const pagination = parsePagination(query, 15);
  const onlyUnread = query.unread === "1" || query.unread === "true";
  const where = `WHERE user_id = $1 ${onlyUnread ? "AND read_at IS NULL" : ""}`;

  const [items, total, unread] = await Promise.all([
    pool.query(
      `SELECT id, type, title, body, link, read_at, created_at FROM notifications ${where}
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user!.id, pagination.limit, pagination.offset]
    ),
    pool.query(`SELECT COUNT(*) FROM notifications ${where}`, [req.user!.id]),
    pool.query(`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [req.user!.id]),
  ]);

  res.json({
    ...paginatedResponse(items.rows, Number(total.rows[0].count), pagination),
    unreadCount: Number(unread.rows[0].count),
  });
});

// GET /api/notifications/unread-count — leve, usado pelo sino para atualizar o contador
notificationsRouter.get("/unread-count", async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [
    req.user!.id,
  ]);
  res.json({ unreadCount: Number(rows[0].count) });
});

// POST /api/notifications/read-all
notificationsRouter.post("/read-all", async (req: AuthedRequest, res) => {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
    [req.user!.id]
  );
  res.json({ updated: rowCount ?? 0 });
});

// POST /api/notifications/:id/read
notificationsRouter.post("/:id/read", async (req: AuthedRequest, res) => {
  // O filtro por user_id garante que ninguém marca (ou descobre) notificação de outra pessoa.
  const { rows } = await pool.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING id, read_at`,
    [param(req.params.id), req.user!.id]
  );
  if (!rows[0]) throw notFound("Notificação não encontrada");
  res.json(rows[0]);
});
