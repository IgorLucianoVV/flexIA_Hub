import { Pool, PoolClient, types } from "pg";
import { config } from "./config";
import { logger } from "./lib/logger";

// Colunas DATE (sem hora) voltam como texto "AAAA-MM-DD" em vez de um objeto Date. O
// padrão do driver converte para meia-noite no fuso do servidor, o que faz um prazo
// "20/11" virar "19/11" para quem está em outro fuso ao serializar em JSON.
types.setTypeParser(types.builtins.DATE, (value) => value);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  // Falha rápido se o banco estiver fora do ar, em vez de deixar a requisição pendurada.
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  // Nenhuma consulta deste backend deveria levar mais que isso; se levar, é melhor
  // cancelar e devolver erro do que segurar uma conexão do pool indefinidamente.
  statement_timeout: 15_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "Erro inesperado em uma conexão ociosa do pool do PostgreSQL");
});

/**
 * Executa `fn` dentro de uma transação: COMMIT se terminar bem, ROLLBACK se lançar.
 * Usado quando uma operação grava em mais de uma tabela e não pode ficar pela metade
 * (ex.: criar um projeto de ativação com todas as fases e artefatos de um template).
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Verifica se o banco responde — usado pelo health check de prontidão. */
export async function pingDatabase(timeoutMs = 2_000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
  }
}
