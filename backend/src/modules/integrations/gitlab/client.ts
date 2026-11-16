import axios from "axios";
import { config } from "../../../config";
import { pool } from "../../../db";
import { HttpError } from "../../../lib/errors";

/**
 * Integração real com o GitLab (fonte primária do Catálogo de Conhecimento).
 *
 * Requer as variáveis de ambiente:
 *   GITLAB_URL   - ex: https://gitlab.com ou https://gitlab.suaempresa.com
 *   GITLAB_TOKEN - Personal/Project Access Token com escopo read_api + read_repository
 *   GITLAB_GROUP - namespace/grupo onde estão os repositórios de agentes/chatbots/instructions
 *
 * Enquanto essas variáveis não estiverem configuradas, o endpoint de sync
 * retorna instruções em vez de falhar silenciosamente.
 */
export async function syncGitlabCatalog() {
  const { url: GITLAB_URL, token: GITLAB_TOKEN, group: GITLAB_GROUP } = config.gitlab;

  if (!GITLAB_URL || !GITLAB_TOKEN) {
    return {
      synced: false as const,
      reason:
        "GITLAB_URL e/ou GITLAB_TOKEN não configurados no backend/.env. " +
        "Gere um Personal Access Token no GitLab (Preferências > Access Tokens) com escopo " +
        "read_api e read_repository, e preencha o .env para ativar a sincronização real.",
    };
  }

  const api = axios.create({
    baseURL: `${GITLAB_URL.replace(/\/$/, "")}/api/v4`,
    headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
    timeout: 30_000,
  });

  const projectsUrl = GITLAB_GROUP
    ? `/groups/${encodeURIComponent(GITLAB_GROUP)}/projects`
    : `/projects`;

  let projects: any[];
  try {
    const { data } = await api.get(projectsUrl, {
      params: { per_page: 100, include_subgroups: true, membership: true },
    });
    projects = data;
  } catch (err: any) {
    // Falha do GitLab (token inválido, grupo inexistente, rede) não é erro interno do Hub:
    // responde 502 com o motivo, em vez de um 500 genérico.
    const status = err.response?.status;
    throw new HttpError(
      502,
      `Não foi possível consultar o GitLab${status ? ` (HTTP ${status})` : ""}: ${err.response?.data?.message ?? err.message}`
    );
  }

  let created = 0;
  let updated = 0;

  for (const project of projects) {
    // Heurística simples de classificação por tópicos/nome — ajustável conforme
    // o padrão de nomenclatura real dos repositórios da FlexIA.
    const topics: string[] = project.topics ?? project.tag_list ?? [];
    const type = inferKnowledgeType(project.name, topics);

    const existing = await pool.query(
      `SELECT id FROM knowledge_items WHERE gitlab_project_id = $1`,
      [String(project.id)]
    );

    if (existing.rows[0]) {
      await pool.query(
        `UPDATE knowledge_items SET name=$1, description=$2, tags=$3, gitlab_web_url=$4,
           gitlab_path=$5, gitlab_namespace=$6, last_synced_at=now(), updated_at=now()
         WHERE id = $7`,
        [
          project.name,
          project.description ?? null,
          topics,
          project.web_url,
          project.path_with_namespace,
          project.namespace?.full_path ?? null,
          existing.rows[0].id,
        ]
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO knowledge_items
           (type, name, description, tags, gitlab_project_id, gitlab_path, gitlab_web_url, gitlab_namespace, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
        [
          type,
          project.name,
          project.description ?? null,
          topics,
          String(project.id),
          project.path_with_namespace,
          project.web_url,
          project.namespace?.full_path ?? null,
        ]
      );
      created++;
    }
  }

  return { synced: true as const, projectsFound: projects.length, created, updated };
}

function inferKnowledgeType(name: string, topics: string[]): string {
  const haystack = `${name} ${topics.join(" ")}`.toLowerCase();
  if (haystack.includes("chatbot") || haystack.includes("bot")) return "chatbot";
  if (haystack.includes("agente") || haystack.includes("agent")) return "agente_ia";
  if (haystack.includes("dialog") || haystack.includes("dialogo") || haystack.includes("flow")) return "arvore_dialogo";
  if (haystack.includes("integra") || haystack.includes("integration") || haystack.includes("connector")) return "integracao";
  if (haystack.includes("infra") || haystack.includes("terraform") || haystack.includes("k8s") || haystack.includes("deploy")) return "infraestrutura";
  return "instruction";
}
