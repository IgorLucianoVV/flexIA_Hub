import crypto from "crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";

import { config } from "./config";
import { pingDatabase } from "./db";
import { errorHandler, notFoundHandler } from "./lib/errors";
import { logger } from "./lib/logger";
import { apiLimiter } from "./lib/rateLimit";
import { activationRouter } from "./modules/activation/routes";
import { adminRouter } from "./modules/admin/routes";
import { assistantRouter } from "./modules/assistant/routes";
import { registerReindexSubscriber } from "./modules/assistant/reindexScheduler";
import { registerAuditSubscriber } from "./modules/audit/subscriber";
import { authRouter } from "./modules/auth/routes";
import { clientsRouter } from "./modules/clients/routes";
import { dashboardRouter } from "./modules/dashboard/routes";
import { forumRouter } from "./modules/forum/routes";
import { integrationsRouter } from "./modules/integrations/routes";
import { knowledgeRouter } from "./modules/knowledge/routes";
import { notificationsRouter } from "./modules/notifications/routes";
import { registerNotificationSubscriber } from "./modules/notifications/subscriber";
import { searchRouter } from "./modules/search/routes";

// Assinantes do barramento de eventos de domínio (ver lib/events.ts): auditoria,
// notificações e reindexação do RAG reagem ao que as rotas publicam.
registerAuditSubscriber();
registerNotificationSubscriber();
registerReindexSubscriber();

// App do Express isolado do `listen()` para que os testes (supertest) possam
// importar `app` e bater requisições nele sem precisar abrir uma porta de verdade.
export const app = express();

if (config.trustProxy) app.set("trust proxy", 1);
app.disable("x-powered-by");

// Cabeçalhos de segurança padrão (nosniff, frameguard, HSTS…). A API só devolve JSON.
app.use(helmet());
app.use(
  cors({
    // Em produção, liste as origens do frontend em CORS_ORIGINS. Vazio = qualquer origem (dev).
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
    exposedHeaders: ["X-Request-Id"],
  })
);

// Log estruturado de cada requisição, com um id que também volta no cabeçalho X-Request-Id:
// dá para achar no log exatamente a requisição que um usuário reportou.
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers["x-request-id"];
      const requestId = typeof incoming === "string" && incoming.length <= 100 ? incoming : crypto.randomUUID();
      res.setHeader("X-Request-Id", requestId);
      return requestId;
    },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    autoLogging: { ignore: (req) => req.url === "/api/health" || req.url === "/api/health/ready" },
  })
);

app.use(express.json({ limit: "200kb" }));

// Liveness: o processo está de pé? (não toca no banco — é o que um orquestrador usa para
// decidir se reinicia o contêiner).
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "flexia-hub-api" }));

// Readiness: o serviço consegue atender? Verifica a conexão real com o PostgreSQL e
// responde 503 se o banco não responder — é o que um balanceador/monitor deve consultar.
app.get("/api/health/ready", async (_req, res) => {
  const database = await pingDatabase();
  res.status(database.ok ? 200 : 503).json({
    ok: database.ok,
    service: "flexia-hub-api",
    uptimeSeconds: Math.round(process.uptime()),
    checks: { database },
  });
});

app.use("/api", apiLimiter);

app.use("/api/auth", authRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/knowledge", knowledgeRouter);
app.use("/api/activation", activationRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/forum", forumRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/search", searchRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/admin", adminRouter);

app.use("/api", notFoundHandler);
app.use(errorHandler);
