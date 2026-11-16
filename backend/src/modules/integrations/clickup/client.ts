import axios from "axios";
import { config } from "../../../config";
import { pool } from "../../../db";
import { recalculateClientHealth } from "../../clients/healthScore";

/**
 * Integração real com o ClickUp para a Visão 360 do Cliente.
 *
 * Requer CLICKUP_API_TOKEN no .env (gerar em ClickUp > Settings > Apps > API Token).
 *
 * A associação task -> cliente é resolvida via `client_clickup_mappings`:
 *   - mapping_type = 'custom_field' -> mapping_value é o nome do campo customizado "Cliente"
 *     e o valor da task precisa bater com o nome do cliente
 *   - mapping_type = 'tag'          -> mapping_value é o nome da tag associada ao cliente
 *   - mapping_type = 'list'         -> mapping_value é o list_id do ClickUp dedicado ao cliente
 */
export async function syncClickupTasksForAllClients() {
  const CLICKUP_API_TOKEN = config.clickup.apiToken;
  if (!CLICKUP_API_TOKEN) {
    return {
      synced: false as const,
      reason:
        "CLICKUP_API_TOKEN não configurado no backend/.env. Gere um Personal API Token em " +
        "ClickUp > Settings > Apps e preencha o .env para ativar a sincronização real.",
    };
  }

  const api = axios.create({
    baseURL: "https://api.clickup.com/api/v2",
    headers: { Authorization: CLICKUP_API_TOKEN },
    timeout: 30_000,
  });

  const { rows: mappings } = await pool.query(
    `SELECT m.*, c.name AS client_name FROM client_clickup_mappings m JOIN clients c ON c.id = m.client_id`
  );

  let totalSynced = 0;
  const errors: string[] = [];

  for (const mapping of mappings) {
    try {
      let tasks: any[] = [];

      if (mapping.mapping_type === "list") {
        const { data } = await api.get(`/list/${mapping.mapping_value}/task`, {
          params: { include_closed: true },
        });
        tasks = data.tasks ?? [];
      } else if (mapping.mapping_type === "tag") {
        // Requer o team_id (workspace) — usamos CLICKUP_TEAM_ID do .env
        const teamId = config.clickup.teamId;
        const { data } = await api.get(`/team/${teamId}/task`, {
          params: { tags: [mapping.mapping_value], include_closed: true },
        });
        tasks = data.tasks ?? [];
      } else if (mapping.mapping_type === "custom_field") {
        const teamId = config.clickup.teamId;
        const { data } = await api.get(`/team/${teamId}/task`, {
          params: { include_closed: true },
        });
        tasks = (data.tasks ?? []).filter((t: any) =>
          (t.custom_fields ?? []).some(
            (f: any) => f.name === mapping.mapping_value && f.value === mapping.client_name
          )
        );
      }

      for (const task of tasks) {
        await pool.query(
          `INSERT INTO clickup_task_cache
             (clickup_task_id, name, status, list_name, assignee, due_date, url, priority, client_id, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
           ON CONFLICT (clickup_task_id) DO UPDATE SET
             name = EXCLUDED.name, status = EXCLUDED.status, list_name = EXCLUDED.list_name,
             assignee = EXCLUDED.assignee, due_date = EXCLUDED.due_date, url = EXCLUDED.url,
             priority = EXCLUDED.priority, synced_at = now()`,
          [
            task.id,
            task.name,
            task.status?.status ?? "unknown",
            task.list?.name ?? null,
            task.assignees?.[0]?.username ?? null,
            task.due_date ? new Date(Number(task.due_date)) : null,
            task.url ?? null,
            task.priority?.priority ?? null,
            mapping.client_id,
          ]
        );
        totalSynced++;
      }
    } catch (err: any) {
      errors.push(`Cliente ${mapping.client_name}: ${err.message}`);
    }
  }

  // As tasks e prazos mudaram — recalcula o health score e os alertas automáticos
  // de cada cliente que teve tasks sincronizadas, em vez de esperar alguém abrir a Visão 360.
  const clientIds = [...new Set(mappings.map((m) => m.client_id))];
  for (const clientId of clientIds) {
    await recalculateClientHealth(clientId);
  }

  return { synced: true as const, mappingsProcessed: mappings.length, tasksSynced: totalSynced, errors };
}
