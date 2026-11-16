import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { resetDb, createUser } from "./helpers";

async function login(email: string, password = "senha123456") {
  return request(app).post("/api/auth/login").send({ email, password });
}

describe("Sessão: refresh token, rotação e revogação", () => {
  beforeEach(resetDb);

  it("login devolve access token curto e refresh token", async () => {
    const user = await createUser("dev");
    const res = await login(user.email);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.expiresIn).toBe(3600);

    // o refresh token nunca é guardado em texto puro
    const { rows } = await pool.query(`SELECT token_hash FROM refresh_tokens WHERE user_id = $1`, [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(res.body.refreshToken);
  });

  it("refresh troca o par de tokens (rotação) e o access token novo funciona", async () => {
    const user = await createUser("dev");
    const first = await login(user.email);

    const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken: first.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(first.body.refreshToken);

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${refreshed.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(user.email);
  });

  it("reuso de um refresh token já rotacionado derruba a família inteira", async () => {
    const user = await createUser("dev");
    const first = await login(user.email);
    const second = await request(app).post("/api/auth/refresh").send({ refreshToken: first.body.refreshToken });

    // Fora da janela de tolerância (duas abas renovando juntas), reuso é tratado como roubo.
    await pool.query(`UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute' WHERE revoked_at IS NOT NULL`);

    const reuse = await request(app).post("/api/auth/refresh").send({ refreshToken: first.body.refreshToken });
    expect(reuse.status).toBe(401);

    // o token legítimo mais novo também caiu: a pessoa precisa entrar de novo
    const afterReuse = await request(app).post("/api/auth/refresh").send({ refreshToken: second.body.refreshToken });
    expect(afterReuse.status).toBe(401);
  });

  it("tolera duas renovações quase simultâneas com o mesmo token (duas abas)", async () => {
    const user = await createUser("dev");
    const first = await login(user.email);
    const a = await request(app).post("/api/auth/refresh").send({ refreshToken: first.body.refreshToken });
    const b = await request(app).post("/api/auth/refresh").send({ refreshToken: first.body.refreshToken });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it("logout revoga a sessão no servidor", async () => {
    const user = await createUser("dev");
    const session = await login(user.email);
    const out = await request(app).post("/api/auth/logout").send({ refreshToken: session.body.refreshToken });
    expect(out.status).toBe(204);

    await pool.query(`UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute'`);
    const refresh = await request(app).post("/api/auth/refresh").send({ refreshToken: session.body.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it("refresh com token inexistente responde 401", async () => {
    const res = await request(app).post("/api/auth/refresh").send({ refreshToken: "nao-existe" });
    expect(res.status).toBe(401);
  });

  it("ninguém se cadastra como admin", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Esperto", email: "esperto@test.local", password: "senha123456", role: "admin" });
    expect(res.status).toBe(403);
    const { rows } = await pool.query(`SELECT 1 FROM users WHERE email = 'esperto@test.local'`);
    expect(rows).toHaveLength(0);
  });

  it("cadastro aceita os papéis que a própria pessoa pode escolher", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Ana", email: "ana@test.local", password: "senha123456", role: "analista_ativacao" });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("analista_ativacao");
    expect(res.body.refreshToken).toBeTruthy();
  });

  it("conta desativada não entra nem renova sessão", async () => {
    const user = await createUser("dev");
    const session = await login(user.email);
    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [user.id]);

    expect((await login(user.email)).status).toBe(403);
    const refresh = await request(app).post("/api/auth/refresh").send({ refreshToken: session.body.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it("redefinir a senha encerra as sessões abertas", async () => {
    const user = await createUser("dev", { email: "troca@test.local" });
    const session = await login(user.email);
    const forgot = await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    await request(app).post("/api/auth/reset-password").send({ token: forgot.body.devModeToken, password: "novaSenha123" });

    await pool.query(`UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute' WHERE revoked_at IS NOT NULL`);
    const refresh = await request(app).post("/api/auth/refresh").send({ refreshToken: session.body.refreshToken });
    expect(refresh.status).toBe(401);
  });
});

afterAll(async () => {
  await pool.end();
});
