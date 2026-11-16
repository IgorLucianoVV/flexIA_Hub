import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { resetDb, createUser } from "./helpers";

describe("Autenticação", () => {
  beforeEach(resetDb);

  it("registra um usuário novo e devolve um token", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Nova Pessoa",
      email: "nova@test.local",
      password: "senha123456",
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe("nova@test.local");
    // Sem `role` no corpo -> cai no papel default "dev", nunca em "admin" por engano.
    expect(res.body.user.role).toBe("dev");
  });

  it("recusa registro com email já cadastrado", async () => {
    await createUser("dev", { email: "duplicado@test.local" });
    const res = await request(app).post("/api/auth/register").send({
      name: "Outra Pessoa",
      email: "duplicado@test.local",
      password: "senha123456",
    });
    expect(res.status).toBe(409);
  });

  it("recusa senha curta", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Pessoa",
      email: "curtinha@test.local",
      password: "123",
    });
    expect(res.status).toBe(400);
  });

  it("faz login com credenciais corretas", async () => {
    const user = await createUser("admin", { email: "admin@test.local", password: "senha123456" });
    const res = await request(app).post("/api/auth/login").send({
      email: user.email,
      password: "senha123456",
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe("admin");
  });

  it("recusa login com senha errada", async () => {
    const user = await createUser("dev", { email: "errado@test.local", password: "senha123456" });
    const res = await request(app).post("/api/auth/login").send({
      email: user.email,
      password: "senhaErrada",
    });
    expect(res.status).toBe(401);
  });

  it("forgot-password devolve devModeToken (modo dev, sem envio real de email)", async () => {
    const user = await createUser("dev", { email: "reset@test.local" });
    const res = await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    expect(res.status).toBe(200);
    expect(res.body.devModeToken).toBeTruthy();
  });

  it("forgot-password não vaza se o email existe ou não (mesma resposta genérica)", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "naoexiste@test.local" });
    expect(res.status).toBe(200);
    expect(res.body.devModeToken).toBeUndefined();
    expect(res.body.message).toBeTruthy();
  });

  it("reset-password troca a senha usando o token do forgot-password e permite logar com a nova senha", async () => {
    const user = await createUser("dev", { email: "fluxo@test.local", password: "senhaAntiga1" });
    const forgot = await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    const token = forgot.body.devModeToken;

    const reset = await request(app).post("/api/auth/reset-password").send({ token, password: "senhaNova123" });
    expect(reset.status).toBe(200);

    const loginOld = await request(app).post("/api/auth/login").send({ email: user.email, password: "senhaAntiga1" });
    expect(loginOld.status).toBe(401);

    const loginNew = await request(app).post("/api/auth/login").send({ email: user.email, password: "senhaNova123" });
    expect(loginNew.status).toBe(200);
  });

  it("reset-password recusa um token inválido", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "token-invento", password: "qualquerSenha1" });
    expect(res.status).toBe(400);
  });
});

afterAll(async () => {
  await pool.end();
});
