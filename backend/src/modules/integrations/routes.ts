import { Router } from "express";
import { config } from "../../config";
import { publish } from "../../lib/events";
import { actorOf, AuthedRequest, requireAuth } from "../auth/middleware";
import { syncClickupTasksForAllClients } from "./clickup/client";
import { syncGitlabCatalog } from "./gitlab/client";

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

// Disparar uma sincronização é de baixo risco (só leitura das APIs externas), então
// qualquer usuário logado pode acionar — não é uma ação "administrativa" de verdade.
integrationsRouter.post("/gitlab/sync", async (req: AuthedRequest, res) => {
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

integrationsRouter.post("/clickup/sync", async (req: AuthedRequest, res) => {
  const result = await syncClickupTasksForAllClients();
  if (result.synced) {
    await publish({
      type: "client.clickup.synced",
      actor: actorOf(req),
      entityType: "client",
      summary: `Sincronizou as tasks do ClickUp (${result.tasksSynced} tasks de ${result.mappingsProcessed} mapeamentos)`,
      metadata: { tasksSynced: result.tasksSynced, errors: result.errors },
    });
  }
  res.json(result);
});

// GET /api/integrations/status — quais integrações estão configuradas (sem expor nenhum segredo)
integrationsRouter.get("/status", (_req, res) => {
  res.json({
    gitlab: { configured: Boolean(config.gitlab.url && config.gitlab.token) },
    clickup: { configured: Boolean(config.clickup.apiToken) },
  });
});
