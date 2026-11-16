import { Router } from "express";
import { pool } from "../../db";
import { escapeLike } from "../../lib/validate";
import { requireAuth } from "../auth/middleware";

export const searchRouter = Router();
searchRouter.use(requireAuth);

const PER_TYPE = 5;
const MIN_QUERY_LENGTH = 2;

export interface SearchResult {
  type: "cliente" | "catalogo" | "ativacao" | "forum" | "documento" | "tarefa";
  id: string;
  title: string;
  subtitle: string | null;
  /** Rota do frontend que abre o resultado. */
  path: string;
}

/**
 * GET /api/search?q= — busca global (a paleta do Ctrl+K).
 *
 * Diferente do Assistente de IA (que responde perguntas em linguagem natural a partir do
 * índice de RAG), esta busca é para "ir até uma coisa pelo nome": consulta as tabelas de
 * origem direto, então o resultado está sempre em dia, e ignora acentos e maiúsculas
 * ("ativacao" encontra "Ativação"). Dentro de cada tipo, quem começa com o termo vem antes.
 */
searchRouter.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < MIN_QUERY_LENGTH) return res.json({ query: q, results: [] });

  const term = escapeLike(q.toLowerCase());
  const contains = `%${term}%`;
  const prefix = `${term}%`;
  const params = [contains, prefix, PER_TYPE];
  const match = (expr: string) => `immutable_unaccent(lower(${expr})) LIKE immutable_unaccent($1)`;
  const startsWith = (expr: string) => `(immutable_unaccent(lower(${expr})) LIKE immutable_unaccent($2))`;

  const [clients, knowledge, projects, threads, documents, tasks] = await Promise.all([
    pool.query(
      `SELECT id, name AS title, segment AS subtitle FROM clients
        WHERE ${match("name")} OR ${match("COALESCE(segment, '')")}
        ORDER BY ${startsWith("name")} DESC, name LIMIT $3`,
      params
    ),
    pool.query(
      `SELECT id, name AS title, type AS subtitle FROM knowledge_items k
        WHERE ${match("name")} OR ${match("COALESCE(description, '')")}
           OR EXISTS (SELECT 1 FROM unnest(k.tags) tg WHERE ${match("tg")})
        ORDER BY ${startsWith("name")} DESC, name LIMIT $3`,
      params
    ),
    pool.query(
      `SELECT p.id, p.name AS title, c.name AS subtitle
         FROM activation_projects p JOIN clients c ON c.id = p.client_id
        WHERE ${match("p.name")} OR ${match("c.name")}
        ORDER BY ${startsWith("p.name")} DESC, p.name LIMIT $3`,
      params
    ),
    pool.query(
      `SELECT t.id, t.title, cat.name AS subtitle
         FROM forum_threads t JOIN forum_categories cat ON cat.id = t.category_id
        WHERE ${match("t.title")} OR ${match("t.body")}
        ORDER BY ${startsWith("t.title")} DESC, t.created_at DESC LIMIT $3`,
      params
    ),
    pool.query(
      `SELECT d.id, d.title, c.name AS subtitle, d.client_id
         FROM client_documents d JOIN clients c ON c.id = d.client_id
        WHERE ${match("d.title")}
        ORDER BY ${startsWith("d.title")} DESC, d.title LIMIT $3`,
      params
    ),
    pool.query(
      `SELECT t.id, t.name AS title, c.name AS subtitle, t.client_id
         FROM clickup_task_cache t JOIN clients c ON c.id = t.client_id
        WHERE ${match("t.name")}
        ORDER BY ${startsWith("t.name")} DESC, t.name LIMIT $3`,
      params
    ),
  ]);

  const results: SearchResult[] = [
    ...clients.rows.map((r) => ({ type: "cliente" as const, ...r, path: `/clientes/${r.id}` })),
    ...knowledge.rows.map((r) => ({ type: "catalogo" as const, ...r, path: `/catalogo?item=${r.id}` })),
    ...projects.rows.map((r) => ({ type: "ativacao" as const, ...r, path: `/ativacao?projeto=${r.id}` })),
    ...threads.rows.map((r) => ({ type: "forum" as const, ...r, path: `/forum/${r.id}` })),
    ...documents.rows.map(({ client_id, ...r }) => ({ type: "documento" as const, ...r, path: `/clientes/${client_id}` })),
    ...tasks.rows.map(({ client_id, ...r }) => ({ type: "tarefa" as const, ...r, path: `/clientes/${client_id}` })),
  ];

  res.json({ query: q, results });
});
