# FlexIA Hub — Plano de Desenvolvimento

**Plataforma interna de governança e descoberta de conhecimento técnico do squad FlexIA**

Autor: Claude (Cowork) · Data: 10/08/2026 · Última atualização: 15/11/2026 · Status: v1.0 (MVP em produção local, backlog pós-MVP em andamento)

---

## 1. Objetivo

Criar uma plataforma web interna para o squad FlexIA que resolva três problemas hoje dispersos em ferramentas separadas (GitLab, ClickUp, planilhas, Drive):

1. **Governança e descoberta de conhecimento técnico** — ter um catálogo único de agentes de IA, chatbots, instructions, árvores de diálogo, integrações e infraestrutura, com o GitLab como fonte primária (onde o conteúdo de fato vive e é versionado) e o Hub como camada de catálogo, busca e organização por cima dele.
2. **Gestão de projetos de Ativação** — permitir que os responsáveis pela Ativação de clientes estruturem fases e artefatos por fase, com todos os projetos listados verticalmente e uma barra de progresso mostrando % entregue vs. % restante.
3. **Visão 360 do cliente** — uma página por cliente reunindo tudo que ele usa: tasks do ClickUp associadas, documentação do projeto, alertas e métricas.

---

## 2. Benchmark de mercado — o que foi pesquisado e o que aproveitamos

