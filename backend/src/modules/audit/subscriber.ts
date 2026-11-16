import { pool } from "../../db";
import { DomainEvent, subscribe } from "../../lib/events";

/**
 * Todo evento de domínio vira uma linha em `audit_log`: quem fez, o quê, em qual registro
 * e quando. É o "quem mudou o quê" que uma plataforma de governança precisa ter — e como
 * nasce do barramento de eventos, nenhuma rota precisa lembrar de registrar auditoria.
 */
async function recordAudit(event: DomainEvent): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id, summary, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      event.actor?.id ?? null,
      event.actor?.name ?? "Sistema",
      event.type,
      event.entityType,
      event.entityId ?? null,
      event.summary,
      JSON.stringify(event.metadata ?? {}),
    ]
  );
}

export function registerAuditSubscriber(): void {
  subscribe("audit", recordAudit);
}
