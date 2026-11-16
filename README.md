# FlexIA Hub

Plataforma interna do squad FlexIA para governança e descoberta de conhecimento técnico, gestão de projetos de Ativação e Visão 360 do cliente — com fórum, notificações, busca global e um Assistente de IA que responde com base em todos os dados da plataforma.

Documentos de apoio: `docs/PLANO_DESENVOLVIMENTO.md` (plano, benchmark de mercado, histórico do que foi construído) e `docs/ARQUITETURA.md` (como as peças se encaixam e por quê).

## Stack

| Serviço | Tecnologia | Papel |
|---|---|---|
| `backend/` | Node.js 22 + Express 5 + PostgreSQL (`pg`, SQL parametrizado) + zod + pino | API, regras de negócio, autenticação, eventos de domínio |
| `ai-service/` | Python 3.13 + FastAPI + LangGraph + scikit-learn + pgvector | Assistente de IA: busca híbrida (RAG) e síntese |
| `frontend/` | React 19 + Vite + TypeScript + Tailwind CSS | Interface web |
| Banco | PostgreSQL 16 com `pgvector`, `unaccent`, `pg_trgm` | Dados, índice vetorial e busca textual |

## Como rodar

### Opção A — Docker (recomendado para qualquer ambiente que não seja o seu computador)

```bash
cp .env.example .env        # preencha POSTGRES_PASSWORD, JWT_SECRET e AI_SERVICE_TOKEN
docker compose up --build   # Hub em http://localhost:8080
```

O compose sobe o banco, aplica as migrações, sobe a API, o serviço de IA e o frontend (nginx). Só o frontend é publicado para fora; a API é acessada por `/api` no mesmo endereço e o serviço de IA só é alcançável pela API.

Para criar o primeiro administrador (o cadastro pela tela nunca concede admin):

```bash
# a pessoa se cadastra pela tela e depois:
docker compose exec backend node dist/scripts/promote-user.js email@exemplo.com admin
```

Para carregar os dados de demonstração (apaga os dados de negócio existentes — por isso exige `--force` em produção):

```bash
docker compose exec backend node dist/scripts/seed.js --force
```

### Opção B — local, sem Docker

Pré-requisitos: Node 22, Python 3.13 e um PostgreSQL 16 com as extensões `pgvector`, `unaccent` e `pg_trgm`.

O caminho mais simples para o banco é usar o do Docker mesmo rodando o resto fora dele: `docker compose up -d db`
publica o PostgreSQL (já com pgvector) em `127.0.0.1:5433`. Os `.env.example` já apontam para lá — só troque
`CHANGE_ME` pelo `POSTGRES_PASSWORD` do `.env` da raiz. Um PostgreSQL instalado na máquina (ex.: o instalador do
Windows) normalmente **não** tem o pgvector e usa outra senha; se a API responder "Erro interno do servidor" no
login, confira `GET /api/health/ready`, que mostra o erro de conexão com o banco.

```bash
# 1. Banco
docker compose up -d db   # ou, num PostgreSQL próprio: CREATE DATABASE flexia_hub;

# 2. Backend
cd backend
npm install
cp .env.example .env     # ajuste DATABASE_URL e gere um JWT_SECRET
npm run migrate          # aplica as migrações versionadas (backend/migrations)
npm run seed             # opcional: dados de demonstração
npm run dev              # API em http://localhost:4000

# 3. AI Service
cd ../ai-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env     # mesmo DATABASE_URL; SERVICE_TOKEN = AI_SERVICE_TOKEN do backend
python main.py           # http://localhost:8000

# 4. Frontend
cd ../frontend
npm install
npm run dev              # http://localhost:5173 (repassa /api para o backend)
```

Contas de demonstração criadas pelo seed (senha `demo1234`): `demo@flexia.local` (admin) e `ana@flexia.local` (analista de ativação). Use as duas para ver as notificações: uma responde no fórum, a outra recebe o aviso no sino.

## O que a plataforma faz

- **Visão geral** — indicadores calculados no banco: clientes em risco, alertas, projetos atrasados, entregas da semana, governança do catálogo.
- **Catálogo de Conhecimento** — agentes, chatbots, instructions, integrações. Cada item tem um **scorecard de governança** (dono, descrição, tags, repositório, revisão recente, ciclo de vida), **dependências** entre itens (com proteção contra ciclos) e ciclo de vida com descontinuação e substituto.
- **Ativação** — projetos com fases e artefatos, criados a partir de **templates** (já nascem com prazos calculados). O status das fases e do projeto é derivado dos artefatos; prazos vencidos aparecem sozinhos.
- **Clientes — Visão 360** — tasks do ClickUp, documentos, métricas, alertas (manuais e automáticos), **composição do health score** ("por que 49?") e **gráfico de evolução**.
- **Fórum** — tópicos vinculáveis a cliente/item do catálogo, respostas, **resposta marcada como solução**.
- **Notificações** — sino com avisos de respostas no fórum, alertas graves de clientes, projetos concluídos, mudanças de papel.
- **Busca global (Ctrl+K)** — ir direto a um cliente, item, projeto, tópico, documento ou task pelo nome, ignorando acentos.
- **Assistente de IA** (canto superior direito) — responde perguntas com base em toda a plataforma, guarda o histórico da conversa e aceita avaliação 👍/👎 de cada resposta.
- **Administração** (só admin) — usuários e papéis, log de auditoria, uso do Assistente, categorias do fórum.

