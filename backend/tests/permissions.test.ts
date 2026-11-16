import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { resetDb, createUser, authHeader, createClient } from "./helpers";

// Cobre a lacuna de segurança corrigida na tarefa "Permissões por papel de verdade":
// antes dessas rotas, qualquer pessoa logada (ou até deslogada) podia escrever em
// endpoints que deveriam ser restritos. Estes testes travam esse comportamento.
describe("Permissões por papel", () => {
  beforeEach(resetDb);

  it("bloqueia criar cliente sem estar logado (401)", async () => {
    const res = await request(app).post("/api/clients").send({ name: "Cliente Sem Login" });
    expect(res.status).toBe(401);
  });

  it("bloqueia um dev de criar cliente (403) mas permite um admin", async () => {
    const dev = await createUser("dev");
    const blocked = await request(app)
      .post("/api/clients")
      .set(authHeader(dev))
      .send({ name: "Cliente do Dev" });
    expect(blocked.status).toBe(403);

    const admin = await createUser("admin");
    const allowed = await request(app)
      .post("/api/clients")
      .set(authHeader(admin))
      .send({ name: "Cliente do Admin" });
    expect(allowed.status).toBe(201);
  });

  it("permite analista_ativacao criar cliente (mesmo papel liberado que admin)", async () => {
    const analista = await createUser("analista_ativacao");
    const res = await request(app)
      .post("/api/clients")
      .set(authHeader(analista))
      .send({ name: "Cliente da Ativação" });
    expect(res.status).toBe(201);
  });

  it("bloqueia dev/analista_suporte de criar categoria do fórum, admin consegue", async () => {
    const suporte = await createUser("analista_suporte");
    const blocked = await request(app)
      .post("/api/forum/categories")
      .set(authHeader(suporte))
      .send({ slug: "teste", name: "Teste" });
    expect(blocked.status).toBe(403);

    const admin = await createUser("admin");
    const allowed = await request(app)
      .post("/api/forum/categories")
      .set(authHeader(admin))
      .send({ slug: "teste", name: "Teste" });
    expect(allowed.status).toBe(201);
  });

  it("qualquer papel logado pode criar tópico e responder no fórum", async () => {
    const admin = await createUser("admin");
    const cat = await request(app).post("/api/forum/categories").set(authHeader(admin)).send({ slug: "geral", name: "Geral" });

    const suporte = await createUser("analista_suporte");
    const thread = await request(app)
      .post("/api/forum/threads")
      .set(authHeader(suporte))
      .send({ title: "Dúvida", body: "Corpo do tópico", categoryId: cat.body.id });
    expect(thread.status).toBe(201);

    const reply = await request(app)
      .post(`/api/forum/threads/${thread.body.id}/replies`)
      .set(authHeader(suporte))
      .send({ body: "Resposta" });
    expect(reply.status).toBe(201);
  });

  it("só o autor ou um admin pode editar/apagar um tópico do fórum", async () => {
    const admin = await createUser("admin");
    const cat = await request(app).post("/api/forum/categories").set(authHeader(admin)).send({ slug: "geral", name: "Geral" });

    const autor = await createUser("dev");
    const outraPessoa = await createUser("analista_suporte");

    const thread = await request(app)
      .post("/api/forum/threads")
      .set(authHeader(autor))
      .send({ title: "Original", body: "Corpo", categoryId: cat.body.id });

    const blocked = await request(app)
      .patch(`/api/forum/threads/${thread.body.id}`)
      .set(authHeader(outraPessoa))
      .send({ title: "Editado por quem não devia" });
    expect(blocked.status).toBe(403);

    const byAuthor = await request(app)
      .patch(`/api/forum/threads/${thread.body.id}`)
      .set(authHeader(autor))
      .send({ title: "Editado pelo autor" });
    expect(byAuthor.status).toBe(200);
    expect(byAuthor.body.title).toBe("Editado pelo autor");

    const byAdmin = await request(app)
      .delete(`/api/forum/threads/${thread.body.id}`)
      .set(authHeader(admin));
    expect(byAdmin.status).toBe(204);
  });

  it("bloqueia dev/analista_suporte de planejar ativação (criar projeto), mas libera admin/analista_ativacao", async () => {
    const client = await createClient({ name: "Cliente Ativação" });
    const dev = await createUser("dev");

    const blocked = await request(app)
      .post("/api/activation/projects")
      .set(authHeader(dev))
      .send({ name: "Projeto X", clientId: client.id });
    expect(blocked.status).toBe(403);

    const analista = await createUser("analista_ativacao");
    const allowed = await request(app)
      .post("/api/activation/projects")
      .set(authHeader(analista))
      .send({ name: "Projeto Y", clientId: client.id });
    expect(allowed.status).toBe(201);
  });

  it("libera dev para executar (atualizar status de artefato), mesmo sem poder planejar", async () => {
    const client = await createClient({ name: "Cliente Execução" });
    const analista = await createUser("analista_ativacao");
    const project = await request(app)
      .post("/api/activation/projects")
      .set(authHeader(analista))
      .send({ name: "Projeto", clientId: client.id });
    const phase = await request(app)
      .post(`/api/activation/projects/${project.body.id}/phases`)
      .set(authHeader(analista))
      .send({ name: "Fase 1" });
    const artifact = await request(app)
      .post(`/api/activation/phases/${phase.body.id}/artifacts`)
      .set(authHeader(analista))
      .send({ name: "Artefato 1" });

    const dev = await createUser("dev");
    const res = await request(app)
      .patch(`/api/activation/artifacts/${artifact.body.id}`)
      .set(authHeader(dev))
      .send({ status: "concluido" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("concluido");
  });
});

afterAll(async () => {
  await pool.end();
});
