import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { aiClient } from "../src/modules/assistant/aiClient";
import { computeScorecard } from "../src/modules/knowledge/scorecard";
import { resetDb, createUser, authHeader, createClient, createKnowledgeItem, createCategory } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

describe("Scorecard de governança (função pura)", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  const complete = {
    description: "Chatbot de autoatendimento para cadastro e recarga de cartão.",
    owner_team: "Squad FlexIA",
    tags: ["pix"],
    status: "ativo",
    gitlab_web_url: "https://gitlab.com/flexia/bot",
    last_reviewed_at: new Date(now.getTime() - 10 * DAY),
  };

  it("item completo e revisado há pouco é ouro", () => {
    const card = computeScorecard(complete, now);
    expect(card).toMatchObject({ score: 100, level: "ouro", passed: 6, total: 6, stale: false, daysSinceReview: 10 });
  });

  it("item sem dono, sem descrição, sem tags e nunca revisado fica no nível inicial e diz o que fazer", () => {
    const card = computeScorecard({ status: "em_revisao", tags: [] }, now);
    expect(card.level).toBe("inicial");
    expect(card.passed).toBe(0);
    expect(card.stale).toBe(true);
    expect(card.checks.every((c) => !c.passed && c.hint)).toBe(true);
  });

  it("revisão há mais de 180 dias marca o item como parado", () => {
    const card = computeScorecard({ ...complete, last_reviewed_at: new Date(now.getTime() - 200 * DAY) }, now);
    expect(card.stale).toBe(true);
    expect(card.level).toBe("prata");
  });

  it("sincronização recente com o GitLab conta como revisão", () => {
    const card = computeScorecard({ ...complete, last_reviewed_at: null, last_synced_at: new Date(now.getTime() - 2 * DAY) }, now);
    expect(card.stale).toBe(false);
  });

  it("descontinuado só tem ciclo de vida definido se disser o motivo ou o substituto", () => {
    const withoutNote = computeScorecard({ ...complete, status: "deprecado" }, now);
    expect(withoutNote.checks.find((c) => c.key === "lifecycle")!.passed).toBe(false);
    const withNote = computeScorecard({ ...complete, status: "deprecado", deprecation_note: "Substituído pelo agente novo" }, now);
    expect(withNote.checks.find((c) => c.key === "lifecycle")!.passed).toBe(true);
  });
});

describe("Catálogo: edição, revisão e dependências", () => {
  beforeEach(resetDb);

  it("lista devolve o scorecard de cada item e filtra sem depender de acento", async () => {
    const dev = await createUser("dev");
    await createKnowledgeItem({ name: "Integração de Cobrança", tags: ["pix"] });
    await createKnowledgeItem({ name: "Outro item" });

    const res = await request(app).get("/api/knowledge?q=integracao").set(authHeader(dev));
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].scorecard.total).toBe(6);
  });

  it("dev edita o item; analista de suporte não", async () => {
    const item = await createKnowledgeItem();
    const suporte = await createUser("analista_suporte");
    const dev = await createUser("dev");

    const blocked = await request(app).patch(`/api/knowledge/${item.id}`).set(authHeader(suporte)).send({ ownerTeam: "X" });
    expect(blocked.status).toBe(403);

    const ok = await request(app)
      .patch(`/api/knowledge/${item.id}`)
      .set(authHeader(dev))
      .send({ ownerTeam: "Squad FlexIA", tags: ["Bot", "bot", "suporte"] });
    expect(ok.status).toBe(200);
    expect(ok.body.owner_team).toBe("Squad FlexIA");
    expect(ok.body.tags).toEqual(["bot", "suporte"]); // minúsculas e sem repetição
  });

  it("marcar como revisado zera o relógio de revisão", async () => {
    const item = await createKnowledgeItem();
    const dev = await createUser("dev");
    const res = await request(app).post(`/api/knowledge/${item.id}/review`).set(authHeader(dev));
    expect(res.status).toBe(200);
    expect(res.body.scorecard.stale).toBe(false);
    expect(res.body.scorecard.daysSinceReview).toBe(0);
  });

  it("registra dependências e recusa dependência circular", async () => {
    const dev = await createUser("dev");
    const bot = await createKnowledgeItem({ name: "Bot" });
    const integration = await createKnowledgeItem({ name: "Integração" });
    const infra = await createKnowledgeItem({ name: "Infra" });

    const add = (from: string, to: string) =>
      request(app).post(`/api/knowledge/${from}/relations`).set(authHeader(dev)).send({ toId: to });

    expect((await add(bot.id, integration.id)).status).toBe(201);
    expect((await add(integration.id, infra.id)).status).toBe(201);
    expect((await add(bot.id, integration.id)).status).toBe(409); // repetida
    expect((await add(bot.id, bot.id)).status).toBe(400); // consigo mesmo
    // infra -> bot fecharia o laço bot -> integração -> infra -> bot
    const cycle = await add(infra.id, bot.id);
    expect(cycle.status).toBe(409);
    expect(cycle.body.error).toMatch(/circular/);

    const detail = await request(app).get(`/api/knowledge/${integration.id}`).set(authHeader(dev));
    expect(detail.body.dependsOn.map((d: any) => d.name)).toEqual(["Infra"]);
    expect(detail.body.dependents.map((d: any) => d.name)).toEqual(["Bot"]);
  });

  it("descontinuar um item do qual outros dependem avisa admins e devs", async () => {
    const dev = await createUser("dev");
    const admin = await createUser("admin");
    const base = await createKnowledgeItem({ name: "Conector antigo" });
    const dependent = await createKnowledgeItem({ name: "Bot que usa" });
    await pool.query(`INSERT INTO knowledge_relations (from_id, to_id) VALUES ($1,$2)`, [dependent.id, base.id]);

    await request(app).patch(`/api/knowledge/${base.id}`).set(authHeader(dev)).send({ status: "deprecado", deprecationNote: "Legado" });

    const { rows } = await pool.query(`SELECT title FROM notifications WHERE user_id = $1`, [admin.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain("Conector antigo");
  });
});