### 2.1 Catálogo de conhecimento técnico → referência: **Backstage (Spotify)**
Fonte: [backstage.io/docs/features/software-catalog](https://backstage.io/docs/features/software-catalog/)

O Backstage é hoje o padrão de facto para portais internos de desenvolvedor (Internal Developer Portal). Requisitos que extraímos e aplicamos ao Hub:

- **Modelo de entidades com metadados estruturados** — cada item do catálogo (agente, chatbot, instruction, árvore de diálogo, integração, componente de infra) é uma entidade tipada com metadados (owner, descrição, tags, status, links).
- **Ownership explícito** — todo item tem um time/pessoa responsável, eliminando "conhecimento órfão".
- **Relacionamentos entre componentes** — um agente pode depender de uma integração, que depende de uma infraestrutura; o catálogo modela isso.
- **Sincronização automática com o repositório Git** — a fonte da verdade é o GitLab; o Hub lê e indexa, não duplica manualmente.
- **Busca e descoberta centralizadas**, com filtros por tipo, time, tags e status.
- **Auditoria de mudanças** — histórico de quando cada item foi atualizado (herdado do próprio Git).

Aplicado ao FlexIA Hub: o **GitLab é a fonte primária** (cada agente/chatbot/instruction vive em um repositório ou caminho versionado); o **Hub é a camada de catálogo** que indexa metadados via API do GitLab (arquivos `.yaml`/`.md` de descrição no repo, estrutura de pastas, tópicos/tags do projeto) e apresenta tudo de forma pesquisável, sem ser a fonte de verdade do conteúdo em si.

### 2.2 Gestão de projetos com fases e progresso → referências: **Asana (Client Onboarding), Rocketlane, ProjectManager.com**
Fontes: [Rocketlane — Client Onboarding](https://www.rocketlane.com/blogs/client-onboarding) · [Asana — Client Onboarding Template](https://asana.com/templates/client-onboarding-process) · [ProjectManager — Progress Tracker Templates](https://www.projectmanager.com/blog/project-progress-tracker-templates)

Requisitos aproveitados:

- **Fases como estrutura fixa e reutilizável** (ex.: Kickoff → Configuração → Testes → Go-live → Pós-lançamento), mas customizável por projeto.
- **Artefatos/entregáveis dentro de cada fase**, cada um com status (pendente / em andamento / concluído) e responsável.
- **Barra de progresso por projeto**, calculada a partir do % de artefatos concluídos — exatamente o padrão pedido: projetos empilhados verticalmente, cada um com sua barra de "% entregue vs. % restante".
- **Client-facing tracking** — o dono do projeto de Ativação consegue ver de forma rápida quais clientes estão atrasados sem abrir cada projeto individualmente.

### 2.3 Visão 360 do cliente → referências: **Velaris, Custify (Customer Success platforms)**
Fonte: [Velaris — Customer 360 Dashboard](https://www.velaris.io/articles/how-to-build-customer-360-view-dashboard)

Requisitos aproveitados:

- **Página única por cliente** agregando: perfil, tarefas operacionais (ClickUp), documentação, alertas e métricas de uso/saúde.
- **Health score simplificado** combinando sinais de risco (tasks atrasadas, alertas abertos, métricas fora do esperado).
- **Atualização contínua** — dados sincronizados das fontes (ClickUp, GitLab, métricas internas), não digitados manualmente.
- **Simplicidade acima de volume de métricas** — evitar sobrecarga, mostrar o que importa para decisão.

### 2.4 Catálogo/governança de agentes de IA → referência: mercado de "AI agent discovery & governance"
A pesquisa mostrou que esse é um espaço emergente (plataformas como Arthur AI cobrem descoberta/governança de agentes de IA corporativos). Ainda não há um padrão consolidado como o Backstage é para software — por isso o FlexIA Hub aplica o **modelo de entidades do Backstage genericamente aos ativos de IA** (agente, chatbot, instruction, árvore de diálogo tratados como "componentes" com metadados, ownership e relacionamentos), que é a abordagem mais madura disponível hoje.

---

## 3. Escopo do MVP (3 módulos, versão simplificada, em paralelo)

| Módulo | Must-have no MVP | Fora do MVP (v2) |
|---|---|---|
| Catálogo de Conhecimento | Listagem/busca de itens indexados do GitLab (projetos, tópicos, README/metadados), filtro por tipo/time/tags, página de detalhe com link pro GitLab | Grafo de relacionamentos entre componentes, plugins customizados, versionamento visual |
| Gestão de Projetos de Ativação | CRUD de projetos → fases → artefatos, lista vertical de projetos com barra de progresso, filtro por cliente/status | Gantt chart, dependências entre artefatos, automações de notificação |
| Visão 360 do Cliente | Página por cliente com tasks do ClickUp (via API), documentos, alertas e métricas básicas | Health score preditivo, integração com CRM/financeiro |

---

## 4. Arquitetura técnica

```
flexia-hub/
├── backend/     Node.js + Express + PostgreSQL (SQL puro via `pg` — ver nota abaixo)
│   ├── src/
│   │   ├── modules/
│   │   │   ├── knowledge/      → indexação e API do Catálogo
│   │   │   ├── activation/     → projetos, fases, artefatos
│   │   │   ├── clients/        → clientes, visão 360 e health score automático
│   │   │   ├── auth/           → login/cadastro, JWT, permissões por papel
│   │   │   ├── forum/          → categorias, tópicos, respostas
│   │   │   └── integrations/
│   │   │       ├── gitlab/     → cliente da API do GitLab, sync job
│   │   │       └── clickup/    → cliente da API do ClickUp, sync job
│   │   ├── app.ts              → app do Express (importado pelos testes)
│   │   └── server.ts           → só chama app.listen()
│   ├── tests/                  → suíte automatizada (vitest + supertest)
│   └── prisma/schema.sql       → schema do banco (SQL puro, ver nota abaixo)
├── ai-service/  Python + FastAPI + LangGraph + RAG (assistente de busca estratégica sobre toda a base)
├── frontend/    React + Vite + TypeScript + Tailwind CSS
│   └── src/pages/{Dashboard, Catalogo, Ativacao, Cliente360, Forum, ...}
└── docs/
```

**Por que essa stack:** é a combinação recomendada para portais internos (o próprio Backstage é Node/React), tem curva de aprendizado baixa para qualquer dev que entre no time depois, roda em qualquer VM/container simples, e o PostgreSQL lida bem com dados relacionais (projetos → fases → artefatos, clientes → tasks), com JSON semi-estruturado (metadados do catálogo) e, desde a seção 9, com vetores de embeddings (extensão `pgvector`) para o RAG do Assistente de IA.

> **Nota sobre Prisma:** o plano original previa Prisma ORM (como no diagrama acima da primeira versão deste documento). Na prática, o download dos binários nativos do Prisma foi bloqueado pela rede do ambiente de desenvolvimento usado nesta sessão, então o backend usa `pg` com SQL parametrizado direto (`backend/prisma/schema.sql` tem o schema completo, sem depender do Prisma). Se o ambiente de produção da FlexIA conseguir baixar os binários do Prisma, é uma migração direta — o modelo de dados não muda, só a camada de acesso.

### 4.1 Integrações externas

- **GitLab**: API REST/GraphQL do GitLab, autenticada via Personal/Project Access Token (`read_api`, `read_repository`). Um job de sincronização percorre grupos/projetos configurados, lê metadados (tópicos, descrição, estrutura de pastas, arquivos de manifesto) e grava/atualiza entidades no catálogo.
- **ClickUp**: API REST do ClickUp, autenticada via API Token pessoal ou de app. Sincroniza tasks filtradas por cliente (via campo customizado "Cliente" ou lista/tag dedicada) para a Visão 360.

> **Status atual:** a integração com ClickUp foi validada nesta sessão (li a hierarquia real do workspace da FlexIA) e está em uso — o mapeamento por tag para os 5 clientes reais identificados (Libercard, Unimed Sobral, CREA, Conviver, G4Flex) está ativo. A integração com GitLab está com o código pronto no backend, aguardando as credenciais (URL da instância + token) para ativar a sincronização real.

### 4.2 Observação importante sobre o ClickUp

O workspace atual do ClickUp está organizado por **área de produto** (FlexIA, FlexUc App, Flexuc, Salesforce, QA), não por cliente. Isso significa que, para a Visão 360 funcionar puxando tasks *por cliente*, é necessário um destes ajustes operacionais:

1. Criar um **campo customizado "Cliente"** nas tasks relevantes (recomendado — menos disruptivo); ou
2. Usar **tags por cliente**; ou
3. Mapear manualmente listas/pastas específicas a clientes quando fizer sentido.

O Hub já está preparado para os três modelos (tabela de mapeamento `client_clickup_mapping`), mas alguém do squad precisa decidir/aplicar o padrão dentro do ClickUp.

---

## 5. Modelo de dados (resumo)

- `clients` — clientes atendidos pela Ativação/CS, com `health_score` recalculado automaticamente (ver seção 8)
- `knowledge_items` — itens do catálogo (agente, chatbot, instruction, árvore de diálogo, integração, infra), com `source_type=gitlab`, `gitlab_project_id`, `path`, `owner_team`, `tags[]`
- `activation_projects` — projeto de ativação vinculado a um cliente
- `activation_phases` — fases dentro de um projeto, ordenadas
- `activation_artifacts` — artefatos dentro de uma fase, com status e responsável
- `client_clickup_mapping` — como cada cliente se relaciona a tasks do ClickUp (campo customizado, tag ou lista)
- `client_documents` — documentos associados a um cliente (GitLab, Drive, links)
- `client_alerts` — alertas ativos por cliente (severidade, origem, mensagem); alertas com `source` iniciado em "Cálculo automático" são abertos/fechados sozinhos (ver seção 8)
- `client_metrics` — métricas por cliente/período
- `users` — contas do Hub (nome, email, senha com hash, papel)
- `forum_categories` / `forum_threads` / `forum_replies` — o fórum interno (ver seção 6.1)
- `password_resets` — tokens de recuperação de senha (modo dev, ver seção 8)
- `rag_chunks` — índice de vetores do Assistente de IA (embedding `VECTOR(192)`, ver seção 9)

O cálculo da barra de progresso de cada projeto de Ativação é:
`% entregue = artefatos com status "concluído" / total de artefatos do projeto`, agregado também por fase.

---

## 6. Roadmap

**Fase 0 — Fundação (concluída)**
Pesquisa de mercado, definição de arquitetura, banco PostgreSQL provisionado, schema inicial.

**Fase 1 — Scaffold e API (concluída)**
Backend Express com os 3 módulos, seed com dados reais do ClickUp (workspace já lido) e dados de exemplo para o catálogo (até termos o token do GitLab).

**Fase 2 — Frontend funcional (concluída)**
React com as telas principais navegáveis: Catálogo, Ativação (lista vertical com barra de progresso), Cliente 360, Fórum e Assistente de IA.

**Fase 3 — Integração real GitLab (pendente de credenciais)**
Assim que URL + token do GitLab forem fornecidos: ativar o job de sincronização real do catálogo.

**Fase 4 — Refino operacional (em andamento)**
- ✅ Permissões por papel de verdade (`requireAuth`/`requireRole` em todas as rotas de escrita)
- ✅ Health score automático + alertas automáticos (calculados de tasks/projetos/alertas reais, sem número fixo)
- ✅ Testes automatizados básicos do backend (33 testes, vitest + supertest)
- ✅ Assistente de IA com RAG de verdade sobre toda a base + painel reposicionado no canto superior direito (ver seção 9)
- ⏳ Definir e aplicar o padrão de mapeamento cliente↔ClickUp no workspace real (depende de decisão do squad, item 2 da seção 7)
- ⏳ Deploy em produção (depende da decisão de hospedagem, item 4 da seção 7)

O backlog detalhado e priorizado (com o que é alta/média/baixa prioridade dentro de cada fase) vive num documento visual separado, entregue diretamente ao Igor (`flexia-hub-roadmap.html`) — este documento aqui é o plano/arquitetura de referência, aquele é o backlog do dia a dia.

---

## 6.1 Extensão pós-MVP: Fórum + Assistente de IA estratégico

Adicionado depois do MVP inicial, a pedido do squad: um espaço de troca de conhecimento entre
usuários/devs/analistas de suporte e ativação, e uma camada de IA capaz de buscar e sintetizar
informações estratégicas de toda a base do Hub.

### Autenticação

O Hub passou a exigir login (antes era um catálogo aberto, sem usuários). Implementado com
usuário/senha simples (`bcrypt` + JWT, sem OAuth/SSO por enquanto), papéis: `dev`,
`analista_suporte`, `analista_ativacao`, `admin`. Toda a aplicação (exceto `/login` e
`/cadastro`) exige sessão válida no frontend. Além da sessão, cada rota de escrita da API também
passou a exigir o papel correto no servidor (`requireAuth` + `requireRole`) — antes dessa
correção (ver seção 8), qualquer conta logada conseguia executar qualquer ação de escrita, mesmo
sem ter o papel esperado; a trava existia só visualmente no frontend.

### Fórum

Categorias fixas (Plataforma, Clientes, Funcionalidades, Bugs & Feedback), tópicos com vínculo
opcional a um cliente ou item do catálogo específico (aparecendo também na Visão 360 do cliente
correspondente), respostas em thread simples, com edição/exclusão pelo autor ou por um admin.
Tabelas: `users`, `forum_categories`, `forum_threads`, `forum_replies`.

### Assistente de IA estratégico — LangGraph

Serviço Python separado (`ai-service/`, FastAPI + LangGraph + `langchain-anthropic`), chamado
pelo backend Node via `POST /api/assistant/ask` (proxy) → `AI_SERVICE_URL`. Arquitetura em grafo
de 3 nós:

1. **route** — modelo rápido (`claude-3-5-haiku-latest`) decide quais categorias da base
   (clientes, catálogo, ativação, fórum) são relevantes pra pergunta.
2. **retrieve** — a partir da versão descrita na seção 9, busca por **similaridade vetorial
   (RAG)** sobre toda a base (não só as 4 categorias originais — também documentos, alertas e
   métricas), nas categorias escolhidas + sempre inclui sinais estratégicos independentes da
   pergunta (clientes com health score baixo, alertas abertos).
3. **synthesize** — modelo maior (`claude-3-5-sonnet-latest`) redige a resposta final citando as
   fontes, que viram links clicáveis no frontend (painel acessível de qualquer tela, flutuante no
   canto superior direito desde a seção 9).

Dois modelos diferentes por etapa é uma escolha deliberada do grafo (roteamento rápido/barato,
síntese com um modelo mais capaz). Sem `ANTHROPIC_API_KEY` configurada, o serviço continua no ar
e a busca funciona normalmente — a etapa de síntese vira uma listagem dos trechos mais relevantes
encontrados pelo RAG, com o score de similaridade de cada um, sem geração por IA, até a chave ser
configurada.

---

## 7. Decisões pendentes do lado do usuário

1. **Credenciais do GitLab** (URL da instância + Personal Access Token com `read_api`/`read_repository`) e nome do(s) grupo(s)/namespace(s) com os repositórios de agentes/chatbots/instructions.
2. **Padrão de associação cliente↔ClickUp** (campo customizado "Cliente" é a recomendação; hoje está por tag, funcionando, mas menos robusto a longo prazo).
3. **Lista real de clientes ativos** da Ativação (por ora o Hub usa os 5 clientes identificados via ClickUp como exemplo).
4. **Onde hospedar** a versão final (VM interna, cloud da empresa, etc.) — o Hub roda localmente nesta sessão para validação.
5. **`ANTHROPIC_API_KEY`** (console.anthropic.com → Settings → API Keys) para o Assistente de IA sintetizar respostas de verdade — sem ela, o assistente segue funcionando só em modo de busca (resultados do RAG, sem síntese).

Tudo que **não** depende de uma dessas 5 decisões já foi implementado — ver seções 8 e 9.

---

## 8. Atualização — o que foi implementado sem depender das credenciais pendentes (03/09/2026)

A pedido do Igor ("comece a implementar esse plano sem as credenciais por enquanto"), o backlog
da Fase 4 foi atacado pulando tudo que depende da seção 7. Itens concluídos nesta rodada:

- **Editar/apagar tópicos e respostas do fórum** — antes só existia criar; agora o autor (ou um
  admin) pode editar e apagar.
- **Paginação** — fórum, catálogo e tasks do ClickUp na Visão 360 carregavam tudo de uma vez;
  agora carregam em páginas ("Carregar mais"), com um envelope `{items, total, limit, offset}`
  padronizado em toda a API.
- **Recuperação de senha (modo dev)** — fluxo completo de "esqueci minha senha"; sem provedor de
  email configurado ainda, o token de reset é devolvido na própria resposta da API em vez de
  enviado por email — deliberadamente inseguro para produção, documentado como tal, e é o
  próximo passo óbvio quando um provedor de email for conectado.
- **Permissões por papel de verdade** — a API antes ficava totalmente aberta pra qualquer
  usuário logado (só o frontend barrava visualmente). Agora cada rota de escrita exige o papel
  certo: criar cliente (admin/analista_ativacao), planejar ativação — criar
  projeto/fase/artefato — (admin/analista_ativacao), atualizar status de artefato
  (+ dev, que é quem executa), cadastro manual no catálogo (admin/dev), gerenciar categoria do
  fórum (admin). Fórum e disparo de sync seguem abertos a qualquer usuário logado, por ser baixo
  risco.
- **Health score e alertas automáticos** — o `health_score` de cada cliente deixou de ser um
  número fixo/digitado e passou a ser calculado a partir de sinais reais já existentes no banco:
  tasks do ClickUp vencidas, projetos de Ativação atrasados (inclusive detectando atraso sozinho
  pelo `target_date`, sem alguém precisar marcar "atrasado" à mão) e alertas manuais abertos. O
  mesmo cálculo abre e fecha alertas automáticos (`client_alerts` com `source` "Cálculo
  automático (...)") conforme os sinais mudam, sem nunca tocar em alertas criados por pessoas. O
  recálculo roda sozinho ao abrir a Visão 360 de um cliente, depois de um sync do ClickUp, e
  depois de atualizar o status de um artefato de ativação.
- **Testes automatizados básicos do backend** — suíte com vitest + supertest (33 testes):
  paginação, autenticação/recuperação de senha, todas as regras de permissão por papel, e o
  cálculo de health score/alertas automáticos (incluindo o caso de alerta manual não ser tocado).
  Banco de testes separado (`flexia_hub_test`), criado e migrado sozinho no `npm test`, sem tocar
  no banco de desenvolvimento.

Tudo isso está documentado com mais detalhe técnico no `README.md` do repositório (seções
"Permissões", "Health score e alertas automáticos", "Recuperação de senha" e "Testes
automatizados"), e o backlog visual (`flexia-hub-roadmap.html`, entregue ao Igor) foi atualizado
marcando esses itens como concluídos.

---

## 9. Atualização — RAG de verdade sobre toda a base + painel no canto superior direito (13/11/2026)

A pedido do Igor ("Quero uma IA que consiga ler todos os dados da plataforma, que seja
orquestrada pelo LangGraph e que utilize RAG, a janela pra ela deve ficar no canto superior
direito"), o Assistente de IA foi atualizado em três frentes:

- **Leitura de todos os dados da plataforma** — antes a busca cobria só clientes, catálogo,
  ativação e fórum. Agora o índice (`ai-service/rag.py::collect_chunks`) também inclui documentos
  de cliente, alertas abertos e métricas de cliente — ou seja, toda tabela de dados da plataforma
  vira conteúdo pesquisável pelo Assistente, não um subconjunto.
- **RAG de verdade** — a etapa `retrieve` do grafo LangGraph deixou de fazer `ILIKE` (busca por
  substring) e passou a fazer busca por **similaridade vetorial**: cada chunk de conteúdo é
  convertido em um vetor de 192 dimensões (`TfidfVectorizer` + `TruncatedSVD`, scikit-learn, 100%
  local) e armazenado numa coluna `VECTOR(192)` do Postgres (extensão `pgvector`, índice
  `ivfflat`); a busca ordena por distância de cosseno e retorna um score de similaridade (0 a 1)
  por resultado. A escolha por TF-IDF+SVD em vez de embeddings neurais (ex. modelos do
  HuggingFace) não foi por limitação técnica do RAG em si, e sim porque o ambiente usado nesta
  sessão bloqueia acesso a `huggingface.co` por política de rede (confirmado via diagnóstico, não
  foi uma falha transitória) — então usar um modelo neural exigiria baixar algo que a rede não
  permite. O módulo `rag.py` isola essa decisão, então trocar por embeddings neurais depois (se a
  restrição de rede mudar, ou usando uma API de embeddings paga) é uma mudança localizada, sem
  tocar no resto do grafo. Como não há hook automático de reindexação a cada escrita (decisão de
  escopo), foi adicionado um botão "↻ Atualizar índice" no painel (chama
  `POST /api/assistant/reindex` → `POST /reindex` no ai-service) para reconstruir o índice sob
  demanda; o índice também se constrói sozinho na primeira vez que o serviço sobe.
- **Painel no canto superior direito** — o Assistente deixou de abrir como um drawer de tela
  cheia (com fundo escurecido cobrindo a tela inteira) e passou a ser um widget flutuante
  ancorado no canto superior direito (`top-5 right-5`, cartão arredondado com sombra, largura
  fixa e altura máxima que respeita o viewport), com scroll interno próprio. Clicar fora do
  painel continua fechando ele, mas sem escurecer a tela.

Verificação feita antes de considerar isso concluído: os 33 testes automatizados do backend
continuam passando sem alteração, `tsc --noEmit` limpo em backend e frontend, chamada direta ao
`ai-service` e pela cadeia completa via backend Node (incluindo o `/reindex` autenticado) e
screenshots via Playwright confirmando visualmente o painel no canto correto e uma resposta real
do RAG, agrupada por tipo de fonte com os scores de similaridade.

Detalhe técnico completo em `README.md` (seção "Assistente de IA — RAG sobre toda a base") e em
`ai-service/README.md`.

---

## 10. Atualização — plano de melhorias implementado, com mudanças de arquitetura (15/11/2026)

A pedido do Igor ("implemente as melhorias da melhor forma possível, faça alterações de
arquitetura se necessário, pesquise no mercado por soluções semelhantes"), o plano de melhorias
(`PLANO_MELHORIAS.md`) foi executado. O desenho detalhado está em `ARQUITETURA.md`; aqui fica o
registro do que mudou e do que o mercado inspirou.

### O que a pesquisa de mercado trouxe

- **Portais internos de desenvolvedor** (Backstage, Port, Cortex, OpsLevel): o que separa um
  catálogo de uma ferramenta de governança são os *scorecards* — verificações objetivas por item —
  e as relações entre componentes. → scorecard de governança e dependências no Catálogo.
- **Registros de agentes de IA** (Atlan, AWS, Collibra): todo agente com dono, estado de ciclo de
  vida e revisão periódica. → ciclo de vida, "revisado em", descontinuação com substituto.
- **Customer success** (Vitally, Gainsight, Totango, ChurnZero): score composto por sinais
  ponderados, histórico e alertas quando o score muda. → composição e histórico do health score,
  notificações de alertas graves.
- **Onboarding de clientes** (Rocketlane, GUIDEcx): templates de projeto, prazos por entregável,
  avisos automáticos. → templates de ativação com prazos calculados, "entregas da semana".
- **RAG em Postgres** (pgvector + full-text): busca híbrida com Reciprocal Rank Fusion é o padrão,
  porque vetor sozinho erra nomes próprios e siglas. → busca híbrida no Assistente.

### Mudanças de arquitetura

- **Barramento de eventos de domínio** no backend: as rotas publicam eventos; auditoria,
  notificações e reindexação do RAG são assinantes.
- **Fundação do backend refeita:** configuração validada, logs estruturados, tratamento central de
  erros, validação de entrada (zod), migrações versionadas, limite de requisições, health check de
  prontidão, encerramento gracioso.
- **Sessão:** access token curto + refresh token rotativo e revogável; cadastro nunca concede
  admin; contas desativáveis.
- **Serviço de IA:** busca híbrida, índice incremental e automático, modelo guardado no banco
  (serviço sem estado), pool de conexões, autenticação entre serviços, CORS fechado.
- **Deploy:** Dockerfiles, `docker-compose.yml` e pipeline do GitLab CI.

### Funcionalidades novas

Notificações (sino), busca global (Ctrl+K), painel de administração (usuários, auditoria, uso do
Assistente, categorias do fórum), scorecard e dependências no Catálogo, templates de Ativação,
composição e evolução do health score, alertas manuais e documentos pela tela, resposta aceita no
fórum, histórico e avaliação das respostas do Assistente.

### Problemas encontrados e corrigidos no caminho

- Qualquer pessoa conseguia se cadastrar já como **admin** (bastava enviar `role: "admin"`).
- Os modelos padrão do Assistente (`claude-3-5-*`) foram **aposentados** pela Anthropic: o
  Assistente falharia assim que uma chave fosse configurada. Padrões atualizados.
- O índice vetorial IVFFlat, com poucas linhas, podia **omitir resultados**; trocado por HNSW.
- Artefatos de projetos criados em lote apareciam em **ordem aleatória**; ganharam posição explícita.
- O rodapé do menu dizia "ClickUp ativo" **fixo no código**; agora reflete a configuração real.

### Verificação

112 testes no backend, 18 no serviço de IA e 17 no frontend, todos passando; tipagem e lint limpos;
os três serviços exercitados juntos no navegador (login, painel, catálogo, ativação, Visão 360,
busca, notificações, administração, assistente) sem erros de console.

**Não verificado:** a construção das imagens Docker (o ambiente bloqueia o Docker Hub), o caminho
do Assistente com chave da Anthropic, e as integrações reais com ClickUp e GitLab (sem credenciais).

