import { describe, it, expect, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { createLimiter } from "../src/lib/rateLimit";
import { runMigrations } from "../src/lib/migrate";
import { resetDb, createUser, authHeader, createCategory } from "./helpers";

describe("Leitura exige login (nenhum dado da plataforma sai sem token)", () => {
  const routes = [
    "/api/clients",
    "/api/clients/qualquer-id",
    "/api/clients/qualquer-id/360",
    "/api/clients/qualquer-id/clickup-tasks",
    "/api/activation/projects",
    "/api/activation/templates",
    "/api/activation/upcoming",
    "/api/knowledge",
    "/api/knowledge/governance",
    "/api/knowledge/qualquer-id",
    "/api/forum/categories",
    "/api/forum/threads",
    "/api/forum/threads/qualquer-id",
    "/api/assistant/status",
    "/api/assistant/history",
    "/api/notifications",
    "/api/search?q=teste",
    "/api/dashboard/summary",
    "/api/integrations/status",
    "/api/admin/users",
    "/api/admin/audit",
  ];

  it.each(routes)("GET %s responde 401 sem token", async (route) => {
    const res = await request(app).get(route);
    expect(res.status).toBe(401);
  });

  it("POST /api/assistant/ask responde 401 sem token", async () => {
    const res = await request(app).post("/api/assistant/ask").send({ question: "oi" });
    expect(res.status).toBe(401);
  });

  it("token forjado com outro segredo é recusado", async () => {
    const jwt = await import("jsonwebtoken");
    const forged = jwt.default.sign({ id: "x", name: "x", email: "x@x", role: "admin" }, "dev-secret-inseguro");
    const res = await request(app).get("/api/admin/users").set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});

describe("Erros e validação", () => {
  beforeEach(resetDb);

  it("corpo inválido responde 400 dizendo qual campo está errado", async () => {
    const admin = await createUser("admin");
    const res = await request(app).post("/api/clients").set(authHeader(admin)).send({ name: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
    expect(res.body.details[0].field).toBe("name");
  });

  it("JSON malformado responde 400, não 500", async () => {
    const admin = await createUser("admin");
    const res = await request(app)
      .post("/api/clients")
      .set(authHeader(admin))
      .set("Content-Type", "application/json")
      .send("{isso não é json");
    expect(res.status).toBe(400);
  });

  it("referência a registro inexistente responde 400, não 500", async () => {
    const dev = await createUser("dev");
    const res = await request(app)
      .post("/api/forum/threads")
      .set(authHeader(dev))
      .send({ title: "Tópico", body: "Corpo", categoryId: "categoria-que-nao-existe" });
    expect(res.status).toBe(400);
  });

  it("valor fora do conjunto permitido é recusado", async () => {
    const dev = await createUser("dev");
    const res = await request(app).patch("/api/activation/artifacts/qualquer").set(authHeader(dev)).send({ status: "voando" });
    expect(res.status).toBe(400);
  });

  it("rota inexistente responde 404 em JSON", async () => {
    const res = await request(app).get("/api/isso-nao-existe");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Rota não encontrada/);
  });

  it("toda resposta carrega um id de requisição e cabeçalhos de segurança", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("texto de busca com % e _ não vira curinga", async () => {
    const admin = await createUser("admin");
    await createCategory();
    await request(app).post("/api/clients").set(authHeader(admin)).send({ name: "Cliente Um" });
    const res = await request(app).get("/api/clients?q=%25").set(authHeader(admin));
    expect(res.body.total).toBe(0);
  });
});

describe("Health checks", () => {
  it("readiness confere a conexão real com o banco", async () => {
    const res = await request(app).get("/api/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.checks.database.ok).toBe(true);
    expect(typeof res.body.checks.database.latencyMs).toBe("number");
  });
});

describe("Limite de requisições", () => {
  it("responde 429 depois de estourar o limite da janela", async () => {
    const limited = express();
    limited.use(createLimiter({ windowMinutes: 1, limit: 3, message: "Devagar", force: true }));
    limited.get("/", (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 3; i++) expect((await request(limited).get("/")).status).toBe(200);
    const blocked = await request(limited).get("/");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("Devagar");
  });
});

describe("Migrações", () => {
  it("rodar de novo não reaplica nada (idempotente)", async () => {
    const result = await runMigrations(process.env.DATABASE_URL!);
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toBeGreaterThanOrEqual(10);
    expect(result.warnings).toEqual([]);
  });
});

afterAll(async () => {
  await pool.end();
});
