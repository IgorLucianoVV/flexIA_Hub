import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { notFound } from "../../lib/errors";
import { publish } from "../../lib/events";
import { parsePagination, paginatedResponse } from "../../lib/pagination";
import { escapeLike, optionalText, param, parse, text } from "../../lib/validate";
import { actorOf, AuthedRequest, requireAuth, requireRole } from "../auth/middleware";
import { recalculateClientHealth } from "./healthScore";

export const clientsRouter = Router();
// Todo o módulo exige login: são dados de cliente (documentos, alertas, métricas).
clientsRouter.use(requireAuth);

const CLICKUP_TASKS_FIRST_PAGE = 20;
const HEALTH_HISTORY_DAYS = 90;
// Quem cuida da relação com o cliente pode registrar alertas e documentos.
const CLIENT_EDITORS = ["admin", "analista_ativacao", "analista_suporte"] as const;

const createClientSchema = z.object({
  name: text(160, "name"),
  segment: optionalText(120),
  csmOwner: optionalText(120),
  status: z.enum(["ativo", "pausado", "encerrado"]).optional(),
});

const createAlertSchema = z.object({
  severity: z.enum(["baixa", "media", "alta", "critica"], { error: "severity deve ser baixa, media, alta ou critica" }),
  message: text(500, "message"),
});

const createDocumentSchema = z.object({
  title: text(200, "title"),
  url: optionalText(1000),
  category: optionalText(80),
  source: z.enum(["gitlab", "drive", "manual"]).default("manual"),
});

async function findClientOr404(clientId: string) {
  const { rows } = await pool.query(`SELECT * FROM clients WHERE id = $1`, [clientId]);
  if (!rows[0]) throw notFound("Cliente não encontrado");
  return rows[0];
}

// GET /api/clients?q=&status=&sort=name|health&limit=&offset=
// Lista paginada, com contagem de alertas abertos e de projetos de ativação por cliente.
clientsRouter.get("/", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const pagination = parsePagination(query, 50);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.q?.trim()) {
    params.push(`%${escapeLike(query.q.trim().toLowerCase())}%`);
    conditions.push(
      `(immutable_unaccent(lower(c.name)) LIKE immutable_unaccent($${params.length})
        OR immutable_unaccent(lower(COALESCE(c.segment, ''))) LIKE immutable_unaccent($${params.length}))`
    );
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`c.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  // Ordenação vem de uma lista fixa (nunca do texto do usuário direto no SQL).
  const orderBy = query.sort === "health" ? "c.health_score ASC NULLS LAST, c.name ASC" : "c.name ASC";

  const [items, total] = await Promise.all([
    pool.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM client_alerts a WHERE a.client_id = c.id AND a.resolved = false) AS open_alerts,
        (SELECT COUNT(*) FROM activation_projects p WHERE p.client_id = c.id) AS activation_projects_count
       FROM clients c ${where}
       ORDER BY ${orderBy}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pagination.limit, pagination.offset]
    ),
    pool.query(`SELECT COUNT(*) FROM clients c ${where}`, params),
  ]);

  res.json(paginatedResponse(items.rows, Number(total.rows[0].count), pagination));
});

// GET /api/clients/:id - detalhe básico
clientsRouter.get("/:id", async (req, res) => {
  res.json(await findClientOr404(param(req.params.id)));
});

// POST /api/clients - cria cliente (restrito: admin ou analista de ativação)
clientsRouter.post("/", requireRole("admin", "analista_ativacao"), async (req: AuthedRequest, res) => {
  const body = parse(createClientSchema, req.body);
  const { rows } = await pool.query(
    `INSERT INTO clients (name, segment, csm_owner, status) VALUES ($1,$2,$3, COALESCE($4,'ativo')) RETURNING *`,
    [body.name, body.segment ?? null, body.csmOwner ?? null, body.status ?? null]
  );
  await publish({
    type: "client.created",
    actor: actorOf(req),
    entityType: "client",
    entityId: rows[0].id,
    summary: `Cadastrou o cliente ${rows[0].name}`,
  });
  res.status(201).json(rows[0]);
});

// GET /api/clients/:id/360 - Visão 360 do cliente: tasks ClickUp, docs, alertas, métricas,
// projetos de ativação, composição e histórico do health score.
clientsRouter.get("/:id/360", async (req, res) => {
  const clientId = param(req.params.id);
  await findClientOr404(clientId);

  // Health score e alertas automáticos são recalculados a cada visita à Visão 360,
  // então o que aparece na tela reflete o estado atual das tasks/projetos, não um
  // número parado desde a última vez que alguém digitou algo.
  await recalculateClientHealth(clientId);

  const [clientResult, tasks, tasksCount, documents, alerts, metrics, projects, history] = await Promise.all([
    pool.query(`SELECT * FROM clients WHERE id = $1`, [clientId]),
    pool.query(
      `SELECT * FROM clickup_task_cache WHERE client_id = $1 ORDER BY due_date ASC NULLS LAST LIMIT $2`,
      [clientId, CLICKUP_TASKS_FIRST_PAGE]
    ),
    pool.query(`SELECT COUNT(*) FROM clickup_task_cache WHERE client_id = $1`, [clientId]),
    pool.query(`SELECT * FROM client_documents WHERE client_id = $1 ORDER BY updated_at DESC`, [clientId]),
    pool.query(
      `SELECT * FROM client_alerts WHERE client_id = $1 ORDER BY resolved ASC, created_at DESC LIMIT 50`,
      [clientId]
    ),
    pool.query(
      `SELECT * FROM client_metrics WHERE client_id = $1 ORDER BY period DESC, metric_key ASC LIMIT 50`,
      [clientId]
    ),
    pool.query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM activation_artifacts art
           JOIN activation_phases ph ON ph.id = art.phase_id
           WHERE ph.project_id = p.id) AS total_artifacts,
        (SELECT COUNT(*) FROM activation_artifacts art
           JOIN activation_phases ph ON ph.id = art.phase_id
           WHERE ph.project_id = p.id AND art.status = 'concluido') AS done_artifacts
       FROM activation_projects p WHERE p.client_id = $1 ORDER BY p.created_at DESC`,
      [clientId]
    ),
    pool.query(
      `SELECT score, to_char(recorded_on, 'YYYY-MM-DD') AS date FROM client_health_history
        WHERE client_id = $1 AND recorded_on >= CURRENT_DATE - $2::int
        ORDER BY recorded_on ASC`,
      [clientId, HEALTH_HISTORY_DAYS]
    ),
  ]);

  const projectsWithProgress = projects.rows.map((p) => {
    const total = Number(p.total_artifacts) || 0;
    const done = Number(p.done_artifacts) || 0;
    return { ...p, progressPct: total > 0 ? Math.round((done / total) * 100) : 0 };
  });

  res.json({
    client: clientResult.rows[0],
    clickupTasks: tasks.rows,
    clickupTasksTotal: Number(tasksCount.rows[0].count),
    documents: documents.rows,
    alerts: alerts.rows,
    metrics: metrics.rows,
    activationProjects: projectsWithProgress,
    healthHistory: history.rows,
  });
});