describe("Ativação: templates, progresso derivado e prazos", () => {
  beforeEach(resetDb);

  async function createFromTemplate(startDate = "2026-01-01") {
    const analista = await createUser("analista_ativacao");
    const client = await createClient({ name: "Cliente Novo" });
    const templates = await request(app).get("/api/activation/templates").set(authHeader(analista));
    const template = templates.body.find((t: any) => t.name === "Ativação padrão");
    const project = await request(app)
      .post("/api/activation/projects")
      .set(authHeader(analista))
      .send({ name: "Onboarding", clientId: client.id, templateId: template.id, startDate });
    return { analista, client, project, template };
  }

  it("projeto criado a partir do template nasce com fases, artefatos e prazos calculados", async () => {
    const { analista, project } = await createFromTemplate("2026-01-01");
    expect(project.status).toBe(201);
    expect(project.body.target_date).toBe("2026-03-22"); // início + 80 dias (último artefato)

    const list = await request(app).get("/api/activation/projects").set(authHeader(analista));
    expect(list.body.total).toBe(1);
    const created = list.body.items[0];
    expect(created.phases).toHaveLength(5);
    expect(created.totalArtifacts).toBe(14);
    expect(created.phases[0].name).toBe("Kickoff");
    expect(created.phases[0].artifacts[0]).toMatchObject({ name: "Ata de kickoff", due_date: "2026-01-04" });
  });

  it("template inexistente não deixa projeto pela metade", async () => {
    const analista = await createUser("analista_ativacao");
    const client = await createClient();
    const res = await request(app)
      .post("/api/activation/projects")
      .set(authHeader(analista))
      .send({ name: "X", clientId: client.id, templateId: "nao-existe" });
    expect(res.status).toBe(400);
    expect((await pool.query(`SELECT 1 FROM activation_projects`)).rows).toHaveLength(0);
  });

  it("concluir todos os artefatos conclui o projeto, avisa o time e reabrir um artefato reabre o projeto", async () => {
    const { analista, project } = await createFromTemplate();
    const admin = await createUser("admin");
    const { rows: artifacts } = await pool.query(
      `SELECT a.id FROM activation_artifacts a JOIN activation_phases ph ON ph.id = a.phase_id WHERE ph.project_id = $1`,
      [project.body.id]
    );
    for (const artifact of artifacts) {
      await request(app).patch(`/api/activation/artifacts/${artifact.id}`).set(authHeader(analista)).send({ status: "concluido" });
    }

    const status = async () => (await pool.query(`SELECT status FROM activation_projects WHERE id = $1`, [project.body.id])).rows[0].status;
    expect(await status()).toBe("concluido");
    const phases = await pool.query(`SELECT DISTINCT status FROM activation_phases WHERE project_id = $1`, [project.body.id]);
    expect(phases.rows).toEqual([{ status: "concluido" }]);

    const notified = await pool.query(`SELECT title FROM notifications WHERE user_id = $1 AND type = 'activation.project.completed'`, [admin.id]);
    expect(notified.rows).toHaveLength(1);

    await request(app).patch(`/api/activation/artifacts/${artifacts[0].id}`).set(authHeader(analista)).send({ status: "pendente" });
    expect(await status()).toBe("em_andamento");
  });

  it("lista é paginada e o filtro 'atrasado' pega prazo vencido mesmo sem ninguém marcar", async () => {
    const analista = await createUser("analista_ativacao");
    const client = await createClient();
    for (const [name, targetDate] of [["No prazo", "2099-01-01"], ["Vencido", "2020-01-01"], ["Outro", "2099-06-01"]]) {
      await request(app).post("/api/activation/projects").set(authHeader(analista)).send({ name, clientId: client.id, targetDate });
    }
    const page = await request(app).get("/api/activation/projects?limit=2").set(authHeader(analista));
    expect(page.body.items).toHaveLength(2);
    expect(page.body.total).toBe(3);

    const overdue = await request(app).get("/api/activation/projects?status=atrasado").set(authHeader(analista));
    expect(overdue.body.items.map((p: any) => p.name)).toEqual(["Vencido"]);
    expect(overdue.body.items[0].is_overdue).toBe(true);
  });

  it("'upcoming' lista artefatos em aberto vencidos ou vencendo em breve", async () => {
    const { analista } = await createFromTemplate(new Date(Date.now() - 5 * DAY).toISOString().slice(0, 10));
    const res = await request(app).get("/api/activation/upcoming?days=7").set(authHeader(analista));
    const names = res.body.items.map((a: any) => a.name);
    expect(names).toContain("Ata de kickoff"); // venceu há 2 dias
    expect(names).toContain("Levantamento de requisitos"); // vence em 2 dias
    expect(names).not.toContain("Relatório de resultados"); // só daqui a 75 dias
    expect(res.body.items.find((a: any) => a.name === "Ata de kickoff").is_overdue).toBe(true);
  });
});

