import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { publish } from "../../lib/events";
import { parsePagination, paginatedResponse } from "../../lib/pagination";
import { escapeLike, id, optionalId, optionalText, param, parse, text } from "../../lib/validate";
import { actorOf, AuthedRequest, requireAuth, requireRole } from "../auth/middleware";
import { syncGitlabCatalog } from "../integrations/gitlab/client";
import { computeScorecard } from "./scorecard";

export const knowledgeRouter = Router();
knowledgeRouter.use(requireAuth);

const KNOWLEDGE_TYPES = ["agente_ia", "chatbot", "instruction", "arvore_dialogo", "integracao", "infraestrutura"] as const;
const KNOWLEDGE_STATUSES = ["ativo", "em_revisao", "deprecado"] as const;
// Cadastro e manutenção manual do catálogo ficam com admin e dev (o sync do GitLab é o caminho normal).
const CATALOG_EDITORS = ["admin", "dev"] as const;

const tags = z
  .array(z.string().trim().toLowerCase().min(1).max(40))
  .max(20, "no máximo 20 tags")
  .transform((list) => [...new Set(list)]);

const createSchema = z.object({
  type: z.enum(KNOWLEDGE_TYPES, { error: `type deve ser um de: ${KNOWLEDGE_TYPES.join(", ")}` }),
  name: text(160, "name"),
  description: optionalText(2000),
  ownerTeam: optionalText(120),
  tags: tags.optional(),
  clientId: optionalId,
  gitlabWebUrl: optionalText(1000),
});

// No PATCH, `null` significa "limpar o campo" e ausência significa "não mexer".
const nullableText = (max: number) => z.union([z.string().trim().max(max), z.null()]).optional();
const updateSchema = z.object({
  type: z.enum(KNOWLEDGE_TYPES).optional(),
  name: text(160, "name").optional(),
  description: nullableText(2000),
  ownerTeam: nullableText(120),
  tags: tags.optional(),
  status: z.enum(KNOWLEDGE_STATUSES, { error: `status deve ser um de: ${KNOWLEDGE_STATUSES.join(", ")}` }).optional(),
  deprecationNote: nullableText(500),
  replacedById: z.union([z.string().trim().min(1), z.null()]).optional(),
  clientId: z.union([z.string().trim().min(1), z.null()]).optional(),
  gitlabWebUrl: nullableText(1000),
});

const relationSchema = z.object({ toId: id });

const withScorecard = <T extends Parameters<typeof computeScorecard>[0]>(item: T) => ({
  ...item,
  scorecard: computeScorecard(item),
});

async function findItemOr404(itemId: string) {
  const { rows } = await pool.query(`SELECT * FROM knowledge_items WHERE id = $1`, [itemId]);
  if (!rows[0]) throw notFound("Item não encontrado");
  return rows[0];
}

