import { app } from "./app";
import { config } from "./config";
import { pool } from "./db";
import { logger } from "./lib/logger";

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, `FlexIA Hub API rodando em http://localhost:${config.port}`);
});

// Encerramento gracioso: para de aceitar conexões novas, deixa as requisições em curso
// terminarem e só então fecha o pool do banco. Evita cortar requisições no meio a cada
// deploy/reinício do contêiner.
function shutdown(signal: string) {
  logger.info({ signal }, "Encerrando o servidor…");
  server.close(async () => {
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
  // Se alguma conexão não fechar a tempo, encerra de qualquer forma.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Promise rejeitada sem tratamento");
});