describe("Clientes: lista paginada, alertas manuais e histórico de saúde", () => {
  beforeEach(resetDb);

  it("lista paginada, com busca sem acento e ordenação por quem precisa de atenção", async () => {
    const admin = await createUser("admin");
    await createClient({ name: "Órgão Público", healthScore: 90 });
    await createClient({ name: "Banco Beta", healthScore: 40 });
    await createClient({ name: "Clínica Gama", healthScore: 70 });

    const page = await request(app).get("/api/clients?limit=2&sort=health").set(authHeader(admin));
    expect(page.body.total).toBe(3);
    expect(page.body.items.map((c: any) => c.name)).toEqual(["Banco Beta", "Clínica Gama"]);

    const search = await request(app).get("/api/clients?q=orgao").set(authHeader(admin));
    expect(search.body.items.map((c: any) => c.name)).toEqual(["Órgão Público"]);
  });

  it("alerta manual derruba o score, resolver recupera, e a Visão 360 traz composição e histórico", async () => {
    const analista = await createUser("analista_suporte");
    const client = await createClient();

    const alert = await request(app).post(`/api/clients/${client.id}/alerts`).set(authHeader(analista)).send({ severity: "critica", message: "Bot fora do ar" });
    expect(alert.status).toBe(201);

    const view = await request(app).get(`/api/clients/${client.id}/360`).set(authHeader(analista));
    expect(view.body.client.health_score).toBe(76); // 100 - 8*3
    const manual = view.body.client.health_breakdown.components.find((c: any) => c.key === "manual_alerts");
    expect(manual).toMatchObject({ count: 1, penalty: 24, maxPenalty: 30 });
    expect(view.body.healthHistory).toHaveLength(1);
    expect(view.body.healthHistory[0].score).toBe(76);

    const resolved = await request(app).post(`/api/clients/${client.id}/alerts/${alert.body.id}/resolve`).set(authHeader(analista));
    expect(resolved.status).toBe(200);
    const after = await request(app).get(`/api/clients/${client.id}/360`).set(authHeader(analista));
    expect(after.body.client.health_score).toBe(100);
    // um ponto por dia: o recálculo no mesmo dia atualiza o ponto em vez de criar outro
    expect(after.body.healthHistory).toHaveLength(1);
    expect(after.body.healthHistory[0].score).toBe(100);
  });

  it("dev não abre alerta de cliente", async () => {
    const dev = await createUser("dev");
    const client = await createClient();
    const res = await request(app).post(`/api/clients/${client.id}/alerts`).set(authHeader(dev)).send({ severity: "alta", message: "x" });
    expect(res.status).toBe(403);
  });
});