// GET /api/knowledge?type=&tag=&q=&ownerTeam=&status=&clientId=&limit=&offset=
knowledgeRouter.get("/", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const pagination = parsePagination(query);

  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown, clause: (placeholder: string) => string) => {
    params.push(value);
    conditions.push(clause(`$${params.length}`));
  };

  if (query.type) add(query.type, (p) => `k.type = ${p}`);
  if (query.ownerTeam) add(query.ownerTeam, (p) => `k.owner_team = ${p}`);
  if (query.status) add(query.status, (p) => `k.status = ${p}`);
  if (query.clientId) add(query.clientId, (p) => `k.client_id = ${p}`);
  if (query.tag) add(query.tag, (p) => `${p} = ANY(k.tags)`);
  if (query.q?.trim()) {
    add(
      `%${escapeLike(query.q.trim().toLowerCase())}%`,
      (p) =>
        `(immutable_unaccent(lower(k.name)) LIKE immutable_unaccent(${p})
          OR immutable_unaccent(lower(COALESCE(k.description, ''))) LIKE immutable_unaccent(${p})
          OR EXISTS (SELECT 1 FROM unnest(k.tags) tg WHERE immutable_unaccent(lower(tg)) LIKE immutable_unaccent(${p})))`
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [items, total] = await Promise.all([
    pool.query(
      `SELECT k.*, c.name AS client_name,
          (SELECT COUNT(*) FROM knowledge_relations r WHERE r.from_id = k.id)::int AS depends_on_count,
          (SELECT COUNT(*) FROM knowledge_relations r WHERE r.to_id = k.id)::int AS dependents_count
       FROM knowledge_items k LEFT JOIN clients c ON c.id = k.client_id
       ${where}
       ORDER BY k.updated_at DESC, k.name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pagination.limit, pagination.offset]
    ),
    pool.query(`SELECT COUNT(*) FROM knowledge_items k ${where}`, params),
  ]);

  res.json(paginatedResponse(items.rows.map(withScorecard), Number(total.rows[0].count), pagination));
});

// GET /api/knowledge/governance — retrato da governança do catálogo inteiro (para o painel)
knowledgeRouter.get("/governance", async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM knowledge_items`);
  const scored = rows.map(withScorecard);
  const byLevel = { ouro: 0, prata: 0, bronze: 0, inicial: 0 };
  for (const item of scored) byLevel[item.scorecard.level]++;

  // Quais verificações mais falham: indica onde o esforço de governança rende mais.
  const failures = new Map<string, { key: string; label: string; failing: number }>();
  for (const item of scored) {
    for (const check of item.scorecard.checks) {
      if (check.passed) continue;
      const entry = failures.get(check.key) ?? { key: check.key, label: check.label, failing: 0 };
      entry.failing++;
      failures.set(check.key, entry);
    }
  }

  res.json({
    total: scored.length,
    averageScore: scored.length ? Math.round(scored.reduce((s, i) => s + i.scorecard.score, 0) / scored.length) : 0,
    byLevel,
    stale: scored.filter((i) => i.scorecard.stale).length,
    withoutOwner: scored.filter((i) => !i.owner_team).length,
    deprecated: scored.filter((i) => i.status === "deprecado").length,
    topFailingChecks: [...failures.values()].sort((a, b) => b.failing - a.failing),
  });
});

// GET /api/knowledge/:id — item + scorecard + dependências (dos dois lados) + tópicos do fórum
knowledgeRouter.get("/:id", async (req, res) => {
  const itemId = param(req.params.id);
  const { rows } = await pool.query(
    `SELECT k.*, c.name AS client_name, rb.name AS replaced_by_name
       FROM knowledge_items k
       LEFT JOIN clients c ON c.id = k.client_id
       LEFT JOIN knowledge_items rb ON rb.id = k.replaced_by_id
      WHERE k.id = $1`,
    [itemId]
  );
  if (!rows[0]) throw notFound("Item não encontrado");

  const [dependsOn, dependents, threads] = await Promise.all([
    pool.query(
      `SELECT r.id AS relation_id, k.id, k.name, k.type, k.status
         FROM knowledge_relations r JOIN knowledge_items k ON k.id = r.to_id
        WHERE r.from_id = $1 ORDER BY k.name`,
      [itemId]
    ),
    pool.query(
      `SELECT r.id AS relation_id, k.id, k.name, k.type, k.status
         FROM knowledge_relations r JOIN knowledge_items k ON k.id = r.from_id
        WHERE r.to_id = $1 ORDER BY k.name`,
      [itemId]
    ),
    pool.query(
      `SELECT t.id, t.title, t.created_at, (SELECT COUNT(*) FROM forum_replies r WHERE r.thread_id = t.id)::int AS reply_count
         FROM forum_threads t WHERE t.knowledge_item_id = $1 ORDER BY t.created_at DESC LIMIT 10`,
      [itemId]
    ),
  ]);

  res.json({
    item: withScorecard(rows[0]),
    dependsOn: dependsOn.rows,
    dependents: dependents.rows,
    threads: threads.rows,
  });
});

// POST /api/knowledge — cadastro manual de item do catálogo
knowledgeRouter.post("/", requireRole(...CATALOG_EDITORS), async (req: AuthedRequest, res) => {
  const body = parse(createSchema, req.body);
  const { rows } = await pool.query(
    `INSERT INTO knowledge_items (type, name, description, owner_team, tags, client_id, gitlab_web_url, last_reviewed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now()) RETURNING *`,
    [
      body.type,
      body.name,
      body.description ?? null,
      body.ownerTeam ?? null,
      body.tags ?? [],
      body.clientId ?? null,
      body.gitlabWebUrl ?? null,
    ]
  );
  await publish({
    type: "knowledge.item.created",
    actor: actorOf(req),
    entityType: "knowledge_item",
    entityId: rows[0].id,
    summary: `Cadastrou "${rows[0].name}" no catálogo (${rows[0].type})`,
  });
  res.status(201).json(withScorecard(rows[0]));
});

// PATCH /api/knowledge/:id — edita metadados e ciclo de vida
knowledgeRouter.patch("/:id", requireRole(...CATALOG_EDITORS), async (req: AuthedRequest, res) => {
  const itemId = param(req.params.id);
  const current = await findItemOr404(itemId);
  const body = parse(updateSchema, req.body);

  if (body.replacedById === itemId) throw badRequest("Um item não pode ser substituído por ele mesmo");

  // Monta o UPDATE só com os campos enviados; nomes de coluna vêm deste mapa fixo.
  const columns: Record<string, unknown> = {};
  if (body.type !== undefined) columns.type = body.type;
  if (body.name !== undefined) columns.name = body.name;
  if (body.description !== undefined) columns.description = body.description || null;
  if (body.ownerTeam !== undefined) columns.owner_team = body.ownerTeam || null;
  if (body.tags !== undefined) columns.tags = body.tags;
  if (body.status !== undefined) columns.status = body.status;
  if (body.deprecationNote !== undefined) columns.deprecation_note = body.deprecationNote || null;
  if (body.replacedById !== undefined) columns.replaced_by_id = body.replacedById;
  if (body.clientId !== undefined) columns.client_id = body.clientId;
  if (body.gitlabWebUrl !== undefined) columns.gitlab_web_url = body.gitlabWebUrl || null;

  const names = Object.keys(columns);
  if (names.length === 0) throw badRequest("Nenhum campo para atualizar");

  const assignments = names.map((name, i) => `${name} = $${i + 1}`).join(", ");
  const { rows } = await pool.query(
    `UPDATE knowledge_items SET ${assignments}, updated_at = now() WHERE id = $${names.length + 1} RETURNING *`,
    [...names.map((n) => columns[n]), itemId]
  );
  const updated = rows[0];

  const becameDeprecated = body.status === "deprecado" && current.status !== "deprecado";
  if (becameDeprecated) {
    const dependents = await pool.query(`SELECT COUNT(*) FROM knowledge_relations WHERE to_id = $1`, [itemId]);
    await publish({
      type: "knowledge.item.deprecated",
      actor: actorOf(req),
      entityType: "knowledge_item",
      entityId: itemId,
      summary: `Marcou "${updated.name}" como descontinuado no catálogo`,
      metadata: { name: updated.name, dependentsCount: Number(dependents.rows[0].count) },
    });
  } else {
    await publish({
      type: "knowledge.item.updated",
      actor: actorOf(req),
      entityType: "knowledge_item",
      entityId: itemId,
      summary: `Editou "${updated.name}" no catálogo (${names.join(", ")})`,
      metadata: { fields: names },
    });
  }

  res.json(withScorecard(updated));
});

// POST /api/knowledge/:id/review — "conferi, está em dia": zera o relógio de revisão
knowledgeRouter.post("/:id/review", requireRole(...CATALOG_EDITORS), async (req: AuthedRequest, res) => {
  const itemId = param(req.params.id);
  const { rows } = await pool.query(
    `UPDATE knowledge_items SET last_reviewed_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
    [itemId]
  );
  if (!rows[0]) throw notFound("Item não encontrado");
  await publish({
    type: "knowledge.item.reviewed",
    actor: actorOf(req),
    entityType: "knowledge_item",
    entityId: itemId,
    summary: `Revisou "${rows[0].name}" no catálogo`,
    contentChanged: false,
  });
  res.json(withScorecard(rows[0]));
});

// POST /api/knowledge/:id/relations { toId } — "este item depende de toId"
knowledgeRouter.post("/:id/relations", requireRole(...CATALOG_EDITORS), async (req: AuthedRequest, res) => {
  const fromId = param(req.params.id);
  const { toId } = parse(relationSchema, req.body);
  if (fromId === toId) throw badRequest("Um item não pode depender dele mesmo");

  const [from, to] = await Promise.all([findItemOr404(fromId), findItemOr404(toId)]);

  // Impede ciclo: se `to` já depende (direta ou indiretamente) de `from`, a nova relação fecharia um laço.
  const cycle = await pool.query(
    `WITH RECURSIVE reachable AS (
        SELECT to_id FROM knowledge_relations WHERE from_id = $1
        UNION
        SELECT r.to_id FROM knowledge_relations r JOIN reachable x ON r.from_id = x.to_id
     )
     SELECT 1 FROM reachable WHERE to_id = $2 LIMIT 1`,
    [toId, fromId]
  );
  if (cycle.rows[0]) {
    throw conflict(`"${to.name}" já depende de "${from.name}" — essa relação criaria uma dependência circular`);
  }

  const { rows } = await pool.query(
    `INSERT INTO knowledge_relations (from_id, to_id) VALUES ($1,$2)
     ON CONFLICT (from_id, to_id, relation_type) DO NOTHING RETURNING *`,
    [fromId, toId]
  );
  if (!rows[0]) throw conflict("Essa dependência já está cadastrada");

  await publish({
    type: "knowledge.relation.created",
    actor: actorOf(req),
    entityType: "knowledge_item",
    entityId: fromId,
    summary: `Registrou que "${from.name}" depende de "${to.name}"`,
    metadata: { toId },
  });
  res.status(201).json(rows[0]);
});

// DELETE /api/knowledge/:id/relations/:relationId
knowledgeRouter.delete("/:id/relations/:relationId", requireRole(...CATALOG_EDITORS), async (req: AuthedRequest, res) => {
  const itemId = param(req.params.id);
  const { rows } = await pool.query(
    `DELETE FROM knowledge_relations WHERE id = $1 AND (from_id = $2 OR to_id = $2) RETURNING *`,
    [param(req.params.relationId), itemId]
  );
  if (!rows[0]) throw notFound("Dependência não encontrada");
  await publish({
    type: "knowledge.relation.deleted",
    actor: actorOf(req),
    entityType: "knowledge_item",
    entityId: rows[0].from_id,
    summary: "Removeu uma dependência entre itens do catálogo",
    metadata: { fromId: rows[0].from_id, toId: rows[0].to_id },
  });
  res.status(204).send();
});

// POST /api/knowledge/sync/gitlab - dispara a sincronização real com o GitLab
// (requer GITLAB_URL + GITLAB_TOKEN configurados no .env) — qualquer usuário logado pode disparar
knowledgeRouter.post("/sync/gitlab", async (req: AuthedRequest, res) => {
  const result = await syncGitlabCatalog();
  if (result.synced) {
    await publish({
      type: "knowledge.gitlab.synced",
      actor: actorOf(req),
      entityType: "knowledge_item",
      summary: `Sincronizou o catálogo com o GitLab (${result.created} novos, ${result.updated} atualizados)`,
      metadata: result,
    });
  }
  res.json(result);
});
