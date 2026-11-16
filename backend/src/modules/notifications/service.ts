import { pool } from "../../db";
import type { Role } from "../auth/middleware";

export interface NewNotification {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** Cria a mesma notificação para vários usuários (ids repetidos são ignorados). */
export async function notifyUsers(userIds: string[], notification: NewNotification): Promise<number> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return 0;
  const { rowCount } = await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, link)
     SELECT u.id, $2, $3, $4, $5 FROM users u WHERE u.id = ANY($1::text[]) AND u.is_active = true`,
    [unique, notification.type, notification.title, notification.body ?? null, notification.link ?? null]
  );
  return rowCount ?? 0;
}

/** Ids dos usuários ativos que têm um dos papéis informados. */
export async function userIdsWithRoles(roles: Role[]): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE is_active = true AND role = ANY($1::text[])`,
    [roles]
  );
  return rows.map((r) => r.id);
}
