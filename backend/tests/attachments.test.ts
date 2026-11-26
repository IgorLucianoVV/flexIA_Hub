import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { dialogTreeToText, normalizeDialogTree } from "../src/modules/knowledge/dialogTree";
import { resetDb, createUser, authHeader, createKnowledgeItem } from "./helpers";

// PDF mínimo de uma página com o texto "Fluxo de recarga Libercard".
const SAMPLE_PDF = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 60>>stream
BT /F1 18 Tf 20 100 Td (Fluxo de recarga Libercard) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`);

describe("Árvore de diálogo: normalização (função pura)", () => {
  it("aceita o formato do Hub (nodes + edges) e respeita a raiz", () => {
    const { tree, warnings } = normalizeDialogTree(
      JSON.stringify({
        root: "inicio",
        nodes: [
          { id: "inicio", label: "Início", text: "Olá! Como posso ajudar?" },
          { id: "cartao", label: "Cartão" },
        ],
        edges: [
          { from: "inicio", to: "cartao", label: "Cartão" },
          { from: "inicio", to: "fantasma" },
        ],
      })
    );
    expect(tree.root).toBe("inicio");
    expect(tree.nodes).toHaveLength(2);
    expect(tree.edges).toEqual([{ from: "inicio", to: "cartao", label: "Cartão" }]);
    expect(warnings[0]).toMatch(/fantasma/);
  });

  it("converte uma árvore aninhada com opções", () => {
    const { tree } = normalizeDialogTree(
      JSON.stringify({
        title: "Boas-vindas",
        message: "Olá! Escolha uma opção",
        options: [
          { label: "Segunda via", next: { title: "Segunda via", text: "Informe o CPF" } },
          { label: "Falar com atendente", next: { title: "Transbordo" } },
        ],
      })
    );
    expect(tree.nodes.map((n) => n.label)).toEqual(["Boas-vindas", "Segunda via", "Transbordo"]);
    expect(tree.edges.map((e) => e.label)).toEqual(["Segunda via", "Falar com atendente"]);
    expect(tree.root).toBe(tree.nodes[0].id);
    expect(tree.nodes[1].text).toBe("Informe o CPF");
  });

  it("converte uma lista de nós com transições por id e acha a raiz pelo nó sem entrada", () => {
    const { tree } = normalizeDialogTree(
      JSON.stringify([
        { id: "menu", text: "Menu principal", transitions: [{ label: "Saldo", to: "saldo" }] },
        { id: "saldo", text: "Seu saldo é…", next: "fim" },
        { id: "fim", text: "Posso ajudar em algo mais?" },
      ])
    );
    expect(tree.root).toBe("menu");
    expect(tree.edges).toEqual([
      { from: "menu", to: "saldo", label: "Saldo" },
      { from: "saldo", to: "fim" },
    ]);
    expect(dialogTreeToText(tree)).toContain(`"Saldo" leva a "Seu saldo é…"`);
  });

  it("recusa JSON inválido e JSON sem nós", () => {
    expect(() => normalizeDialogTree("{nao é json")).toThrow(/JSON válido/);
    expect(() => normalizeDialogTree("[]")).toThrow(/Nenhum nó/);
  });
});

describe("Anexos do catálogo (API)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await pool.end();
  });

  it("dev cria documentação em Markdown; qualquer logado lê; a alteração vai para a auditoria", async () => {
    const dev = await createUser("dev");
    const support = await createUser("analista_suporte");
    const item = await createKnowledgeItem({ name: "Bot Libercard" });

    const created = await request(app)
      .post(`/api/knowledge/${item.id}/attachments`)
      .set(authHeader(dev))
      .send({ kind: "documento", title: "Como funciona", content: "# Bot Libercard\n\nAtende **recarga** e saldo." });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: "documento", title: "Como funciona", updated_by_name: dev.name });

    const list = await request(app).get(`/api/knowledge/${item.id}/attachments`).set(authHeader(support));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].content).toBeUndefined(); // a listagem não carrega o conteúdo

    const one = await request(app).get(`/api/knowledge/${item.id}/attachments/${created.body.id}`).set(authHeader(support));
    expect(one.body.content).toContain("**recarga**");

    const detail = await request(app).get(`/api/knowledge/${item.id}`).set(authHeader(support));
    expect(detail.body.attachmentCounts).toEqual({ documento: 1 });

    const audit = await pool.query(`SELECT summary FROM audit_log WHERE action = 'knowledge.attachment.created'`);
    expect(audit.rows[0].summary).toContain('"Como funciona"');
  });

  it("só admin e dev escrevem anexos", async () => {
    const support = await createUser("analista_suporte");
    const item = await createKnowledgeItem();
    const res = await request(app)
      .post(`/api/knowledge/${item.id}/attachments`)
      .set(authHeader(support))
      .send({ kind: "documento", title: "x", content: "y" });
    expect(res.status).toBe(403);
  });

  it("árvore de diálogo é normalizada ao salvar e volta como objeto", async () => {
    const dev = await createUser("dev");
    const item = await createKnowledgeItem({ type: "arvore_dialogo" });
    const res = await request(app)
      .post(`/api/knowledge/${item.id}/attachments`)
      .set(authHeader(dev))
      .send({
        kind: "arvore_dialogo",
        title: "Fluxo principal",
        content: JSON.stringify({ title: "Início", options: [{ label: "Saldo", next: { title: "Saldo" } }] }),
      });
    expect(res.status).toBe(201);
    const one = await request(app).get(`/api/knowledge/${item.id}/attachments/${res.body.id}`).set(authHeader(dev));
    expect(one.body.content.nodes).toHaveLength(2);
    expect(one.body.content.edges[0]).toMatchObject({ label: "Saldo" });

    const bad = await request(app)
      .post(`/api/knowledge/${item.id}/attachments`)
      .set(authHeader(dev))
      .send({ kind: "arvore_dialogo", title: "Quebrada", content: "{ não é json" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/JSON válido/);
  });

  it("pré-visualiza uma árvore sem salvar", async () => {
    const dev = await createUser("analista_suporte");
    const res = await request(app)
      .post(`/api/knowledge/dialog-tree/preview`)
      .set(authHeader(dev))
      .send({ content: JSON.stringify([{ id: "a", text: "Oi", next: "b" }, { id: "b", text: "Tchau" }]) });
    expect(res.status).toBe(200);
    expect(res.body.tree.edges).toEqual([{ from: "a", to: "b" }]);
  });

  it("link exige url http(s)", async () => {
    const dev = await createUser("dev");
    const item = await createKnowledgeItem();
    const bad = await request(app)
      .post(`/api/knowledge/${item.id}/attachments`)
      .set(authHeader(dev))
      .send({ kind: "link", title: "Figma", url: "javascript:alert(1)" });
    expect(bad.status).toBe(400);
    const ok = await request(app)
      .post(`/api/knowledge/${item.id}/attachments`)
      .set(authHeader(dev))
      .send({ kind: "link", title: "Figma", url: "https://figma.com/file/abc" });
    expect(ok.status).toBe(201);
  });

  it("upload de PDF: guarda, extrai o texto, baixa com cabeçalhos seguros e apaga do disco", async () => {
    const dev = await createUser("dev");
    const item = await createKnowledgeItem();

    const up = await request(app)
      .post(`/api/knowledge/${item.id}/attachments/file`)
      .set(authHeader(dev))
      .set("Content-Type", "application/octet-stream")
      .set("X-File-Name", encodeURIComponent("../../Arquitetura do bot.pdf"))
      .send(SAMPLE_PDF);
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ kind: "arquivo", file_name: "Arquitetura do bot.pdf", mime_type: "application/pdf", has_text: true });

    const stored = await pool.query(`SELECT extracted_text, storage_key FROM knowledge_attachments WHERE id = $1`, [up.body.id]);
    expect(stored.rows[0].extracted_text).toContain("Fluxo de recarga Libercard");
    expect(stored.rows[0].storage_key).not.toContain("..");

    const file = await request(app)
      .get(`/api/knowledge/${item.id}/attachments/${up.body.id}/file`)
      .set(authHeader(dev))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(file.headers["content-disposition"]).toMatch(/^inline; filename\*=UTF-8''Arquitetura%20do%20bot\.pdf/);
    expect(file.headers["content-security-policy"]).toContain("sandbox");
    expect(Buffer.compare(file.body, SAMPLE_PDF)).toBe(0);

    const del = await request(app).delete(`/api/knowledge/${item.id}/attachments/${up.body.id}`).set(authHeader(dev));
    expect(del.status).toBe(204);
    const gone = await request(app).get(`/api/knowledge/${item.id}/attachments/${up.body.id}/file`).set(authHeader(dev));
    expect(gone.status).toBe(404);
  });

  it("recusa tipo de arquivo não aceito e arquivo sem nome", async () => {
    const dev = await createUser("dev");
    const item = await createKnowledgeItem();
    const exe = await request(app)
      .post(`/api/knowledge/${item.id}/attachments/file`)
      .set(authHeader(dev))
      .set("Content-Type", "application/octet-stream")
      .set("X-File-Name", "instalador.exe")
      .send(Buffer.from("MZ"));
    expect(exe.status).toBe(400);
    expect(exe.body.error).toMatch(/não aceito/);

    const noName = await request(app)
      .post(`/api/knowledge/${item.id}/attachments/file`)
      .set(authHeader(dev))
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("oi"));
    expect(noName.status).toBe(400);
  });

  it("edita, reordena e não deixa mexer em anexo de outro item", async () => {
    const dev = await createUser("dev");
    const item = await createKnowledgeItem({ name: "A" });
    const other = await createKnowledgeItem({ name: "B" });
    const post = (title: string) =>
      request(app)
        .post(`/api/knowledge/${item.id}/attachments`)
        .set(authHeader(dev))
        .send({ kind: "diagrama", title, content: "flowchart LR\n  A --> B" });
    const first = (await post("Arquitetura")).body;
    const second = (await post("Sequência")).body;

    const patched = await request(app)
      .patch(`/api/knowledge/${item.id}/attachments/${first.id}`)
      .set(authHeader(dev))
      .send({ title: "Arquitetura geral", content: "flowchart LR\n  A --> C" });
    expect(patched.status).toBe(200);
    expect(patched.body.title).toBe("Arquitetura geral");

    await request(app).put(`/api/knowledge/${item.id}/attachments/order`).set(authHeader(dev)).send({ ids: [second.id, first.id] }).expect(204);
    const list = await request(app).get(`/api/knowledge/${item.id}/attachments`).set(authHeader(dev));
    expect(list.body.map((a: { id: string }) => a.id)).toEqual([second.id, first.id]);

    const cross = await request(app).delete(`/api/knowledge/${other.id}/attachments/${first.id}`).set(authHeader(dev));
    expect(cross.status).toBe(404);
  });

  it("documentação grande (acima do limite padrão de 200 KB de JSON) é aceita", async () => {
    const dev = await createUser("dev");
    const item = await createKnowledgeItem();
    const big = "linha de documentação\n".repeat(15_000);
    const res = await request(app)
      .post(`/api/knowledge/${item.id}/attachments`)
      .set(authHeader(dev))
      .send({ kind: "documento", title: "Runbook", content: big.slice(0, 299_000) });
    expect(res.status).toBe(201);
  });
});
