import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { resetDb, createUser, authHeader, createClient, createCategory } from "./helpers";

async function notificationsOf(userId: string) {
  const { rows } = await pool.query(`SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at`, [userId]);
  return rows;
}

describe("Eventos de domínio: auditoria e notificações", () => {
  beforeEach(resetDb);

  it("toda escrita deixa uma linha no log de auditoria com quem fez o quê", async () => {
    const admin = await createUser("admin", { name: "Admin de Teste" });
    const res = await request(app).post("/api/clients").set(authHeader(admin)).send({ name: "Cliente Auditado" });

    const { rows } = await pool.query(`SELECT * FROM audit_log`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: admin.id,
      actor_name: "Admin de Teste",
      action: "client.created",
      entity_type: "client",
      entity_id: res.body.id,
    });
    expect(rows[0].summary).toContain("Cliente Auditado");
  });

  it("requisição recusada (sem permissão) não gera auditoria", async () => {
    const dev = await createUser("dev");
    await request(app).post("/api/clients").set(authHeader(dev)).send({ name: "Não deveria existir" });
    const { rows } = await pool.query(`SELECT 1 FROM audit_log`);
    expect(rows).toHaveLength(0);
  });

  it("resposta no fórum notifica o autor e quem já participou — nunca quem respondeu", async () => {
    const category = await createCategory();
    const author = await createUser("dev");
    const participant = await createUser("analista_suporte");
    const replier = await createUser("analista_ativacao");
    const bystander = await createUser("dev");

    const thread = await request(app)
      .post("/api/forum/threads")
      .set(authHeader(author))
      .send({ title: "Dúvida sobre o bot", body: "Como configuro?", categoryId: category.id });
    await request(app).post(`/api/forum/threads/${thread.body.id}/replies`).set(authHeader(participant)).send({ body: "Também quero saber" });
    await request(app).post(`/api/forum/threads/${thread.body.id}/replies`).set(authHeader(replier)).send({ body: "É assim…" });

    const authorNotifications = await notificationsOf(author.id);
    expect(authorNotifications).toHaveLength(2);
    expect(authorNotifications[0].title).toContain("Dúvida sobre o bot");
    expect(authorNotifications[0].link).toBe(`/forum/${thread.body.id}`);

    expect(await notificationsOf(participant.id)).toHaveLength(1); // avisado da resposta do terceiro
    expect(await notificationsOf(replier.id)).toHaveLength(0);
    expect(await notificationsOf(bystander.id)).toHaveLength(0);
  });

  it("alerta de severidade alta avisa quem cuida de clientes; severidade baixa não", async () => {
    const client = await createClient({ name: "Cliente Crítico" });
    const admin = await createUser("admin");
    const ativacao = await createUser("analista_ativacao");
    const dev = await createUser("dev");

    await request(app).post(`/api/clients/${client.id}/alerts`).set(authHeader(admin)).send({ severity: "baixa", message: "Detalhe" });
    expect(await notificationsOf(ativacao.id)).toHaveLength(0);

    await request(app).post(`/api/clients/${client.id}/alerts`).set(authHeader(admin)).send({ severity: "critica", message: "Bot fora do ar" });
    const received = await notificationsOf(ativacao.id);
    expect(received).toHaveLength(1);
    expect(received[0].title).toContain("Cliente Crítico");
    expect(received[0].body).toBe("Bot fora do ar");

    expect(await notificationsOf(dev.id)).toHaveLength(0); // dev não cuida de clientes
    expect(await notificationsOf(admin.id)).toHaveLength(0); // quem abriu não é avisado do próprio alerta
  });

  it("usuário lê, marca como lida e não enxerga notificação de outra pessoa", async () => {
    const me = await createUser("dev");
    const other = await createUser("dev");
    const { rows } = await pool.query(
      `INSERT INTO notifications (user_id, type, title) VALUES ($1,'teste','Minha'), ($1,'teste','Minha 2'), ($2,'teste','Da outra pessoa')
       RETURNING id, user_id, title`,
      [me.id, other.id]
    );
    const othersNotification = rows.find((r) => r.user_id === other.id)!;
    const mine = rows.find((r) => r.title === "Minha")!;

    const list = await request(app).get("/api/notifications").set(authHeader(me));
    expect(list.body.unreadCount).toBe(2);
    expect(list.body.items.map((n: any) => n.title).sort()).toEqual(["Minha", "Minha 2"]);

    expect((await request(app).post(`/api/notifications/${othersNotification.id}/read`).set(authHeader(me))).status).toBe(404);
    expect((await request(app).post(`/api/notifications/${mine.id}/read`).set(authHeader(me))).status).toBe(200);
    expect((await request(app).get("/api/notifications/unread-count").set(authHeader(me))).body.unreadCount).toBe(1);

    await request(app).post("/api/notifications/read-all").set(authHeader(me));
    expect((await request(app).get("/api/notifications/unread-count").set(authHeader(me))).body.unreadCount).toBe(0);
    // a notificação da outra pessoa continua não lida
    expect((await request(app).get("/api/notifications/unread-count").set(authHeader(other))).body.unreadCount).toBe(1);
  });
});

afterAll(async () => {
  await pool.end();
});