describe("Busca global e painel", () => {
  beforeEach(resetDb);

  it("encontra em várias fontes, ignorando acento e maiúsculas", async () => {
    const dev = await createUser("dev");
    const category = await createCategory();
    const client = await createClient({ name: "Ativação Brasil" });
    await createKnowledgeItem({ name: "Bot de ativação" });
    await pool.query(`INSERT INTO forum_threads (title, body, category_id, author_id) VALUES ('Dúvida de ATIVAÇÃO','corpo',$1,$2)`, [category.id, dev.id]);
    await pool.query(`INSERT INTO client_documents (title, source, client_id) VALUES ('Contrato de serviço','manual',$1)`, [client.id]);

    const res = await request(app).get("/api/search?q=ativacao").set(authHeader(dev));
    const types = res.body.results.map((r: any) => r.type).sort();
    expect(types).toEqual(["catalogo", "cliente", "forum"]);
    expect(res.body.results.find((r: any) => r.type === "cliente").path).toBe(`/clientes/${client.id}`);

    const short = await request(app).get("/api/search?q=a").set(authHeader(dev));
    expect(short.body.results).toEqual([]);
  });

  it("painel devolve os agregados calculados no banco", async () => {
    const admin = await createUser("admin");
    await createClient({ name: "Saudável", healthScore: 95 });
    const risky = await createClient({ name: "Em risco", healthScore: 40 });
    await pool.query(`INSERT INTO client_alerts (client_id, severity, message) VALUES ($1,'critica','x')`, [risky.id]);
    await createKnowledgeItem();

    const res = await request(app).get("/api/dashboard/summary").set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.clients).toMatchObject({ total: 2, atRisk: 1, avgHealth: 68 });
    expect(res.body.clients.attention[0].name).toBe("Em risco");
    expect(res.body.alerts).toEqual({ open: 1, high: 1 });
    expect(res.body.knowledge.total).toBe(1);
  });
});

describe("Fórum: resposta aceita", () => {
  beforeEach(resetDb);

  it("só o autor do tópico (ou admin) marca a solução, e o autor da resposta é avisado", async () => {
    const category = await createCategory();
    const author = await createUser("dev");
    const helper = await createUser("analista_suporte");
    const thread = await request(app).post("/api/forum/threads").set(authHeader(author)).send({ title: "Erro no bot", body: "…", categoryId: category.id });
    const reply = await request(app).post(`/api/forum/threads/${thread.body.id}/replies`).set(authHeader(helper)).send({ body: "Faça assim" });

    const blocked = await request(app).post(`/api/forum/threads/${thread.body.id}/accept`).set(authHeader(helper)).send({ replyId: reply.body.id });
    expect(blocked.status).toBe(403);

    const accepted = await request(app).post(`/api/forum/threads/${thread.body.id}/accept`).set(authHeader(author)).send({ replyId: reply.body.id });
    expect(accepted.status).toBe(200);
    expect(accepted.body.accepted_reply_id).toBe(reply.body.id);

    const { rows } = await pool.query(`SELECT title FROM notifications WHERE user_id = $1 AND type = 'forum.reply.accepted'`, [helper.id]);
    expect(rows).toHaveLength(1);

    const wrong = await request(app).post(`/api/forum/threads/${thread.body.id}/accept`).set(authHeader(author)).send({ replyId: "de-outro-topico" });
    expect(wrong.status).toBe(400);
  });
});

