import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../../db";
import { badRequest, notFound } from "../../lib/errors";
import { publish } from "../../lib/events";
import { parsePagination, paginatedResponse } from "../../lib/pagination";
import { escapeLike, id, optionalDate, optionalId, optionalText, param, parse, text } from "../../lib/validate";
import { actorOf, AuthedRequest, requireAuth, requireRole } from "../auth/middleware";
import { recalculateClientHealth } from "../clients/healthScore";

export const activationRouter = Router();
activationRouter.use(requireAuth);

// Planejamento (criar projeto/fase/artefato) fica com admin e analista de ativação.
// Execução (atualizar status de um artefato) também libera dev, que é quem entrega o trabalho.
const PLANNERS = ["admin", "analista_ativacao"] as const;
const EXECUTORS = ["admin", "analista_ativacao", "dev"] as const;

const PROJECT_STATUSES = ["planejado", "em_andamento", "concluido", "atrasado"] as const;
const ARTIFACT_STATUSES = ["pendente", "em_andamento", "concluido", "bloqueado"] as const;
const ARTIFACT_TYPES = ["documento", "configuracao", "treinamento", "homologacao", "outro"] as const;

const templatePhases = z
  .array(
    z.object({
      name: text(120, "nome da fase"),
      artifacts: z
        .array(
          z.object({
            name: text(160, "nome do artefato"),
            type: z.enum(ARTIFACT_TYPES).optional(),
            dueOffsetDays: z.number().int().min(0).max(3650).optional(),
          })
        )
        .max(50)
        .default([]),
    })
  )
  .min(1, "o template precisa de pelo menos uma fase")
  .max(30);

const createTemplateSchema = z.object({
  name: text(120, "name"),
  description: optionalText(500),
  phases: templatePhases,
});

const createProjectSchema = z.object({
  name: text(160, "name"),
  clientId: id,
  ownerName: optionalText(120),
  startDate: optionalDate,
  targetDate: optionalDate,
  status: z.enum(PROJECT_STATUSES).optional(),
  templateId: optionalId,
});

const updateProjectSchema = z.object({
  name: text(160, "name").optional(),
  ownerName: z.union([z.string().trim().max(120), z.null()]).optional(),
  status: z.enum(PROJECT_STATUSES, { error: `status deve ser um de: ${PROJECT_STATUSES.join(", ")}` }).optional(),
  startDate: z.union([z.string(), z.null()]).optional(),
  targetDate: z.union([z.string(), z.null()]).optional(),
});

const createPhaseSchema = z.object({ name: text(120, "name"), order: z.number().int().min(0).optional() });

const createArtifactSchema = z.object({
  name: text(160, "name"),
  type: z.enum(ARTIFACT_TYPES).optional(),
  responsible: optionalText(120),
  dueDate: optionalDate,
});

