import { pool } from "../../db";
import { publish } from "../../lib/events";

/**
 * Health score automático da Visão 360 do Cliente.
 *
 * Antes, `health_score` era um número solto na tabela `clients` sem ninguém
 * calculando nada — teria que ser digitado à mão. Agora ele é recalculado a
 * partir de sinais que já existem no banco (sem depender de nenhuma
 * credencial nova): tasks do ClickUp vencidas, projetos de ativação
 * atrasados e alertas manuais abertos. Os mesmos sinais também abrem e
 * fecham alertas automáticos (`client_alerts` com `source` começando em
 * "Cálculo automático"), então o time vê o problema sem precisar caçar dado.
 *
 * `recalculateClientHealth` é chamado automaticamente:
 *  - sempre que alguém abre a Visão 360 de um cliente (GET /:id/360)
 *  - depois de um sync do ClickUp (as tasks/due dates mudaram)
 *  - depois que o status de um artefato de ativação é atualizado
 * Também dá para forçar via POST /api/clients/:id/recalculate-health.
 *
 * Cada recálculo também:
 *  - guarda a COMPOSIÇÃO do score (`clients.health_breakdown`): quanto cada sinal tirou,
 *    para a tela explicar "por que 61?" em vez de mostrar só o número;
 *  - grava um ponto por dia em `client_health_history`, que alimenta o gráfico de tendência;
 *  - publica eventos de domínio (alerta aberto/resolvido, score alterado), que viram
 *    auditoria, notificação para o time e reindexação do RAG.
 */

const DONE_TASK_STATUSES = new Set([
  "complete",
  "closed",
  "concluido",
  "concluído",
  "finalizado",
  "done",
  "fechado",
  "resolved",
  "resolvido",
  "cancelado",
  "cancelled",
]);

const SOURCE_OVERDUE_TASKS = "Cálculo automático (tasks vencidas)";
const SOURCE_ACTIVATION_DELAY = "Cálculo automático (projeto atrasado)";
const SOURCE_HEALTH_SCORE = "Cálculo automático (health score)";
const AUTO_SOURCES = [SOURCE_OVERDUE_TASKS, SOURCE_ACTIVATION_DELAY, SOURCE_HEALTH_SCORE];

const SEVERITY_WEIGHT: Record<string, number> = { baixa: 1, media: 2, alta: 4, critica: 8 };

interface AlertRule {
  source: string;
  severity: "baixa" | "media" | "alta" | "critica";
  message: string;
}

export interface HealthComponent {
  key: "overdue_tasks" | "delayed_projects" | "manual_alerts";
  label: string;
  /** Quantos itens entraram na conta (tasks vencidas, projetos atrasados, alertas abertos). */
  count: number;
  /** Pontos descontados por este sinal (já com o teto aplicado). */
  penalty: number;
  /** Teto de desconto deste sinal — nenhum sinal sozinho zera o score. */
  maxPenalty: number;
}

export interface HealthBreakdown {
  base: number;
  components: HealthComponent[];
  calculatedAt: string;
}

export interface HealthRecalcResult {
  clientId: string;
  healthScore: number;
  previousScore: number | null;
  breakdown: HealthBreakdown;
  alertsOpened: number;
  alertsResolved: number;
}

