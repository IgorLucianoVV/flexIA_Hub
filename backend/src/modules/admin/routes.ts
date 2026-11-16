import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { publish } from "../../lib/events";
import { parsePagination, paginatedResponse } from "../../lib/pagination";
import { escapeLike, param, parse, text } from "../../lib/validate";
import { actorOf, AuthedRequest, requireAuth, requireRole, ROLES } from "../auth/middleware";
import { endAllSessions } from "../auth/tokens";

/**
 * Painel de administração: usuários, log de auditoria e uso do Assistente de IA.
 * Tudo aqui é restrito a admin — antes, gerenciar contas exigia acesso direto ao banco.
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole("admin"));

const ROLE_LABELS: Record<string, string> = {
  dev: "Desenvolvedor(a)",
  analista_suporte: "Analista de Suporte",
  analista_ativacao: "Analista de Ativação",
  admin: "Admin",
};

const updateUserSchema = z
  .object({
    name: text(120, "name").optional(),
    role: z.enum(ROLES, { error: `role deve ser um de: ${ROLES.join(", ")}` }).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "informe ao menos um campo para atualizar");

const USER_COLUMNS = `id, name, email, role, is_active, created_at, updated_at, last_login_at`;

// GET /api/admin/users?q=&limit=&offset=
adminRouter.get("/users", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const pagination = parsePagination(query, 50);
  const params: unknown[] = [];
  let where = "";
  if (query.q?.trim()) {
    params.push(`%${escapeLike(query.q.trim().toLowerCase())}%`);
    where = `WHERE immutable_unaccent(lower(name)) LIKE immutable_unaccent($1) OR lower(email) LIKE $1`;
  }
  const [items, total] = await Promise.all([
    pool.query(
      `SELECT ${USER_COLUMNS} FROM users ${where}
        ORDER BY is_active DESC, name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pagination.limit, pagination.offset]
    ),
    pool.query(`SELECT COUNT(*) FROM users ${where}`, params),
  ]);
  res.json(paginatedResponse(items.rows, Number(total.rows[0].count), pagination));
});

// PATCH /api/admin/users/:id { name?, role?, isActive? }
adminRouter.patch("/users/:id", async (req: AuthedRequest, res) => {
  const userId = param(req.params.id);
  const body = parse(updateUserSchema, req.body);

  const existing = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
  const current = existing.rows[0];
  if (!current) throw notFound("Usuário não encontrado");

  const isSelf = userId === req.user!.id;
  const losesAdmin =
    current.role === "admin" && current.is_active && ((body.role && body.role !== "admin") || body.isActive === false);

  // Ninguém se tranca para fora: um admin não rebaixa nem desativa a si mesmo…
  if (isSelf && losesAdmin) {
    throw badRequest("Você não pode remover o seu próprio acesso de admin — peça a outro administrador.");
  }
  // …e o Hub nunca fica sem nenhum admin ativo.
  if (losesAdmin) {
    const admins = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = true`);
    if (Number(admins.rows[0].count) <= 1) {
      throw conflict("Este é o último admin ativo. Promova outra pessoa a admin antes.");
    }
  }

  const { rows } = await pool.query(
    `UPDATE users SET name = COALESCE($1::text, name), role = COALESCE($2::text, role),
            is_active = COALESCE($3::boolean, is_active),
            updated_at = now()
      WHERE id = $4 RETURNING ${USER_COLUMNS}`,
    [body.name ?? null, body.role ?? null, body.isActive ?? null, userId]
  );
  const updated = rows[0];

  if (body.isActive === false && current.is_active) {
    // Conta desativada: derruba as sessões abertas (o access token ainda vale até expirar,
    // no máximo ACCESS_TOKEN_TTL; não há como renová-lo depois disso).
    await endAllSessions(userId);
    await publish({
      type: "user.deactivated",
      actor: actorOf(req),
      entityType: "user",
      entityId: userId,
      summary: `Desativou a conta de ${updated.name} (${updated.email})`,
      contentChanged: false,
    });
  } else if (body.isActive === true && !current.is_active) {
    await publish({
      type: "user.reactivated",
      actor: actorOf(req),
      entityType: "user",
      entityId: userId,
      summary: `Reativou a conta de ${updated.name} (${updated.email})`,
      contentChanged: false,
    });
  }

  if (body.role && body.role !== current.role) {
    await publish({
      type: "user.role.changed",
      actor: actorOf(req),
      entityType: "user",
      entityId: userId,
      summary: `Alterou o papel de ${updated.name} de ${ROLE_LABELS[current.role]} para ${ROLE_LABELS[body.role]}`,
      metadata: { previousRole: current.role, role: body.role, roleLabel: ROLE_LABELS[body.role] },
      contentChanged: false,
    });
  }

  if (body.name && body.name !== current.name) {
    await publish({
      type: "user.updated",
      actor: actorOf(req),
      entityType: "user",
      entityId: userId,
      summary: `Renomeou o usuário ${current.name} para ${updated.name}`,
      contentChanged: false,
    });
  }

  res.json(updated);
});

// GET /api/admin/audit?actorId=&entityType=&action=&q=&limit=&offset=
adminRouter.get("/audit", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const pagination = parsePagination(query, 30);

  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown, clause: (p: string) => string) => {
    params.push(value);
    conditions.push(clause(`$${params.length}`));
  };
  if (query.actorId) add(query.actorId, (p) => `actor_id = ${p}`);
  if (query.entityType) add(query.entityType, (p) => `entity_type = ${p}`);
  if (query.entityId) add(query.entityId, (p) => `entity_id = ${p}`);
  // `action=forum` casa com forum.thread.created, forum.reply.created…
  if (query.action) add(`${escapeLike(query.action)}%`, (p) => `action LIKE ${p}`);
  if (query.q?.trim()) {
    add(
      `%${escapeLike(query.q.trim().toLowerCase())}%`,
      (p) =>
        `(immutable_unaccent(lower(summary)) LIKE immutable_unaccent(${p})
          OR immutable_unaccent(lower(actor_name)) LIKE immutable_unaccent(${p}))`
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [items, total] = await Promise.all([
    pool.query(
      `SELECT id, actor_id, actor_name, action, entity_type, entity_id, summary, metadata, created_at
         FROM audit_log ${where}
        ORDER BY created_at DESC, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pagination.limit, pagination.offset]
    ),
    pool.query(`SELECT COUNT(*) FROM audit_log ${where}`, params),
  ]);
  res.json(paginatedResponse(items.rows, Number(total.rows[0].count), pagination));
});

// GET /api/admin/assistant/insights — o que o time pergunta ao Assistente e como avalia as respostas.
// Serve para duas coisas: achar lacunas de conhecimento (perguntas sem boa resposta) e medir adoção.
adminRouter.get("/assistant/insights", async (_req, res) => {
  const [totals, recent, negative, perDay] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS questions,
              COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last_7_days,
              COUNT(DISTINCT user_id)::int AS users,
              COUNT(*) FILTER (WHERE feedback = 1)::int AS positive,
              COUNT(*) FILTER (WHERE feedback = -1)::int AS negative,
              COALESCE(ROUND(AVG(duration_ms)), 0)::int AS avg_duration_ms
         FROM assistant_interactions`
    ),
    pool.query(
      `SELECT i.id, i.question, i.feedback, i.ai_configured, i.created_at, u.name AS user_name
         FROM assistant_interactions i JOIN users u ON u.id = i.user_id
        ORDER BY i.created_at DESC LIMIT 25`
    ),
    pool.query(
      `SELECT i.id, i.question, i.answer, i.feedback_comment, i.created_at, u.name AS user_name
         FROM assistant_interactions i JOIN users u ON u.id = i.user_id
        WHERE i.feedback = -1 ORDER BY i.created_at DESC LIMIT 15`
    ),
    pool.query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS questions
         FROM assistant_interactions WHERE created_at >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 1`
    ),
  ]);
  res.json({ totals: totals.rows[0], recent: recent.rows, negative: negative.rows, perDay: perDay.rows });
});
