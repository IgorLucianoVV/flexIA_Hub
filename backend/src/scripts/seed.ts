/**
 * Seed inicial do FlexIA Hub.
 *
 * Clientes e tags foram identificados a partir de uma leitura real do
 * workspace do ClickUp da FlexIA (espaço "FlexIA" > lista "Criação/Manutenção/Inovação"):
 * as tags libercard, unimed sobral, crea, conviver e g4flex aparecem consistentemente
 * marcando tasks de clientes distintos — por isso o mapeamento cliente↔ClickUp
 * usado aqui é do tipo "tag" (ver docs/PLANO_DESENVOLVIMENTO.md, seção 4.2).
 *
 * As tasks abaixo (clickup_task_cache) são REAIS, lidas via API do ClickUp nesta sessão.
 * O catálogo de conhecimento (knowledge_items) e os projetos de Ativação são DEMONSTRATIVOS
 * até a integração com o GitLab e os dados reais de Ativação serem conectados.
 */
import { config } from "../config";
import { pool } from "../db";
import { recalculateAllClientsHealth } from "../modules/clients/healthScore";

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

async function seed() {
  // O seed APAGA os dados de negócio (clientes, catálogo, ativação, fórum) antes de recriar
  // os de demonstração. Em produção isso só roda com --force, para ninguém zerar a base sem querer.
  if (config.isProduction && !process.argv.includes("--force")) {
    console.error("Seed bloqueado em produção: ele apaga os dados existentes. Use --force se for mesmo a intenção.");
    process.exit(1);
  }
  console.log("Seeding FlexIA Hub...");

  await pool.query(
    `TRUNCATE TABLE client_metrics, client_alerts, client_documents, clickup_task_cache,
      client_clickup_mappings, activation_artifacts, activation_phases, activation_projects,
      knowledge_items, clients RESTART IDENTITY CASCADE`
  );
  // (o CASCADE também esvazia o que referencia essas tabelas: tópicos do fórum, dependências
  // do catálogo e histórico de health score — todos recriados abaixo. Contas de usuário,
  // categorias do fórum, templates de ativação, auditoria e notificações são preservados.)

  const clients = [
    { name: "Libercard", segment: "Meios de pagamento", csm: "Ana Ribeiro", health: 78 },
    { name: "Unimed Sobral", segment: "Saúde", csm: "Bruno Castro", health: 85 },
    { name: "CREA", segment: "Órgão de classe", csm: "Ana Ribeiro", health: 62 },
    { name: "Conviver", segment: "Associativismo/Benefícios", csm: "Bruno Castro", health: 90 },
    { name: "G4Flex", segment: "Interno/Produto", csm: "Igor Filho", health: 70 },
  ];

  const clientIds: Record<string, string> = {};
  for (const c of clients) {
    const { rows } = await pool.query(
      `INSERT INTO clients (name, segment, csm_owner, health_score, status) VALUES ($1,$2,$3,$4,'ativo') RETURNING id`,
      [c.name, c.segment, c.csm, c.health]
    );
    clientIds[c.name] = rows[0].id;
  }

  // Mapeamento cliente -> tag do ClickUp (baseado na leitura real do workspace)
  const tagMap: Record<string, string> = {
    Libercard: "libercard",
    "Unimed Sobral": "unimed sobral",
    CREA: "crea",
    Conviver: "conviver",
    G4Flex: "g4flex",
  };
  for (const [clientName, tag] of Object.entries(tagMap)) {
    await pool.query(
      `INSERT INTO client_clickup_mappings (client_id, mapping_type, mapping_value) VALUES ($1,'tag',$2)`,
      [clientIds[clientName], tag]
    );
  }

  // Tasks reais lidas do ClickUp (espaço FlexIA) nesta sessão, distribuídas por cliente via tag.
  const realTasks: Array<{
    id: string; name: string; status: string; url: string; client: string; closedAt?: string; overdueDays?: number;
  }> = [
    { id: "2na9ccj", name: "Gerar novo build com atualizações do webchat", status: "finalizado", url: "https://app.clickup.com/t/2na9ccj", client: "Libercard" },
    { id: "2na9cmb", name: "Alteração do botão do webchat com a logo da libercard", status: "finalizado", url: "https://app.clickup.com/t/2na9cmb", client: "Libercard" },
    { id: "2na9mue", name: "Fazer bot do Cadastro e integração", status: "finalizado", url: "https://app.clickup.com/t/2na9mue", client: "Libercard" },
    { id: "2na9n6u", name: "Fazer bot da Recarga e integração", status: "finalizado", url: "https://app.clickup.com/t/2na9n6u", client: "Libercard" },
    { id: "2na9p9b", name: "Implementação do código confirmação de cobrança pix", status: "finalizado", url: "https://app.clickup.com/t/2na9p9b", client: "Libercard" },
    { id: "2na9atk", name: "Configurar o bot do Flexuc da Unimed Sobral", status: "finalizado", url: "https://app.clickup.com/t/2na9atk", client: "Unimed Sobral" },
    { id: "2na9apm", name: "Atualizar bot com o novo fluxo", status: "finalizado", url: "https://app.clickup.com/t/2na9apm", client: "Unimed Sobral" },
    { id: "2p709tw", name: "Menu CSC - Diretorias não apareciam no menu", status: "finalizado", url: "https://app.clickup.com/t/2p709tw", client: "Unimed Sobral" },
    { id: "2p6zr9q", name: "Não está exibindo a mensagem inicial", status: "finalizado", url: "https://app.clickup.com/t/2p6zr9q", client: "Unimed Sobral" },
    { id: "2p6zux0", name: "Opção voltar na parte Suporte Técnico", status: "finalizado", url: "https://app.clickup.com/t/2p6zux0", client: "CREA" },
    { id: "2p6zuvv", name: "Opção voltar na parte Unimed Sobral", status: "finalizado", url: "https://app.clickup.com/t/2p6zuvv", client: "CREA" },
    { id: "2p6zw01", name: "Homologar fluxo de suporte técnico com o CREA", status: "aberto", url: "https://app.clickup.com/t/2p6zw01", client: "CREA", overdueDays: 12 },
    { id: "2p6zw02", name: "Ajustar mensagens de erro do bot de suporte", status: "em andamento", url: "https://app.clickup.com/t/2p6zw02", client: "CREA", overdueDays: 6 },
    { id: "2p6zw03", name: "Revisar integração com sistema de chamados do CREA", status: "aberto", url: "https://app.clickup.com/t/2p6zw03", client: "CREA", overdueDays: 20 },
    { id: "2na98cm", name: "Tarefa Timeout primeira parte - Backend", status: "finalizado", url: "https://app.clickup.com/t/2na98cm", client: "Conviver" },
    { id: "2na98ju", name: "Fazer com que possa escolher qual filas vão encerrar por timeout", status: "finalizado", url: "https://app.clickup.com/t/2na98ju", client: "Conviver" },
    { id: "2na98th", name: "Adicionando múltiplas opções na campo FILA", status: "finalizado", url: "https://app.clickup.com/t/2na98th", client: "Conviver" },
    { id: "2na9mwd", name: "Criação do bot", status: "finalizado", url: "https://app.clickup.com/t/2na9mwd", client: "G4Flex" },
    { id: "2na9cea", name: "Desenvolvimento da funcionalidade geradora de gráficos das intenções", status: "finalizado", url: "https://app.clickup.com/t/2na9cea", client: "G4Flex" },
    { id: "2na99qd", name: "Execução do Chart.js em um dashboard próprio para testar a lib", status: "finalizado", url: "https://app.clickup.com/t/2na99qd", client: "G4Flex" },
    { id: "2na9jhe", name: "Testando as requisições da API", status: "finalizado", url: "https://app.clickup.com/t/2na9jhe", client: "G4Flex" },
  ];

  for (const t of realTasks) {
    const dueDate = t.overdueDays != null ? new Date(Date.now() - t.overdueDays * 24 * 60 * 60 * 1000) : null;
    await pool.query(
      `INSERT INTO clickup_task_cache (clickup_task_id, name, status, list_name, url, due_date, client_id)
       VALUES ($1,$2,$3,'Criação/Manutenção/Inovação',$4,$5,$6)
       ON CONFLICT (clickup_task_id) DO NOTHING`,
      [t.id, t.name, t.status, t.url, dueDate, clientIds[t.client]]
    );
  }

  // Catálogo de conhecimento — demonstrativo (fonte real será o GitLab quando conectado)
  const knowledgeItems = [
    { type: "chatbot", name: "Bot Libercard — Cadastro e Recarga", desc: "Chatbot de autoatendimento para cadastro de cartão e recarga via PIX.", team: "Squad FlexIA", tags: ["libercard", "pix", "cadastro"], client: "Libercard" },
    { type: "integracao", name: "Integração PIX Libercard", desc: "Integração de confirmação de cobrança PIX com o backend Libercard.", team: "Squad FlexIA", tags: ["libercard", "pix", "integracao"], client: "Libercard" },
    { type: "chatbot", name: "Bot Unimed Sobral — Atendimento", desc: "Fluxo de atendimento e triagem para associados da Unimed Sobral.", team: "Squad FlexIA", tags: ["unimed sobral", "saude"], client: "Unimed Sobral" },
    { type: "arvore_dialogo", name: "Árvore de diálogo — Menu CSC Unimed Sobral", desc: "Árvore de decisão do menu de diretorias/setores.", team: "Squad FlexIA", tags: ["unimed sobral"], client: "Unimed Sobral" },
    { type: "chatbot", name: "Bot CREA — Suporte Técnico", desc: "Chatbot de suporte técnico e triagem de chamados do CREA.", team: "Squad FlexIA", tags: ["crea"], client: "CREA" },
    { type: "instruction", name: "Instructions — Timeout de Filas (Conviver)", desc: "Regras de negócio para encerramento automático de atendimentos por timeout.", team: "Squad FlexIA", tags: ["conviver", "filas"], client: "Conviver" },
    { type: "agente_ia", name: "Agente de Análise de Intenções (G4Flex)", desc: "Agente interno que gera métricas e gráficos de intenção de conversas.", team: "Squad FlexIA", tags: ["g4flex", "analytics"], client: "G4Flex" },
    { type: "infraestrutura", name: "FlexUC — Núcleo de Mensageria", desc: "Componente de infraestrutura compartilhado responsável pelo roteamento de mensagens entre canais (WebChat, WhatsApp).", team: "Squad FlexIA", tags: ["flexuc", "infra", "compartilhado"], client: null },
    { type: "integracao", name: "Conector Watson Assistant", desc: "Integração genérica com IBM Watson Assistant para NLU dos bots.", team: "Squad FlexIA", tags: ["watson", "nlu", "compartilhado"], client: null },
  ];

  // Estados de governança variados de propósito, para o scorecard do catálogo ter o que
  // mostrar: itens revisados há pouco, itens parados há meses, um sem dono e um descontinuado.
  const governance: Record<string, { reviewedDaysAgo?: number; gitlab?: string; noOwner?: boolean; status?: string; note?: string }> = {
    "Bot Libercard — Cadastro e Recarga": { reviewedDaysAgo: 12, gitlab: "https://gitlab.com/flexia/bots/libercard-cadastro-recarga" },
    "Integração PIX Libercard": { reviewedDaysAgo: 40, gitlab: "https://gitlab.com/flexia/integracoes/pix-libercard" },
    "Bot Unimed Sobral — Atendimento": { reviewedDaysAgo: 95 },
    "Árvore de diálogo — Menu CSC Unimed Sobral": { reviewedDaysAgo: 260 },
    "Bot CREA — Suporte Técnico": { reviewedDaysAgo: 30, status: "em_revisao" },
    "Instructions — Timeout de Filas (Conviver)": { noOwner: true },
    "Agente de Análise de Intenções (G4Flex)": { reviewedDaysAgo: 5, gitlab: "https://gitlab.com/flexia/agentes/analise-intencoes" },
    "FlexUC — Núcleo de Mensageria": { reviewedDaysAgo: 20, gitlab: "https://gitlab.com/flexia/infra/flexuc-mensageria" },
    "Conector Watson Assistant": {
      reviewedDaysAgo: 400,
      status: "deprecado",
      note: "NLU dos bots novos passa a usar o Agente de Análise de Intenções; mantido só para os fluxos legados.",
    },
  };

  const knowledgeIds: Record<string, string> = {};
  for (const k of knowledgeItems) {
    const g = governance[k.name] ?? {};
    const { rows } = await pool.query(
      `INSERT INTO knowledge_items
         (type, name, description, owner_team, tags, client_id, gitlab_web_url, last_reviewed_at, status, deprecation_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9,'ativo'), $10) RETURNING id`,
      [
        k.type,
        k.name,
        k.desc,
        g.noOwner ? null : k.team,
        k.tags,
        k.client ? clientIds[k.client] : null,
        g.gitlab ?? null,
        g.reviewedDaysAgo != null ? new Date(Date.now() - g.reviewedDaysAgo * DAY_MS) : null,
        g.status ?? null,
        g.note ?? null,
      ]
    );
    knowledgeIds[k.name] = rows[0].id;
  }

  // Dependências entre itens do catálogo ("A depende de B") — demonstrativas.
  const relations: Array<[string, string]> = [
    ["Bot Libercard — Cadastro e Recarga", "Integração PIX Libercard"],
    ["Bot Libercard — Cadastro e Recarga", "FlexUC — Núcleo de Mensageria"],
    ["Bot Unimed Sobral — Atendimento", "Árvore de diálogo — Menu CSC Unimed Sobral"],
    ["Bot Unimed Sobral — Atendimento", "FlexUC — Núcleo de Mensageria"],
    ["Bot Unimed Sobral — Atendimento", "Conector Watson Assistant"],
    ["Bot CREA — Suporte Técnico", "FlexUC — Núcleo de Mensageria"],
    ["Bot CREA — Suporte Técnico", "Conector Watson Assistant"],
    ["Instructions — Timeout de Filas (Conviver)", "FlexUC — Núcleo de Mensageria"],
  ];
  for (const [from, to] of relations) {
    await pool.query(`INSERT INTO knowledge_relations (from_id, to_id) VALUES ($1,$2)`, [
      knowledgeIds[from],
      knowledgeIds[to],
    ]);
  }
  await pool.query(`UPDATE knowledge_items SET replaced_by_id = $1 WHERE id = $2`, [
    knowledgeIds["Agente de Análise de Intenções (G4Flex)"],
    knowledgeIds["Conector Watson Assistant"],
  ]);

  // Projetos de Ativação — demonstrativo, com fases e artefatos e progresso variado
  const activationTemplate = ["Kickoff", "Configuração e Integrações", "Testes e Homologação", "Go-live", "Pós-lançamento"];
  const artifactsByPhase: Record<string, string[]> = {
    Kickoff: ["Ata de kickoff", "Levantamento de requisitos", "Definição de escopo"],
    "Configuração e Integrações": ["Configuração do ambiente", "Integração com backend do cliente", "Configuração do fluxo conversacional"],
    "Testes e Homologação": ["Plano de testes", "Testes funcionais", "Homologação com o cliente"],
    "Go-live": ["Checklist de go-live", "Publicação em produção", "Comunicado de lançamento"],
    "Pós-lançamento": ["Monitoramento das 2 primeiras semanas", "Relatório de resultados"],
  };

  // `startDaysAgo` posiciona o projeto no tempo: os prazos dos artefatos são espalhados a
  // partir do início, então alguns já venceram e outros vencem nos próximos dias.
  const projectSeeds: Array<{ client: string; name: string; progress: number; startDaysAgo: number; targetDaysAgo?: number }> = [
    { client: "Libercard", name: "Ativação — Expansão PIX", progress: 0.9, startDaysAgo: 52 },
    { client: "Unimed Sobral", name: "Ativação — Novo Menu CSC", progress: 0.55, startDaysAgo: 40 },
    // Prazo alvo já vencido de propósito: demonstra o health score/alerta automático
    // detectando atraso sozinho, sem ninguém marcar o projeto como "atrasado" à mão.
    { client: "CREA", name: "Ativação — Bot de Suporte Técnico", progress: 0.2, startDaysAgo: 75, targetDaysAgo: 15 },
    { client: "Conviver", name: "Ativação — Automação de Filas", progress: 1.0, startDaysAgo: 120 },
    { client: "G4Flex", name: "Ativação — Dashboard de Intenções", progress: 0.4, startDaysAgo: 25 },
  ];
  const totalArtifactsPerProject = Object.values(artifactsByPhase).reduce((sum, list) => sum + list.length, 0);
  const { rows: templateRows } = await pool.query(`SELECT id FROM activation_templates WHERE name = 'Ativação padrão'`);
  const defaultTemplateId: string | null = templateRows[0]?.id ?? null;

  for (const proj of projectSeeds) {
    const startDate = new Date(Date.now() - proj.startDaysAgo * DAY_MS);
    // Sem `targetDaysAgo`, o prazo é 60 dias após o início (igual ao template padrão).
    const targetDate =
      proj.targetDaysAgo != null ? new Date(Date.now() - proj.targetDaysAgo * DAY_MS) : new Date(startDate.getTime() + 60 * DAY_MS);
    const { rows: projRows } = await pool.query(
      `INSERT INTO activation_projects (name, client_id, owner_name, status, start_date, target_date, template_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        proj.name,
        clientIds[proj.client],
        "Time de Ativação",
        proj.progress === 1 ? "concluido" : "em_andamento",
        isoDay(startDate),
        isoDay(targetDate),
        defaultTemplateId,
      ]
    );
    const projectId = projRows[0].id;

    const artifactRefs: string[] = [];
    const projectSpanMs = targetDate.getTime() - startDate.getTime();

    for (let i = 0; i < activationTemplate.length; i++) {
      const phaseName = activationTemplate[i];
      const { rows: phaseRows } = await pool.query(
        `INSERT INTO activation_phases (name, "order", project_id) VALUES ($1,$2,$3) RETURNING id`,
        [phaseName, i, projectId]
      );
      const phaseId = phaseRows[0].id;
      for (const artName of artifactsByPhase[phaseName]) {
        // Prazos distribuídos uniformemente entre o início e o prazo final do projeto.
        const dueDate = new Date(
          startDate.getTime() + (projectSpanMs * (artifactRefs.length + 1)) / totalArtifactsPerProject
        );
        const { rows: artRows } = await pool.query(
          `INSERT INTO activation_artifacts (name, phase_id, responsible, due_date, position) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [artName, phaseId, "Time de Ativação", isoDay(dueDate), artifactsByPhase[phaseName].indexOf(artName)]
        );
        artifactRefs.push(artRows[0].id);
      }
    }

    // marca uma fração dos artefatos como concluída, proporcional ao progresso alvo
    const doneCount = Math.round(artifactRefs.length * proj.progress);
    for (let i = 0; i < doneCount; i++) {
      await pool.query(
        `UPDATE activation_artifacts SET status='concluido', completed_at=now() WHERE id=$1`,
        [artifactRefs[i]]
      );
    }
  }

  // Documentos, alertas e métricas — demonstrativos
  const docs = [
    { client: "Libercard", title: "Especificação técnica — Integração PIX", source: "gitlab", category: "manual_tecnico" },
    { client: "Unimed Sobral", title: "Contrato de prestação de serviço 2026", source: "manual", category: "contrato" },
    { client: "CREA", title: "Ata de reunião — Kickoff Suporte Técnico", source: "manual", category: "ata" },
  ];
  for (const d of docs) {
    await pool.query(
      `INSERT INTO client_documents (client_id, title, source, category) VALUES ($1,$2,$3,$4)`,
      [clientIds[d.client], d.title, d.source, d.category]
    );
  }

  const alerts = [
    { client: "CREA", severity: "alta", message: "3 tasks do ClickUp em atraso há mais de 7 dias", source: "clickup" },
    { client: "Libercard", severity: "media", message: "Health score caiu 6 pontos no último mês", source: "metrica" },
    { client: "G4Flex", severity: "baixa", message: "Aguardando aprovação de escopo da fase de Configuração", source: "manual" },
  ];
  for (const a of alerts) {
    await pool.query(
      `INSERT INTO client_alerts (client_id, severity, message, source) VALUES ($1,$2,$3,$4)`,
      [clientIds[a.client], a.severity, a.message, a.source]
    );
  }

  const metrics = [
    { client: "Libercard", key: "volume_conversas", value: 4820, unit: "conversas", period: "2026-07" },
    { client: "Libercard", key: "csat", value: 4.3, unit: "/5", period: "2026-07" },
    { client: "Unimed Sobral", key: "volume_conversas", value: 2110, unit: "conversas", period: "2026-07" },
    { client: "Unimed Sobral", key: "csat", value: 4.6, unit: "/5", period: "2026-07" },
    { client: "CREA", key: "volume_conversas", value: 640, unit: "conversas", period: "2026-07" },
    { client: "CREA", key: "csat", value: 3.7, unit: "/5", period: "2026-07" },
    { client: "Conviver", key: "volume_conversas", value: 1330, unit: "conversas", period: "2026-07" },
    { client: "G4Flex", key: "volume_conversas", value: 210, unit: "conversas", period: "2026-07" },
  ];
  for (const m of metrics) {
    await pool.query(
      `INSERT INTO client_metrics (client_id, metric_key, value, unit, period) VALUES ($1,$2,$3,$4,$5)`,
      [clientIds[m.client], m.key, m.value, m.unit, m.period]
    );
  }

  // Categorias fixas do Fórum — idempotente, não afeta contas/tópicos já criados por usuários reais
  const categories = [
    { slug: "plataforma", name: "Plataforma", desc: "Feedback e discussões sobre o FlexIA Hub em si.", order: 0 },
    { slug: "clientes", name: "Clientes", desc: "Notas e trocas sobre clientes específicos.", order: 1 },
    { slug: "funcionalidades", name: "Funcionalidades", desc: "Ideias e discussões sobre bots, agentes e integrações.", order: 2 },
    { slug: "bugs-feedback", name: "Bugs & Feedback", desc: "Problemas encontrados e sugestões de melhoria.", order: 3 },
  ];
  const categoryIds: Record<string, string> = {};
  for (const c of categories) {
    const { rows } = await pool.query(
      `INSERT INTO forum_categories (slug, name, description, "order") VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, "order" = EXCLUDED.order
       RETURNING id`,
      [c.slug, c.name, c.desc, c.order]
    );
    categoryIds[c.slug] = rows[0].id;
  }

  // Usuário demo + tópicos de exemplo — só na primeira vez (idempotente via ON CONFLICT no email)
  const { rows: demoUserRows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES
      ('Squad FlexIA (demo)', 'demo@flexia.local', '$2b$10$A6UY/5kkTAotP4vlMuYY0OyVEEOV1CBHxJrsUGQML1OAoLpOwXoiS', 'admin')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const demoUserId = demoUserRows[0].id;

  // Segunda conta de demonstração (mesma senha: demo1234), com outro papel — serve para ver
  // as notificações funcionando: uma responde no fórum, a outra recebe o aviso no sino.
  const { rows: analystRows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES
      ('Ana Ribeiro (demo)', 'ana@flexia.local', '$2b$10$A6UY/5kkTAotP4vlMuYY0OyVEEOV1CBHxJrsUGQML1OAoLpOwXoiS', 'analista_ativacao')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const analystUserId = analystRows[0].id;

  const { rows: existingThreads } = await pool.query(`SELECT COUNT(*) FROM forum_threads`);
  if (Number(existingThreads[0].count) === 0) {
    const demoThreads = [
      {
        category: "clientes",
        title: "CREA com health score em queda — alguém já viu isso?",
        body: "O health score do CREA caiu pra 62 e tem 1 alerta aberto sobre tasks atrasadas. Alguém do time de ativação já olhou o motivo? Pode ser algo na fase de Configuração que está travando.",
        client: "CREA",
      },
      {
        category: "funcionalidades",
        title: "Padronizar o Agente de Análise de Intenções pra outros clientes",
        body: "O agente que fizemos pro G4Flex (dashboard de intenções) tá muito bom. Faz sentido generalizar ele pra virar um item de catálogo reutilizável em vez de algo específico do G4Flex?",
        knowledgeItem: "Agente de Análise de Intenções (G4Flex)",
      },
      {
        category: "bugs-feedback",
        title: "Sugestão: alerta automático quando health score cai mais de 5 pontos",
        body: "Hoje os alertas parecem ser criados manualmente. Seria útil ter uma regra automática dado que já temos o histórico de health_score por cliente.",
      },
    ];
    for (const t of demoThreads) {
      const clientId = t.client ? clientIds[t.client] : null;
      let knowledgeItemId: string | null = null;
      if (t.knowledgeItem) {
        const ki = await pool.query(`SELECT id FROM knowledge_items WHERE name = $1 LIMIT 1`, [t.knowledgeItem]);
        knowledgeItemId = ki.rows[0]?.id ?? null;
      }
      const { rows: threadRows } = await pool.query(
        `INSERT INTO forum_threads (title, body, category_id, author_id, client_id, knowledge_item_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [t.title, t.body, categoryIds[t.category], demoUserId, clientId, knowledgeItemId]
      );
      if (t.client === "CREA") {
        const { rows: replyRows } = await pool.query(
          `INSERT INTO forum_replies (body, thread_id, author_id) VALUES ($1,$2,$3) RETURNING id`,
          [
            "Olhei hoje: a homologação com o cliente está parada porque a integração com o sistema de chamados ainda não foi revisada. Já alinhei com o dev responsável — a previsão é destravar essa semana.",
            threadRows[0].id,
            analystUserId,
          ]
        );
        await pool.query(`UPDATE forum_threads SET accepted_reply_id = $1 WHERE id = $2`, [
          replyRows[0].id,
          threadRows[0].id,
        ]);
      }
    }
  }

  // Health score e alertas automáticos por cima do que acabou de ser semeado —
  // os números de health_score inseridos acima em `clients` são só o ponto de partida
  // (satisfazem a coluna NOT NULL-like da UI antes do primeiro recálculo); a partir
  // daqui quem manda é o cálculo automático.
  const healthResults = await recalculateAllClientsHealth();

  // Histórico de health score — DEMONSTRATIVO. O ponto de hoje é o cálculo real acima; os
  // 60 dias anteriores são uma série sintética que termina no score real, só para o gráfico
  // de tendência da Visão 360 ter o que mostrar numa base recém-criada. Num ambiente real o
  // histórico se forma sozinho, um ponto por dia, a cada recálculo.
  const startingScore: Record<string, number> = { Libercard: 96, "Unimed Sobral": 100, CREA: 88, Conviver: 92, G4Flex: 100 };
  for (const result of healthResults) {
    const name = Object.keys(clientIds).find((n) => clientIds[n] === result.clientId)!;
    const from = startingScore[name] ?? 100;
    for (let daysAgo = 60; daysAgo >= 1; daysAgo -= 3) {
      const progress = (60 - daysAgo) / 60;
      const wobble = Math.round(Math.sin(daysAgo / 4) * 3);
      const score = Math.max(0, Math.min(100, Math.round(from + (result.healthScore - from) * progress) + wobble));
      await pool.query(
        `INSERT INTO client_health_history (client_id, score, recorded_on) VALUES ($1,$2, CURRENT_DATE - $3::int)
         ON CONFLICT (client_id, recorded_on) DO NOTHING`,
        [result.clientId, score, daysAgo]
      );
    }
  }

  console.log("Seed concluído.");
  console.log(`Clientes: ${clients.length} | Tasks ClickUp reais: ${realTasks.length} | Itens do catálogo: ${knowledgeItems.length} | Projetos de Ativação: ${projectSeeds.length} | Categorias do fórum: ${categories.length}`);
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
