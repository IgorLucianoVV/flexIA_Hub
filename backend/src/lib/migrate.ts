import { Client } from "pg";
import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Runner de migrações versionadas.
 *
 * Cada arquivo `migrations/NNN_nome.sql` é aplicado uma única vez, em ordem, dentro de uma
 * transação, e registrado em `schema_migrations`. Isso substitui o antigo "rode o
 * schema.sql à mão": o estado do banco passa a ser reproduzível (dev, teste, CI e produção
 * rodam exatamente a mesma sequência) e toda mudança de schema fica versionada no Git.
 *
 * Regras para quem for escrever uma migração nova:
 *  - nunca edite uma migração já aplicada em algum ambiente; crie a próxima (`011_...sql`);
 *  - o runner avisa se o conteúdo de uma migração aplicada mudou (checksum diferente).
 */
export const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");

// Chave arbitrária do advisory lock: impede duas instâncias de migrarem ao mesmo tempo
// (ex.: duas réplicas do backend subindo juntas).
const LOCK_KEY = 727_274_001;

export interface MigrationResult {
  applied: string[];
  alreadyApplied: number;
  warnings: string[];
}

export async function runMigrations(
  connectionString: string,
  log: (message: string) => void = () => undefined
): Promise<MigrationResult> {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  const client = new Client({ connectionString });
  await client.connect();
  const result: MigrationResult = { applied: [], alreadyApplied: 0, warnings: [] };

  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        checksum   TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations"
    );
    const appliedChecksums = new Map(rows.map((r) => [r.version, r.checksum]));

    for (const file of files) {
      const version = file.split("_")[0];
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");

      const previous = appliedChecksums.get(version);
      if (previous !== undefined) {
        result.alreadyApplied++;
        if (previous !== checksum) {
          const warning = `Migração ${file} já foi aplicada, mas o arquivo mudou desde então. Crie uma migração nova em vez de editar uma antiga.`;
          result.warnings.push(warning);
          log(`AVISO: ${warning}`);
        }
        continue;
      }

      log(`Aplicando ${file}…`);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [
          version,
          file,
          checksum,
        ]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`Falha ao aplicar a migração ${file}: ${(err as Error).message}`);
      }
      result.applied.push(file);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }

  return result;
}
