import os from "os";
import path from "path";
import dotenv from "dotenv";

// Roda antes de CADA arquivo de teste (dentro do worker), então o app/pool são
// criados já apontando para o banco de testes, nunca para o de desenvolvimento.
dotenv.config({ path: path.resolve(__dirname, "../.env.test"), override: true, quiet: true });
// No CI o banco não está em localhost: TEST_DATABASE_URL (definida no pipeline) tem prioridade.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = "test";
// Arquivos anexados nos testes vão para uma pasta temporária, nunca para a de desenvolvimento.
process.env.UPLOADS_DIR = path.join(os.tmpdir(), "flexia-hub-test-uploads");
