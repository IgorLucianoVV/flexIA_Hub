import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pool } from "../src/db";
import { recalculateClientHealth } from "../src/modules/clients/healthScore";
import { resetDb, createClient } from "./helpers";

async function insertTask(clientId: string, opts: { status: string; dueDaysAgo?: number; clickupId: string }) {
  const dueDate = opts.dueDaysAgo != null ? new Date(Date.now() - opts.dueDaysAgo * 24 * 60 * 60 * 1000) : null;
  await pool.query(
    `INSERT INTO clickup_task_cache (clickup_task_id, name, status, due_date, client_id) VALUES ($1,'Task',$2,$3,$4)`,
    [opts.clickupId, opts.status, dueDate, clientId]
  );
}

async function insertProject(clientId: string, opts: { status: string; targetDaysAgo?: number }) {
  const targetDate = opts.targetDaysAgo != null ? new Date(Date.now() - opts.targetDaysAgo * 24 * 60 * 60 * 1000) : null;
  const { rows } = await pool.query(
    `INSERT INTO activation_projects (name, client_id, status, target_date) VALUES ('Projeto',$1,$2,$3) RETURNING id`,
    [clientId, opts.status, targetDate]
  );
  return rows[0].id as string;
}

describe("recalculateClientHealth", () => {
  beforeEach(resetDb);

  it("mantém score 100 e não cria alerta quando não há nenhum sinal ruim", async () => {
    const client = await createClient();
    const result = await recalculateClientHealth(client.id);
    expect(result.healthScore).toBe(100);
    expect(result.alertsOpened).toBe(0);

    const { rows } = await pool.query(`SELECT * FROM client_alerts WHERE client_id = $1`, [client.id]);
    expect(rows).toHaveLength(0);
  });

  it("tasks vencidas com status concluído não contam como atraso", async () => {
    const client = await createClient();
    await insertTask(client.id, { clickupId: "t1", status: "concluido", dueDaysAgo: 30 });
    await insertTask(client.id, { clickupId: "t2", status: "finalizado", dueDaysAgo: 10 });
    const result = await recalculateClientHealth(client.id);
    expect(result.healthScore).toBe(100);
  });

  it("3+ tasks vencidas em aberto derrubam o score e abrem um alerta automático", async () => {
    const client = await createClient();
    await insertTask(client.id, { clickupId: "t1", status: "aberto", dueDaysAgo: 5 });
    await insertTask(client.id, { clickupId: "t2", status: "aberto", dueDaysAgo: 10 });
    await insertTask(client.id, { clickupId: "t3", status: "em andamento", dueDaysAgo: 1 });

    const result = await recalculateClientHealth(client.id);
    expect(result.healthScore).toBe(100 - 3 * 8); // 76
    expect(result.alertsOpened).toBe(1);

    const { rows } = await pool.query(
      `SELECT * FROM client_alerts WHERE client_id = $1 AND resolved = false`,
      [client.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("Cálculo automático (tasks vencidas)");
  });

  it("detecta projeto atrasado pelo target_date vencido, mesmo com status em_andamento", async () => {
    const client = await createClient();
    await insertProject(client.id, { status: "em_andamento", targetDaysAgo: 20 });

    const result = await recalculateClientHealth(client.id);
    expect(result.healthScore).toBe(100 - 15);

    const { rows } = await pool.query(
      `SELECT * FROM client_alerts WHERE client_id = $1 AND source = 'Cálculo automático (projeto atrasado)' AND resolved = false`,
      [client.id]
    );
    expect(rows).toHaveLength(1);
  });

  it("projeto concluído nunca conta como atrasado, mesmo com target_date no passado", async () => {
    const client = await createClient();
    await insertProject(client.id, { status: "concluido", targetDaysAgo: 100 });
    const result = await recalculateClientHealth(client.id);
    expect(result.healthScore).toBe(100);
  });

  it("score baixo o suficiente gera o alerta 'health score baixo/crítico'", async () => {
    const client = await createClient();
    // 6 tasks vencidas (-40, capado) + 3 projetos atrasados (-45, capado) = -85 -> score 15 (< 40 -> crítico)
    for (let i = 0; i < 6; i++) {
      await insertTask(client.id, { clickupId: `t${i}`, status: "aberto", dueDaysAgo: 5 });
    }
    for (let i = 0; i < 3; i++) {
      await insertProject(client.id, { status: "atrasado" });
    }

    const result = await recalculateClientHealth(client.id);
    expect(result.healthScore).toBe(15);

    const { rows } = await pool.query(
      `SELECT * FROM client_alerts WHERE client_id = $1 AND source = 'Cálculo automático (health score)' AND resolved = false`,
      [client.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("critica");
  });

  it("resolve sozinho o alerta automático quando a condição deixa de existir, sem tocar em alertas manuais", async () => {
    const client = await createClient();
    await insertTask(client.id, { clickupId: "t1", status: "aberto", dueDaysAgo: 5 });
    await insertTask(client.id, { clickupId: "t2", status: "aberto", dueDaysAgo: 5 });
    await insertTask(client.id, { clickupId: "t3", status: "aberto", dueDaysAgo: 5 });
    await pool.query(
      `INSERT INTO client_alerts (client_id, severity, message, source) VALUES ($1,'baixa','Alerta manual','pessoa')`,
      [client.id]
    );

    const first = await recalculateClientHealth(client.id);
    expect(first.alertsOpened).toBe(1);

    // As tasks foram concluídas -> a condição não existe mais.
    await pool.query(`UPDATE clickup_task_cache SET status = 'concluido' WHERE client_id = $1`, [client.id]);

    const second = await recalculateClientHealth(client.id);
    expect(second.alertsResolved).toBe(1);

    const { rows } = await pool.query(`SELECT source, resolved FROM client_alerts WHERE client_id = $1`, [client.id]);
    const auto = rows.find((r) => r.source === "Cálculo automático (tasks vencidas)");
    const manual = rows.find((r) => r.source === "pessoa");
    expect(auto?.resolved).toBe(true);
    expect(manual?.resolved).toBe(false); // alerta manual nunca é resolvido pelo cálculo automático
  });

  it("guarda a composição do score e um ponto por dia no histórico", async () => {
    const client = await createClient();
    await insertTask(client.id, { clickupId: "t1", status: "aberto", dueDaysAgo: 5 });
    await insertProject(client.id, { status: "atrasado" });

    const result = await recalculateClientHealth(client.id);
    expect(result.healthScore).toBe(100 - 8 - 15);
    expect(result.breakdown.components.map((c) => [c.key, c.count, c.penalty])).toEqual([
      ["overdue_tasks", 1, 8],
      ["delayed_projects", 1, 15],
      ["manual_alerts", 0, 0],
    ]);

    await recalculateClientHealth(client.id); // mesmo dia: não cria um segundo ponto
    const { rows } = await pool.query(`SELECT score FROM client_health_history WHERE client_id = $1`, [client.id]);
    expect(rows).toEqual([{ score: 77 }]);
  });

  it("projeto com prazo para hoje ainda não está atrasado", async () => {
    const client = await createClient();
    await pool.query(
      `INSERT INTO activation_projects (name, client_id, status, target_date) VALUES ('Hoje',$1,'em_andamento', CURRENT_DATE)`,
      [client.id]
    );
    expect((await recalculateClientHealth(client.id)).healthScore).toBe(100);
  });

  it("alertas manuais abertos também pesam no score (não só sinais automáticos)", async () => {
    const client = await createClient();
    await pool.query(
      `INSERT INTO client_alerts (client_id, severity, message, source) VALUES ($1,'critica','Problema grave relatado por uma pessoa','pessoa')`,
      [client.id]
    );
    const result = await recalculateClientHealth(client.id);
    expect(result.healthScore).toBe(100 - 8 * 3); // peso critica=8, *3 = -24
  });
});

afterAll(async () => {
  await pool.end();
});