## Sessão e segurança

- **Toda rota de dados exige login.** As únicas rotas abertas são as de autenticação e os health checks.
- **Sessão em duas peças:** access token JWT curto (1h) + refresh token opaco (30 dias), guardado no banco só como hash, **rotacionado a cada uso** e revogável. Logout encerra a sessão no servidor; reuso de um refresh token já rotacionado derruba todas as sessões derivadas daquele login. O frontend renova o access token em silêncio.
- **Ninguém se cadastra como admin.** Admin é concedido por outro admin (painel) ou por `npm run user:promote -- email admin`. O Hub nunca fica sem admin ativo e um admin não remove o próprio acesso.
- **Contas desativáveis** pelo painel; desativar encerra as sessões da pessoa. (O access token já emitido ainda vale até expirar — no máximo 1h.)
- **Limite de requisições** por IP em login (10/15min), cadastro e redefinição de senha, além de um teto geral da API.
- **Configuração validada na subida** (`backend/src/config.ts`): variável obrigatória ausente ou inválida derruba o processo com mensagem clara. `JWT_SECRET` não tem valor padrão.
- **Entrada validada com zod** em todas as rotas de escrita; SQL sempre parametrizado; cabeçalhos de segurança (`helmet`); CORS restrito por `CORS_ORIGINS`.
- **Backend ↔ serviço de IA** autenticados por um segredo compartilhado (`AI_SERVICE_TOKEN` / `SERVICE_TOKEN`), obrigatório em produção.
- **Recuperação de senha:** ainda não há provedor de email. Em desenvolvimento, o token de redefinição volta na resposta da API; em produção isso fica desligado por padrão (`EXPOSE_RESET_TOKEN`), e sem email o fluxo não entrega o token — conectar um provedor de email é o próximo passo dessa parte.

### Permissões por papel

Papéis: `dev`, `analista_suporte`, `analista_ativacao`, `admin`. Leitura: qualquer usuário logado.

| Área | Ação | Quem pode |
|---|---|---|
| Clientes | Cadastrar cliente | `admin`, `analista_ativacao` |
| Clientes | Abrir/resolver alerta, anexar documento | `admin`, `analista_ativacao`, `analista_suporte` |
| Ativação | Criar/editar/apagar projeto, fase, artefato, template | `admin`, `analista_ativacao` |
| Ativação | Atualizar um artefato (status, prazo, responsável) | `admin`, `analista_ativacao`, `dev` |
| Catálogo | Cadastrar, editar, revisar, dependências | `admin`, `dev` |
| Catálogo / ClickUp | Disparar sincronização | qualquer usuário logado |
| Fórum | Criar tópico, responder | qualquer usuário logado |
| Fórum | Editar/apagar | o autor, ou `admin` |
| Fórum | Marcar resposta como solução | o autor do tópico, ou `admin` |
| Fórum | Criar/editar categoria | `admin` |
| Administração | Usuários, auditoria, uso do Assistente | `admin` |

## Health score e alertas automáticos

O `health_score` parte de 100 e desconta pontos por sinais que já existem no banco, cada um com um teto: tasks do ClickUp vencidas (−8 cada, até −40), projetos de ativação atrasados (−15 cada, até −45) e alertas manuais abertos (peso por severidade, até −30). O cálculo (`backend/src/modules/clients/healthScore.ts`):

- roda ao abrir a Visão 360, depois de um sync do ClickUp, ao mexer em artefatos/projetos de ativação e ao abrir/resolver alertas;
- guarda a **composição** do score e **um ponto por dia** no histórico (gráfico de tendência);
- abre e resolve sozinho os alertas automáticos (`source` começando em "Cálculo automático"); alertas manuais nunca são tocados;
- publica eventos — é assim que um alerta grave vira notificação para o time.

## Assistente de IA — RAG com busca híbrida

Detalhes em `ai-service/README.md`. Em resumo:

- **Fontes indexadas:** clientes (com a composição do health score), catálogo (com dependências), projetos de ativação (com artefatos em aberto e prazos), fórum, documentos, alertas, métricas e tasks do ClickUp.
- **Busca híbrida:** similaridade vetorial (pgvector) + palavra-chave (full-text em português, sem acento, com peso por raridade do termo), fundidas por Reciprocal Rank Fusion. Vetor sozinho erra nomes próprios e siglas; palavra-chave sozinha erra sinônimos.
- **Índice incremental e automático:** o backend avisa o serviço de IA quando o conteúdo muda e só o que mudou é reprocessado. O botão "Sincronizar índice" continua existindo para forçar.
- **Serviço sem estado:** o modelo de embeddings mora no banco, não em arquivo local.
- **Embeddings:** TF-IDF + SVD calculados localmente (sem API paga e sem download de modelo). A troca por embeddings neurais é localizada em duas funções.
- **Sem `ANTHROPIC_API_KEY`**, o assistente mostra os trechos recuperados, sem síntese. Os modelos padrão são `claude-haiku-5-5` (roteamento) e `claude-sonnet-5-5` (síntese).

