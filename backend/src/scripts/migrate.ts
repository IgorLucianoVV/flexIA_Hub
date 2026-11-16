import { config } from "../config";
import { runMigrations } from "../lib/migrate";

// `npm run migrate` — aplica as migrações pendentes no banco apontado por DATABASE_URL.
runMigrations(config.databaseUrl, (message) => console.log(message))
  .then((result) => {
    if (result.applied.length === 0) {
      console.log(`Banco já está atualizado (${result.alreadyApplied} migrações aplicadas).`);
    } else {
      console.log(`${result.applied.length} migração(ões) aplicada(s): ${result.applied.join(", ")}`);
    }
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
