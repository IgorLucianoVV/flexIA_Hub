import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setupEnv.ts"],
    // Os testes compartilham um banco Postgres real (não há mock nem transação por teste),
    // então rodam em série pra evitar corrida entre um teste truncando tabelas enquanto
    // outro ainda está lendo/escrevendo nelas.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
