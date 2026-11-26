import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../src/config";
import { pool } from "../src/db";

// Apaga os dados de todas as tabelas de negócio, mantendo o schema. Usado no
// início de cada teste para começar de um banco limpo e previsível.
// (`activation_templates` fica de fora: o template padrão é dado de referência criado
// pela migração, não dado de teste.)
export async function resetDb() {
  await pool.query(`
    TRUNCATE TABLE
      notifications, audit_log, assistant_interactions, refresh_tokens,
      password_resets, forum_replies, forum_threads, forum_categories,
      client_health_history, client_metrics, client_alerts, client_documents, clickup_task_cache,
      client_clickup_mappings, activation_artifacts, activation_phases,
      activation_projects, knowledge_attachments, knowledge_relations, knowledge_items, clients, users
    RESTART IDENTITY CASCADE
  `);
}

type Role = "dev" | "analista_suporte" | "analista_ativacao" | "admin";

export interface TestUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  rawPassword: string;
}

let userCounter = 0;

// Cria um usuário direto no banco (sem passar pela rota /register) para os testes
// que só precisam de "um usuário logado com papel X" sem testar o registro em si.
export async function createUser(role: Role, overrides: Partial<{ name: string; email: string; password: string }> = {}): Promise<TestUser> {
  userCounter += 1;
  const rawPassword = overrides.password ?? "senha123456";
  const email = overrides.email ?? `${role}-${userCounter}@test.local`;
  const name = overrides.name ?? `Usuário de teste (${role})`;
  const passwordHash = await bcrypt.hash(rawPassword, 4); // rounds baixos: testes não precisam de segurança, só velocidade
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role`,
    [name, email, passwordHash, role]
  );
  return { ...rows[0], rawPassword };
}

// Assina um token igual ao que a rota de login geraria, sem precisar bater na rota.
export function tokenFor(user: Pick<TestUser, "id" | "name" | "email" | "role">) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, config.jwtSecret, {
    expiresIn: "1h",
  });
}

export function authHeader(user: Pick<TestUser, "id" | "name" | "email" | "role">) {
  return { Authorization: `Bearer ${tokenFor(user)}` };
}

export async function createClient(overrides: Partial<{ name: string; segment: string; csmOwner: string; healthScore: number }> = {}) {
  const { rows } = await pool.query(
    `INSERT INTO clients (name, segment, csm_owner, health_score) VALUES ($1,$2,$3,$4) RETURNING *`,
    [overrides.name ?? "Cliente de teste", overrides.segment ?? null, overrides.csmOwner ?? null, overrides.healthScore ?? 100]
  );
  return rows[0];
}

export async function createKnowledgeItem(
  overrides: Partial<{ name: string; type: string; description: string; ownerTeam: string; tags: string[]; status: string }> = {}
) {
  const { rows } = await pool.query(
    `INSERT INTO knowledge_items (type, name, description, owner_team, tags, status)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6,'ativo')) RETURNING *`,
    [
      overrides.type ?? "chatbot",
      overrides.name ?? "Item de teste",
      overrides.description ?? null,
      overrides.ownerTeam ?? null,
      overrides.tags ?? [],
      overrides.status ?? null,
    ]
  );
  return rows[0];
}

export async function createCategory(slug = "geral", name = "Geral") {
  const { rows } = await pool.query(`INSERT INTO forum_categories (slug, name) VALUES ($1,$2) RETURNING *`, [slug, name]);
  return rows[0];
}