export async function recalculateClientHealth(clientId: string): Promise<HealthRecalcResult> {
  const [clientResult, tasksResult, projectsResult, manualAlertsResult] = await Promise.all([
    pool.query(`SELECT name, health_score FROM clients WHERE id = $1`, [clientId]),
    pool.query(`SELECT status, due_date FROM clickup_task_cache WHERE client_id = $1`, [clientId]),
    pool.query(`SELECT name, status, target_date FROM activation_projects WHERE client_id = $1`, [clientId]),
    // Só entram no cálculo os alertas que uma pessoa abriu manualmente — os automáticos
    // não podem "puxar" o próprio score que os gerou.
    pool.query(
      `SELECT severity FROM client_alerts
       WHERE client_id = $1 AND resolved = false AND (source IS NULL OR source <> ALL($2::text[]))`,
      [clientId, AUTO_SOURCES]
    ),
  ]);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const overdueTasks = tasksResult.rows.filter((t) => {
    if (!t.due_date) return false;
    if (DONE_TASK_STATUSES.has(String(t.status ?? "").toLowerCase())) return false;
    return new Date(t.due_date) < now;
  });

  const delayedProjects = projectsResult.rows.filter((p) => {
    if (p.status === "concluido") return false;
    if (p.status === "atrasado") return true;
    // Atrasa a partir do dia seguinte ao prazo (mesma regra do SQL: target_date < CURRENT_DATE).
    return p.target_date ? String(p.target_date).slice(0, 10) < today : false;
  });

  const manualAlertWeight = manualAlertsResult.rows.reduce(
    (sum, a) => sum + (SEVERITY_WEIGHT[a.severity] ?? 1),
    0
  );

  const components: HealthComponent[] = [
    {
      key: "overdue_tasks",
      label: "Tasks do ClickUp vencidas",
      count: overdueTasks.length,
      penalty: Math.min(overdueTasks.length * 8, 40),
      maxPenalty: 40,
    },
    {
      key: "delayed_projects",
      label: "Projetos de ativação atrasados",
      count: delayedProjects.length,
      penalty: Math.min(delayedProjects.length * 15, 45),
      maxPenalty: 45,
    },
    {
      key: "manual_alerts",
      label: "Alertas manuais abertos",
      count: manualAlertsResult.rows.length,
      penalty: Math.min(manualAlertWeight * 3, 30),
      maxPenalty: 30,
    },
  ];

  let score = 100 - components.reduce((sum, c) => sum + c.penalty, 0);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const breakdown: HealthBreakdown = { base: 100, components, calculatedAt: now.toISOString() };
  const clientName: string = clientResult.rows[0]?.name ?? "Cliente";
  const previousScore: number | null = clientResult.rows[0]?.health_score ?? null;

  await pool.query(
    `UPDATE clients SET health_score = $1, health_breakdown = $2, updated_at = now() WHERE id = $3`,
    [score, JSON.stringify(breakdown), clientId]
  );
  // Um ponto por dia na série histórica: recalcular várias vezes no mesmo dia só atualiza o ponto.
  await pool.query(
    `INSERT INTO client_health_history (client_id, score, breakdown) VALUES ($1,$2,$3)
     ON CONFLICT (client_id, recorded_on) DO UPDATE SET score = EXCLUDED.score, breakdown = EXCLUDED.breakdown, recorded_at = now()`,
    [clientId, score, JSON.stringify(breakdown)]
  );

  const rules: AlertRule[] = [];

  if (overdueTasks.length >= 3) {
    rules.push({
      source: SOURCE_OVERDUE_TASKS,
      severity: overdueTasks.length >= 8 ? "critica" : "alta",
      message: `${overdueTasks.length} tarefa(s) do ClickUp vencida(s) e ainda em aberto.`,
    });
  }

  if (delayedProjects.length > 0) {
    const names = delayedProjects.map((p) => p.name).join(", ");
    rules.push({
      source: SOURCE_ACTIVATION_DELAY,
      severity: delayedProjects.length >= 2 ? "critica" : "alta",
      message: `${delayedProjects.length} projeto(s) de ativação atrasado(s): ${names}.`,
    });
  }

  if (score < 40) {
    rules.push({ source: SOURCE_HEALTH_SCORE, severity: "critica", message: `Health score crítico: ${score}.` });
  } else if (score < 65) {
    rules.push({ source: SOURCE_HEALTH_SCORE, severity: "media", message: `Health score baixo: ${score}.` });
  }

  const activeSources = new Set(rules.map((r) => r.source));
  let alertsOpened = 0;
  let alertsResolved = 0;

  for (const rule of rules) {
    const existing = await pool.query(
      `SELECT id, message, severity FROM client_alerts WHERE client_id = $1 AND source = $2 AND resolved = false`,
      [clientId, rule.source]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].message !== rule.message || existing.rows[0].severity !== rule.severity) {
        await pool.query(`UPDATE client_alerts SET message = $1, severity = $2, updated_at = now() WHERE id = $3`, [
          rule.message,
          rule.severity,
          existing.rows[0].id,
        ]);
      }
    } else {
      await pool.query(`INSERT INTO client_alerts (severity, message, source, client_id) VALUES ($1,$2,$3,$4)`, [
        rule.severity,
        rule.message,
        rule.source,
        clientId,
      ]);
      alertsOpened++;
      await publish({
        type: "client.alert.opened",
        actor: null,
        entityType: "client",
        entityId: clientId,
        summary: `Alerta automático aberto para ${clientName}: ${rule.message}`,
        metadata: { clientName, severity: rule.severity, message: rule.message, source: rule.source },
      });
    }
  }

  // Condição que gerou o alerta automático deixou de existir -> resolve sozinho.
  for (const source of AUTO_SOURCES) {
    if (activeSources.has(source)) continue;
    const resolved = await pool.query(
      `UPDATE client_alerts SET resolved = true, resolved_at = now(), updated_at = now()
       WHERE client_id = $1 AND source = $2 AND resolved = false RETURNING id, message`,
      [clientId, source]
    );
    alertsResolved += resolved.rowCount ?? 0;
    for (const row of resolved.rows) {
      await publish({
        type: "client.alert.resolved",
        actor: null,
        entityType: "client",
        entityId: clientId,
        summary: `Alerta automático resolvido para ${clientName}: ${row.message}`,
        metadata: { clientName, source },
      });
    }
  }

  if (previousScore !== null && previousScore !== score) {
    await publish({
      type: "client.health.changed",
      actor: null,
      entityType: "client",
      entityId: clientId,
      summary: `Health score de ${clientName} mudou de ${previousScore} para ${score}`,
      metadata: { clientName, previousScore, score },
    });
  }

  return { clientId, healthScore: score, previousScore, breakdown, alertsOpened, alertsResolved };
}

export async function recalculateAllClientsHealth(): Promise<HealthRecalcResult[]> {
  const { rows } = await pool.query(`SELECT id FROM clients`);
  const results: HealthRecalcResult[] = [];
  for (const row of rows) {
    results.push(await recalculateClientHealth(row.id));
  }
  return results;
}
