import { Client } from "pg";
import path from "path";
import dotenv from "dotenv";
import { runMigrations } from "../src/lib/migrate";

/**
 * Roda uma vez antes de toda a suíte (fora do contexto dos workers de teste).
 * Garante que o banco `flexia_hub_test` existe e está com todas as migrações aplicadas —
 * as MESMAS migrações que rodam em desenvolvimento e produção —, para que `npm test`
 * funcione sem passo manual e sem tocar no banco de desenvolvimento.
 */
export default async function globalSetup() {
  dotenv.config({ path: path.resolve(__dirname, "../.env.test"), override: true, quiet: true });

  // No CI o banco não está em localhost: TEST_DATABASE_URL (definida no pipeline) tem prioridade.
  const testUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!testUrl) {
    throw new Error("DATABASE_URL não definido em backend/.env.test");
  }

  const dbName = new URL(testUrl).pathname.replace(/^\//, "");
  // Trava de segurança: os testes truncam tabelas. Nunca rodar contra um banco que não seja de teste.
  if (!dbName.includes("test")) {
    throw new Error(`O banco de testes precisa ter "test" no nome (recebido: ${dbName}). Confira backend/.env.test.`);
  }
  const adminUrl = testUrl.replace(`/${dbName}`, "/postgres");

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { rows } = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }

  await runMigrations(testUrl);
}
