import { Router } from "express";
import { pool } from "../../db";
import { requireAuth } from "../auth/middleware";
import { computeScorecard } from "../knowledge/scorecard";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

const AT_RISK_THRESHOLD = 70;

/**
 * GET /api/dashboard/summary — tudo que a tela "Visão geral" mostra, em uma requisição.
 *
 * Antes, o frontend baixava a lista inteira de clientes e de projetos só para somar e tirar
 * média no navegador. Agora os agregados são calculados no banco e a tela recebe apenas os
 * números e as listas curtas que de fato exibe — não importa quantos clientes existam.
 */
dashboardRouter.get("/summary", async (_req, res) => {
  const [clientStats, attention, alertStats, projectStats, projects, upcoming, knowledgeItems, forumStats] =
    await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COALESCE(ROUND(AVG(health_score)), 0)::int AS avg_health,
                COUNT(*) FILTER (WHERE health_score < $1)::int AS at_risk
           FROM clients WHERE status = 'ativo'`,
        [AT_RISK_THRESHOLD]
      ),
      // Clientes que mais pedem atenção: menor health score primeiro.
      pool.query(
        `SELECT c.id, c.name, c.health_score,
                (SELECT COUNT(*) FROM client_alerts a WHERE a.client_id = c.id AND a.resolved = false)::int AS open_alerts,
                (SELECT h.score FROM client_health_history h
                  WHERE h.client_id = c.id AND h.recorded_on <= CURRENT_DATE - 7
                  ORDER BY h.recorded_on DESC LIMIT 1) AS score_week_ago
           FROM clients c WHERE c.status = 'ativo'
          ORDER BY c.health_score ASC NULLS LAST, c.name LIMIT 8`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS open,
                COUNT(*) FILTER (WHERE severity IN ('alta', 'critica'))::int AS high
           FROM client_alerts WHERE resolved = false`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status <> 'concluido')::int AS in_progress,
                COUNT(*) FILTER (WHERE status = 'atrasado' OR (status <> 'concluido' AND target_date < CURRENT_DATE))::int AS overdue
           FROM activation_projects`
      ),
      pool.query(
        `SELECT p.id, p.name, p.status, to_char(p.target_date, 'YYYY-MM-DD') AS target_date, c.name AS client_name,
                (p.status <> 'concluido' AND p.target_date < CURRENT_DATE) AS is_overdue,
                COUNT(a.id)::int AS total_artifacts,
                COUNT(a.id) FILTER (WHERE a.status = 'concluido')::int AS done_artifacts
           FROM activation_projects p
           JOIN clients c ON c.id = p.client_id
           LEFT JOIN activation_phases ph ON ph.project_id = p.id
           LEFT JOIN activation_artifacts a ON a.phase_id = ph.id
          WHERE p.status <> 'concluido'
          GROUP BY p.id, c.name
          ORDER BY is_overdue DESC, p.target_date ASC NULLS LAST, p.created_at DESC
          LIMIT 6`
      ),
      pool.query(
        `SELECT a.id, a.name, to_char(a.due_date, 'YYYY-MM-DD') AS due_date, (a.due_date < CURRENT_DATE) AS is_overdue,
                p.name AS project_name, c.name AS client_name
           FROM activation_artifacts a
           JOIN activation_phases ph ON ph.id = a.phase_id
           JOIN activation_projects p ON p.id = ph.project_id
           JOIN clients c ON c.id = p.client_id
          WHERE a.status <> 'concluido' AND a.due_date IS NOT NULL AND a.due_date <= CURRENT_DATE + 7
          ORDER BY a.due_date ASC LIMIT 8`
      ),
      pool.query(
        `SELECT description, owner_team, tags, status, gitlab_web_url, last_synced_at, last_reviewed_at,
                deprecation_note, replaced_by_id FROM knowledge_items`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS threads,
                COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM forum_replies r WHERE r.thread_id = t.id))::int AS unanswered
           FROM forum_threads t`
      ),
    ]);

  const scorecards = knowledgeItems.rows.map((item) => computeScorecard(item));

  res.json({
    clients: {
      total: clientStats.rows[0].total,
      avgHealth: clientStats.rows[0].avg_health,
      atRisk: clientStats.rows[0].at_risk,
      atRiskThreshold: AT_RISK_THRESHOLD,
      attention: attention.rows,
    },
    alerts: alertStats.rows[0],
    activation: {
      total: projectStats.rows[0].total,
      inProgress: projectStats.rows[0].in_progress,
      overdue: projectStats.rows[0].overdue,
      projects: projects.rows.map((p) => ({
        ...p,
        progressPct: p.total_artifacts > 0 ? Math.round((p.done_artifacts / p.total_artifacts) * 100) : 0,
      })),
      upcoming: upcoming.rows,
    },
    knowledge: {
      total: scorecards.length,
      averageScore: scorecards.length
        ? Math.round(scorecards.reduce((sum, s) => sum + s.score, 0) / scorecards.length)
        : 0,
      stale: scorecards.filter((s) => s.stale).length,
      gold: scorecards.filter((s) => s.level === "ouro").length,
    },
    forum: forumStats.rows[0],
  });
});