describe("Administração", () => {
  beforeEach(resetDb);

  it("só admin acessa", async () => {
    const dev = await createUser("dev");
    expect((await request(app).get("/api/admin/users").set(authHeader(dev))).status).toBe(403);
    expect((await request(app).get("/api/admin/audit").set(authHeader(dev))).status).toBe(403);
  });

  it("admin muda o papel de alguém, que é avisado; a mudança entra na auditoria", async () => {
    const admin = await createUser("admin");
    const dev = await createUser("dev", { name: "Dev Promovido" });

    const res = await request(app).patch(`/api/admin/users/${dev.id}`).set(authHeader(admin)).send({ role: "analista_ativacao" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("analista_ativacao");
    expect(res.body.password_hash).toBeUndefined();

    const notified = await pool.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'user.role.changed'`, [dev.id]);
    expect(notified.rows).toHaveLength(1);

    const audit = await request(app).get("/api/admin/audit?action=user").set(authHeader(admin));
    expect(audit.body.items[0].summary).toContain("Dev Promovido");
  });

  it("admin não remove o próprio acesso e o Hub nunca fica sem admin", async () => {
    const admin = await createUser("admin");
    const self = await request(app).patch(`/api/admin/users/${admin.id}`).set(authHeader(admin)).send({ role: "dev" });
    expect(self.status).toBe(400);

    const other = await createUser("admin");
    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [admin.id]);
    // `other` agora é o único admin ativo: quem tentar rebaixá-lo é barrado
    const third = await createUser("admin");
    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [third.id]);
    const res = await request(app).patch(`/api/admin/users/${other.id}`).set(authHeader(third)).send({ isActive: false });
    expect(res.status).toBe(409);
  });

  it("desativar uma conta encerra as sessões dela", async () => {
    const admin = await createUser("admin");
    const dev = await createUser("dev");
    const login = await request(app).post("/api/auth/login").send({ email: dev.email, password: dev.rawPassword });

    await request(app).patch(`/api/admin/users/${dev.id}`).set(authHeader(admin)).send({ isActive: false });

    const refresh = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(refresh.status).toBe(401);
  });
});

describe("Assistente: histórico, feedback e falhas do serviço de IA", () => {
  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
  });

  const fakeAnswer = { answer: "O CREA está em risco.", sources_used: ["clientes"], citations: [{ type: "cliente", id: "1", label: "CREA", path: "/clientes/1" }], ai_configured: false };

  it("grava cada pergunta, devolve no histórico e envia as trocas anteriores como contexto", async () => {
    const dev = await createUser("dev");
    const post = vi.spyOn(aiClient, "post").mockResolvedValue({ data: fakeAnswer } as any);

    const first = await request(app).post("/api/assistant/ask").set(authHeader(dev)).send({ question: "Quem está em risco?" });
    expect(first.status).toBe(200);
    expect(first.body.interactionId).toBeTruthy();
    expect(post.mock.calls[0][1]).toEqual({ question: "Quem está em risco?", history: [] });

    await request(app).post("/api/assistant/ask").set(authHeader(dev)).send({ question: "E o prazo dele?" });
    expect((post.mock.calls[1][1] as any).history).toEqual([{ question: "Quem está em risco?", answer: "O CREA está em risco." }]);

    const history = await request(app).get("/api/assistant/history").set(authHeader(dev));
    expect(history.body.map((h: any) => h.question)).toEqual(["Quem está em risco?", "E o prazo dele?"]);
  });

  it("cada pessoa só avalia e só enxerga as próprias interações", async () => {
    const dev = await createUser("dev");
    const other = await createUser("dev");
    vi.spyOn(aiClient, "post").mockResolvedValue({ data: fakeAnswer } as any);
    const asked = await request(app).post("/api/assistant/ask").set(authHeader(dev)).send({ question: "Pergunta" });

    const foreign = await request(app).post(`/api/assistant/interactions/${asked.body.interactionId}/feedback`).set(authHeader(other)).send({ value: -1 });
    expect(foreign.status).toBe(404);
    expect((await request(app).get("/api/assistant/history").set(authHeader(other))).body).toEqual([]);

    const mine = await request(app).post(`/api/assistant/interactions/${asked.body.interactionId}/feedback`).set(authHeader(dev)).send({ value: -1 });
    expect(mine.body.feedback).toBe(-1);

    const admin = await createUser("admin");
    const insights = await request(app).get("/api/admin/assistant/insights").set(authHeader(admin));
    expect(insights.body.totals).toMatchObject({ questions: 1, negative: 1, users: 1 });
    expect(insights.body.negative[0].question).toBe("Pergunta");
  });

  it("serviço de IA fora do ar vira 503 com mensagem clara, sem gravar interação", async () => {
    const dev = await createUser("dev");
    vi.spyOn(aiClient, "post").mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    const res = await request(app).post("/api/assistant/ask").set(authHeader(dev)).send({ question: "Oi" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Serviço de IA indisponível/);
    expect((await pool.query(`SELECT 1 FROM assistant_interactions`)).rows).toHaveLength(0);
  });

  it("pergunta vazia é recusada antes de chamar o serviço de IA", async () => {
    const dev = await createUser("dev");
    const post = vi.spyOn(aiClient, "post");
    const res = await request(app).post("/api/assistant/ask").set(authHeader(dev)).send({ question: "  " });
    expect(res.status).toBe(400);
    expect(post).not.toHaveBeenCalled();
  });
});

afterAll(async () => {
  await pool.end();
});