// GET /api/clients/:id/clickup-tasks?limit=&offset= - paginação da lista de tasks (usado pelo "carregar mais")
clientsRouter.get("/:id/clickup-tasks", async (req, res) => {
  const clientId = param(req.params.id);
  const pagination = parsePagination(req.query as Record<string, string | undefined>, CLICKUP_TASKS_FIRST_PAGE);

  const countResult = await pool.query(`SELECT COUNT(*) FROM clickup_task_cache WHERE client_id = $1`, [clientId]);
  const { rows } = await pool.query(
    `SELECT * FROM clickup_task_cache WHERE client_id = $1 ORDER BY due_date ASC NULLS LAST LIMIT $2 OFFSET $3`,
    [clientId, pagination.limit, pagination.offset]
  );
  res.json(paginatedResponse(rows, Number(countResult.rows[0].count), pagination));
});

// POST /api/clients/:id/recalculate-health - força o recálculo do health score e dos
// alertas automáticos fora do fluxo normal (a Visão 360 já recalcula sozinha ao abrir).
clientsRouter.post("/:id/recalculate-health", async (req, res) => {
  const clientId = param(req.params.id);
  await findClientOr404(clientId);
  res.json(await recalculateClientHealth(clientId));
});

// POST /api/clients/:id/alerts - abre um alerta manual (pesa no health score)
clientsRouter.post("/:id/alerts", requireRole(...CLIENT_EDITORS), async (req: AuthedRequest, res) => {
  const clientId = param(req.params.id);
  const client = await findClientOr404(clientId);
  const body = parse(createAlertSchema, req.body);

  const { rows } = await pool.query(
    `INSERT INTO client_alerts (client_id, severity, message, source) VALUES ($1,$2,$3,$4) RETURNING *`,
    [clientId, body.severity, body.message, `Manual (${req.user!.name})`]
  );
  await publish({
    type: "client.alert.opened",
    actor: actorOf(req),
    entityType: "client",
    entityId: clientId,
    summary: `Abriu um alerta de severidade ${body.severity} para ${client.name}: ${body.message}`,
    metadata: { clientName: client.name, severity: body.severity, message: body.message, alertId: rows[0].id },
  });
  await recalculateClientHealth(clientId);
  res.status(201).json(rows[0]);
});

// POST /api/clients/:id/alerts/:alertId/resolve - resolve um alerta
clientsRouter.post("/:id/alerts/:alertId/resolve", requireRole(...CLIENT_EDITORS), async (req: AuthedRequest, res) => {
  const clientId = param(req.params.id);
  const client = await findClientOr404(clientId);
  const { rows } = await pool.query(
    `UPDATE client_alerts SET resolved = true, resolved_at = now(), updated_at = now()
      WHERE id = $1 AND client_id = $2 AND resolved = false RETURNING *`,
    [param(req.params.alertId), clientId]
  );
  if (!rows[0]) throw notFound("Alerta não encontrado ou já resolvido");
  await publish({
    type: "client.alert.resolved",
    actor: actorOf(req),
    entityType: "client",
    entityId: clientId,
    summary: `Resolveu um alerta de ${client.name}: ${rows[0].message}`,
    metadata: { clientName: client.name, alertId: rows[0].id },
  });
  await recalculateClientHealth(clientId);
  res.json(rows[0]);
});

// POST /api/clients/:id/documents - associa um documento (link) ao cliente
clientsRouter.post("/:id/documents", requireRole(...CLIENT_EDITORS), async (req: AuthedRequest, res) => {
  const clientId = param(req.params.id);
  const client = await findClientOr404(clientId);
  const body = parse(createDocumentSchema, req.body);
  const { rows } = await pool.query(
    `INSERT INTO client_documents (client_id, title, source, url, category) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [clientId, body.title, body.source, body.url ?? null, body.category ?? null]
  );
  await publish({
    type: "client.document.added",
    actor: actorOf(req),
    entityType: "client",
    entityId: clientId,
    summary: `Adicionou o documento "${body.title}" ao cliente ${client.name}`,
    metadata: { documentId: rows[0].id },
  });
  res.status(201).json(rows[0]);
});