const updateArtifactSchema = z
  .object({
    status: z.enum(ARTIFACT_STATUSES, { error: `status deve ser um de: ${ARTIFACT_STATUSES.join(", ")}` }).optional(),
    responsible: z.union([z.string().trim().max(120), z.null()]).optional(),
    dueDate: z.union([z.string(), z.null()]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "informe ao menos um campo para atualizar");

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

function addDays(start: string, days: number): string {
  const date = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}

/**
 * Deriva o status das fases e do projeto a partir dos artefatos, para ninguém precisar
 * manter isso à mão: fase conclui quando todos os artefatos concluem; projeto conclui
 * quando todos os artefatos de todas as fases concluem (e reabre se um deles for reaberto).
 */
async function syncProjectProgress(projectId: string) {
  await pool.query(
    `UPDATE activation_phases ph SET
        status = CASE
          WHEN stats.total > 0 AND stats.done = stats.total THEN 'concluido'
          WHEN stats.done > 0 OR stats.started > 0 THEN 'em_andamento'
          ELSE 'pendente'
        END,
        updated_at = now()
       FROM (
         SELECT p.id,
                COUNT(a.id) AS total,
                COUNT(a.id) FILTER (WHERE a.status = 'concluido') AS done,
                COUNT(a.id) FILTER (WHERE a.status IN ('em_andamento', 'bloqueado')) AS started
           FROM activation_phases p LEFT JOIN activation_artifacts a ON a.phase_id = p.id
          WHERE p.project_id = $1
          GROUP BY p.id
       ) stats
      WHERE ph.id = stats.id`,
    [projectId]
  );

  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.status, p.client_id, c.name AS client_name,
            COUNT(a.id) AS total,
            COUNT(a.id) FILTER (WHERE a.status = 'concluido') AS done
       FROM activation_projects p
       JOIN clients c ON c.id = p.client_id
       LEFT JOIN activation_phases ph ON ph.project_id = p.id
       LEFT JOIN activation_artifacts a ON a.phase_id = ph.id
      WHERE p.id = $1
      GROUP BY p.id, c.name`,
    [projectId]
  );
  const project = rows[0];
  if (!project) return null;

  const total = Number(project.total);
  const allDone = total > 0 && Number(project.done) === total;
  let completedNow = false;

  if (allDone && project.status !== "concluido") {
    await pool.query(`UPDATE activation_projects SET status = 'concluido', updated_at = now() WHERE id = $1`, [projectId]);
    completedNow = true;
  } else if (!allDone && project.status === "concluido") {
    await pool.query(`UPDATE activation_projects SET status = 'em_andamento', updated_at = now() WHERE id = $1`, [projectId]);
  }
  return { ...project, completedNow };
}

async function findProjectOr404(projectId: string) {
  const { rows } = await pool.query(
    `SELECT p.*, c.name AS client_name FROM activation_projects p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
    [projectId]
  );
  if (!rows[0]) throw notFound("Projeto não encontrado");
  return rows[0];
}

// GET /api/activation/projects?clientId=&status=&q=&limit=&offset=
// Lista paginada de projetos (com cliente, fases e artefatos aninhados), já com o cálculo
// de progresso, pronta para renderizar a lista vertical com barra de %.
activationRouter.get("/projects", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const pagination = parsePagination(query);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.clientId) {
    params.push(query.clientId);
    conditions.push(`p.client_id = $${params.length}`);
  }
  if (query.status === "atrasado") {
    // "Atrasado" inclui quem foi marcado assim e quem passou do prazo sem ninguém marcar.
    conditions.push(`(p.status = 'atrasado' OR (p.status <> 'concluido' AND p.target_date < CURRENT_DATE))`);
  } else if (query.status) {
    params.push(query.status);
    conditions.push(`p.status = $${params.length}`);
  }
  if (query.q?.trim()) {
    params.push(`%${escapeLike(query.q.trim().toLowerCase())}%`);
    conditions.push(
      `(immutable_unaccent(lower(p.name)) LIKE immutable_unaccent($${params.length})
        OR immutable_unaccent(lower(c.name)) LIKE immutable_unaccent($${params.length}))`
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [projectsResult, totalResult] = await Promise.all([
    pool.query(
      `SELECT p.*, c.name AS client_name,
              (p.status <> 'concluido' AND p.target_date IS NOT NULL AND p.target_date < CURRENT_DATE) AS is_overdue
         FROM activation_projects p JOIN clients c ON c.id = p.client_id
         ${where}
        ORDER BY p.created_at DESC, p.id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pagination.limit, pagination.offset]
    ),
    pool.query(
      `SELECT COUNT(*) FROM activation_projects p JOIN clients c ON c.id = p.client_id ${where}`,
      params
    ),
  ]);
  const projects = projectsResult.rows;
  const total = Number(totalResult.rows[0].count);

  if (projects.length === 0) return res.json(paginatedResponse([], total, pagination));

  // Fases e artefatos em 2 consultas para a página inteira (sem N+1).
  const projectIds = projects.map((p) => p.id);
  const { rows: phases } = await pool.query(
    `SELECT * FROM activation_phases WHERE project_id = ANY($1) ORDER BY "order" ASC, created_at ASC`,
    [projectIds]
  );
  const phaseIds = phases.map((p) => p.id);
  const { rows: artifacts } = phaseIds.length
    ? await pool.query(
        `SELECT *, (status <> 'concluido' AND due_date IS NOT NULL AND due_date < CURRENT_DATE) AS is_overdue
           FROM activation_artifacts WHERE phase_id = ANY($1) ORDER BY position ASC, created_at ASC, id`,
        [phaseIds]
      )
    : { rows: [] as any[] };

  const artifactsByPhase = new Map<string, any[]>();
  for (const a of artifacts) {
    if (!artifactsByPhase.has(a.phase_id)) artifactsByPhase.set(a.phase_id, []);
    artifactsByPhase.get(a.phase_id)!.push(a);
  }

  const phasesByProject = new Map<string, any[]>();
  for (const ph of phases) {
    const phaseArtifacts = artifactsByPhase.get(ph.id) ?? [];
    const count = phaseArtifacts.length;
    const done = phaseArtifacts.filter((a) => a.status === "concluido").length;
    const enriched = { ...ph, artifacts: phaseArtifacts, progressPct: count > 0 ? Math.round((done / count) * 100) : 0 };
    if (!phasesByProject.has(ph.project_id)) phasesByProject.set(ph.project_id, []);
    phasesByProject.get(ph.project_id)!.push(enriched);
  }

  const items = projects.map((p) => {
    const projPhases = phasesByProject.get(p.id) ?? [];
    const all = projPhases.flatMap((ph) => ph.artifacts);
    const doneArtifacts = all.filter((a: any) => a.status === "concluido").length;
    return {
      ...p,
      phases: projPhases,
      progressPct: all.length > 0 ? Math.round((doneArtifacts / all.length) * 100) : 0,
      totalArtifacts: all.length,
      doneArtifacts,
      overdueArtifacts: all.filter((a: any) => a.is_overdue).length,
    };
  });

  res.json(paginatedResponse(items, total, pagination));
});

// GET /api/activation/upcoming?days=7 — artefatos em aberto vencidos ou vencendo nos próximos N dias,
// de todos os projetos: o "o que precisa de atenção esta semana" que a barra de % não mostra.
activationRouter.get("/upcoming", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.status, a.responsible, to_char(a.due_date, 'YYYY-MM-DD') AS due_date,
            (a.due_date < CURRENT_DATE) AS is_overdue,
            ph.name AS phase_name, p.id AS project_id, p.name AS project_name,
            c.id AS client_id, c.name AS client_name
       FROM activation_artifacts a
       JOIN activation_phases ph ON ph.id = a.phase_id
       JOIN activation_projects p ON p.id = ph.project_id
       JOIN clients c ON c.id = p.client_id
      WHERE a.status <> 'concluido' AND a.due_date IS NOT NULL AND a.due_date <= CURRENT_DATE + $1::int
      ORDER BY a.due_date ASC, a.name
      LIMIT 50`,
    [days]
  );
  res.json({ days, items: rows });
});

// GET /api/activation/templates
activationRouter.get("/templates", async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM activation_templates ORDER BY name`);
  res.json(rows);
});

// POST /api/activation/templates
activationRouter.post("/templates", requireRole(...PLANNERS), async (req: AuthedRequest, res) => {
  const body = parse(createTemplateSchema, req.body);
  const { rows } = await pool.query(
    `INSERT INTO activation_templates (name, description, phases) VALUES ($1,$2,$3) RETURNING *`,
    [body.name, body.description ?? null, JSON.stringify(body.phases)]
  );
  await publish({
    type: "activation.template.created",
    actor: actorOf(req),
    entityType: "activation_template",
    entityId: rows[0].id,
    summary: `Criou o template de ativação "${rows[0].name}"`,
    contentChanged: false,
  });
  res.status(201).json(rows[0]);
});

// POST /api/activation/projects — com `templateId`, já cria as fases e os artefatos do template
activationRouter.post("/projects", requireRole(...PLANNERS), async (req: AuthedRequest, res) => {
  const body = parse(createProjectSchema, req.body);

  const clientResult = await pool.query(`SELECT name FROM clients WHERE id = $1`, [body.clientId]);
  if (!clientResult.rows[0]) throw badRequest("clientId não corresponde a nenhum cliente");

  let template: { id: string; name: string; phases: z.infer<typeof templatePhases> } | null = null;
  if (body.templateId) {
    const { rows } = await pool.query(`SELECT * FROM activation_templates WHERE id = $1`, [body.templateId]);
    if (!rows[0]) throw badRequest("templateId não corresponde a nenhum template");
    template = rows[0];
  }

  const startDate = body.startDate?.slice(0, 10) ?? (template ? isoDay(new Date()) : null);
  // Sem prazo informado, o prazo do projeto vira o do último artefato do template.
  const lastOffset = template
    ? Math.max(0, ...template.phases.flatMap((ph) => ph.artifacts.map((a) => a.dueOffsetDays ?? 0)))
    : 0;
  const targetDate = body.targetDate?.slice(0, 10) ?? (template && startDate && lastOffset > 0 ? addDays(startDate, lastOffset) : null);

  // Projeto + fases + artefatos numa transação: ou nasce completo, ou não nasce.
  const project = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO activation_projects (name, client_id, owner_name, start_date, target_date, status, template_id)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6,'em_andamento'), $7) RETURNING *`,
      [body.name, body.clientId, body.ownerName ?? null, startDate, targetDate, body.status ?? null, template?.id ?? null]
    );
    const created = rows[0];
    if (template) {
      for (const [order, phase] of template.phases.entries()) {
        const phaseResult = await client.query(
          `INSERT INTO activation_phases (name, "order", project_id) VALUES ($1,$2,$3) RETURNING id`,
          [phase.name, order, created.id]
        );
        for (const [position, artifact] of phase.artifacts.entries()) {
          const dueDate =
            startDate && artifact.dueOffsetDays !== undefined ? addDays(startDate, artifact.dueOffsetDays) : null;
          await client.query(
            `INSERT INTO activation_artifacts (name, type, responsible, due_date, phase_id, position)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [artifact.name, artifact.type ?? null, body.ownerName ?? null, dueDate, phaseResult.rows[0].id, position]
          );
        }
      }
    }
    return created;
  });

  await publish({
    type: "activation.project.created",
    actor: actorOf(req),
    entityType: "activation_project",
    entityId: project.id,
    summary:
      `Criou o projeto de ativação "${project.name}" para ${clientResult.rows[0].name}` +
      (template ? ` a partir do template "${template.name}"` : ""),
    metadata: { clientId: body.clientId, templateId: template?.id ?? null },
  });
  res.status(201).json(project);
});

// PATCH /api/activation/projects/:id
activationRouter.patch("/projects/:id", requireRole(...PLANNERS), async (req: AuthedRequest, res) => {
  const projectId = param(req.params.id);
  const current = await findProjectOr404(projectId);
  const body = parse(updateProjectSchema, req.body);

  const columns: Record<string, unknown> = {};
  if (body.name !== undefined) columns.name = body.name;
  if (body.ownerName !== undefined) columns.owner_name = body.ownerName || null;
  if (body.status !== undefined) columns.status = body.status;
  if (body.startDate !== undefined) columns.start_date = body.startDate || null;
  if (body.targetDate !== undefined) columns.target_date = body.targetDate || null;
  const names = Object.keys(columns);
  if (names.length === 0) throw badRequest("Nenhum campo para atualizar");

  const { rows } = await pool.query(
    `UPDATE activation_projects SET ${names.map((n, i) => `${n} = $${i + 1}`).join(", ")}, updated_at = now()
      WHERE id = $${names.length + 1} RETURNING *`,
    [...names.map((n) => columns[n]), projectId]
  );
  await publish({
    type: "activation.project.updated",
    actor: actorOf(req),
    entityType: "activation_project",
    entityId: projectId,
    summary: `Editou o projeto de ativação "${rows[0].name}" (${names.join(", ")})`,
    metadata: { fields: names },
  });
  // Prazo ou status mudaram: o atraso do projeto pesa no health score do cliente.
  await recalculateClientHealth(current.client_id);
  res.json(rows[0]);
});

// DELETE /api/activation/projects/:id — fases e artefatos somem em cascata
activationRouter.delete("/projects/:id", requireRole(...PLANNERS), async (req: AuthedRequest, res) => {
  const projectId = param(req.params.id);
  const project = await findProjectOr404(projectId);
  await pool.query(`DELETE FROM activation_projects WHERE id = $1`, [projectId]);
  await publish({
    type: "activation.project.deleted",
    actor: actorOf(req),
    entityType: "activation_project",
    entityId: projectId,
    summary: `Apagou o projeto de ativação "${project.name}" (${project.client_name})`,
  });
  await recalculateClientHealth(project.client_id);
  res.status(204).send();
});

activationRouter.post("/projects/:projectId/phases", requireRole(...PLANNERS), async (req: AuthedRequest, res) => {
  const projectId = param(req.params.projectId);
  const project = await findProjectOr404(projectId);
  const body = parse(createPhaseSchema, req.body);
  const { rows } = await pool.query(
    `INSERT INTO activation_phases (name, "order", project_id)
     VALUES ($1, COALESCE($2, (SELECT COALESCE(MAX("order") + 1, 0) FROM activation_phases WHERE project_id = $3)), $3)
     RETURNING *`,
    [body.name, body.order ?? null, projectId]
  );
  await publish({
    type: "activation.phase.created",
    actor: actorOf(req),
    entityType: "activation_project",
    entityId: projectId,
    summary: `Adicionou a fase "${body.name}" ao projeto "${project.name}"`,
  });
  res.status(201).json(rows[0]);
});

activationRouter.post("/phases/:phaseId/artifacts", requireRole(...PLANNERS), async (req: AuthedRequest, res) => {
  const phaseId = param(req.params.phaseId);
  const phaseResult = await pool.query(
    `SELECT ph.id, ph.name, ph.project_id, p.name AS project_name
       FROM activation_phases ph JOIN activation_projects p ON p.id = ph.project_id WHERE ph.id = $1`,
    [phaseId]
  );
  const phase = phaseResult.rows[0];
  if (!phase) throw notFound("Fase não encontrada");

  const body = parse(createArtifactSchema, req.body);
  const { rows } = await pool.query(
    `INSERT INTO activation_artifacts (name, type, responsible, due_date, phase_id, position)
     VALUES ($1,$2,$3,$4,$5, (SELECT COALESCE(MAX(position) + 1, 0) FROM activation_artifacts WHERE phase_id = $5))
     RETURNING *`,
    [body.name, body.type ?? null, body.responsible ?? null, body.dueDate ?? null, phaseId]
  );
  await syncProjectProgress(phase.project_id);
  await publish({
    type: "activation.artifact.created",
    actor: actorOf(req),
    entityType: "activation_project",
    entityId: phase.project_id,
    summary: `Adicionou o artefato "${body.name}" à fase "${phase.name}" do projeto "${phase.project_name}"`,
  });
  res.status(201).json(rows[0]);
});

// PATCH /api/activation/artifacts/:id - atualizar status/responsável/prazo de um artefato
activationRouter.patch("/artifacts/:id", requireRole(...EXECUTORS), async (req: AuthedRequest, res) => {
  const artifactId = param(req.params.id);
  const body = parse(updateArtifactSchema, req.body);

  const columns: Record<string, unknown> = {};
  if (body.status !== undefined) {
    columns.status = body.status;
    columns.completed_at = body.status === "concluido" ? new Date() : null;
  }
  if (body.responsible !== undefined) columns.responsible = body.responsible || null;
  if (body.dueDate !== undefined) columns.due_date = body.dueDate || null;
  const names = Object.keys(columns);

  const { rows } = await pool.query(
    `UPDATE activation_artifacts SET ${names.map((n, i) => `${n} = $${i + 1}`).join(", ")}, updated_at = now()
      WHERE id = $${names.length + 1} RETURNING *`,
    [...names.map((n) => columns[n]), artifactId]
  );
  const artifact = rows[0];
  if (!artifact) throw notFound("Artefato não encontrado");

  const phaseResult = await pool.query(`SELECT project_id FROM activation_phases WHERE id = $1`, [artifact.phase_id]);
  const project = await syncProjectProgress(phaseResult.rows[0].project_id);

  if (project) {
    await publish({
      type: "activation.artifact.updated",
      actor: actorOf(req),
      entityType: "activation_project",
      entityId: project.id,
      summary:
        body.status !== undefined
          ? `Marcou o artefato "${artifact.name}" como ${body.status.replace("_", " ")} no projeto "${project.name}"`
          : `Editou o artefato "${artifact.name}" do projeto "${project.name}"`,
      metadata: { artifactId, fields: Object.keys(body) },
    });
    if (project.completedNow) {
      await publish({
        type: "activation.project.completed",
        actor: actorOf(req),
        entityType: "activation_project",
        entityId: project.id,
        summary: `Projeto de ativação "${project.name}" (${project.client_name}) concluído: todos os artefatos entregues`,
        metadata: { projectName: project.name, clientName: project.client_name },
      });
    }
    // O progresso do projeto mudou — recalcula o health score do cliente dono desse projeto.
    await recalculateClientHealth(project.client_id);
  }

  res.json(artifact);
});