## Integrações

### ClickUp
1. Gere um Personal API Token em **ClickUp > Settings > Apps** e preencha `CLICKUP_API_TOKEN`.
2. Confirme `CLICKUP_TEAM_ID` (o workspace da FlexIA é `3034181`).
3. Mapeie cliente↔ClickUp em `client_clickup_mappings` (o seed cria mapeamentos por **tag** para os 5 clientes identificados).
4. Clique em "Sincronizar agora" na página do cliente (ou `POST /api/integrations/clickup/sync`).

### GitLab (aguardando credenciais)
1. Gere um token com escopo `read_api` + `read_repository` e preencha `GITLAB_URL`, `GITLAB_TOKEN`, `GITLAB_GROUP`.
2. Clique em "Sincronizar com o GitLab" no Catálogo.
3. A classificação por tipo é uma heurística de nome/tópicos — ajuste `inferKnowledgeType()` em `backend/src/modules/integrations/gitlab/client.ts` ao padrão real de nomenclatura.

O rodapé do menu mostra quais integrações estão configuradas (lido de `GET /api/integrations/status`).

## Banco de dados e migrações

O schema é versionado em `backend/migrations/NNN_nome.sql`. `npm run migrate` aplica as pendentes, em ordem, cada uma numa transação, e registra em `schema_migrations`. Para mudar o schema, **crie a próxima migração** — nunca edite uma já aplicada (o runner avisa se o conteúdo de uma migração aplicada mudou). No Docker, as migrações rodam sozinhas na subida do backend.

## Testes

```bash
cd backend    && npm test                 # 112 testes (vitest + supertest), banco flexia_hub_test
cd ai-service && python -m pytest         # 18 testes (pytest), banco flexia_hub_ai_test
cd frontend   && npm test                 # 17 testes (vitest + Testing Library)
```

Backend e serviço de IA testam contra um PostgreSQL de verdade, em bancos próprios criados automaticamente com as mesmas migrações de produção — os dados de desenvolvimento nunca são tocados. O `.gitlab-ci.yml` roda tipagem, lint e os três conjuntos de testes a cada alteração.

O que os testes **não** cobrem: o caminho com `ANTHROPIC_API_KEY` configurada (roteamento e síntese por LLM), as chamadas reais ao ClickUp/GitLab e fluxos de tela de ponta a ponta no navegador (verificados manualmente).

## Observabilidade

- **Logs estruturados** (JSON em produção) nos dois serviços, com id de requisição (`X-Request-Id`) que atravessa do backend ao serviço de IA; dados sensíveis são mascarados.
- **Health checks:** `GET /api/health` (o processo está de pé) e `GET /api/health/ready` (consegue falar com o banco; 503 se não). No serviço de IA, `GET /health` reporta banco e estado do índice.
- **Auditoria:** toda escrita vira uma linha em `audit_log` (quem, o quê, quando), visível em Administração > Auditoria.

## Estrutura

```
flexia-hub/
├── docker-compose.yml, .env.example, .gitlab-ci.yml
├── docs/                          ← plano de desenvolvimento e arquitetura
├── backend/
│   ├── migrations/                ← schema versionado (SQL)
│   ├── tests/                     ← vitest + supertest
│   └── src/
│       ├── config.ts              ← única leitura de variáveis de ambiente (validada)
│       ├── app.ts / server.ts     ← composição do Express / listen + encerramento gracioso
│       ├── lib/                   ← logger, erros, validação, eventos, migrações, rate limit
│       ├── scripts/               ← migrate, seed, promote-user
│       └── modules/{auth,clients,knowledge,activation,forum,assistant,
│                    notifications,search,dashboard,admin,audit,integrations}/
├── ai-service/
│   ├── rag.py                     ← índice e busca híbrida
│   ├── graph.py                   ← grafo LangGraph: route → retrieve → synthesize
│   ├── db.py, config.py, main.py
│   └── tests/                     ← pytest
└── frontend/
    └── src/{pages,components,lib}/, api.ts, session.ts
```

## Pendências que dependem de decisão ou credencial

1. Credenciais do GitLab (catálogo real) e token do ClickUp no ambiente definitivo.
2. `ANTHROPIC_API_KEY` para o Assistente sintetizar respostas.
3. Provedor de email (recuperação de senha em produção; notificações por email).
4. Onde hospedar — o `docker-compose.yml` é o ponto de partida.
5. Padrão de associação cliente↔ClickUp (hoje por tag; campo customizado é mais robusto).
