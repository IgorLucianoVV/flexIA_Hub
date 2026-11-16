-- 001 — Schema inicial do FlexIA Hub (estado do banco antes das migrações versionadas).
-- Tudo aqui é idempotente (IF NOT EXISTS) porque bancos criados antes da adoção do runner
-- de migrações já têm estas tabelas: a 001 só as registra, sem recriar nada.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Usada pelo índice de RAG do Assistente de IA (ver seção "RAG" no README e ai-service/rag.py).
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- CLIENTES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name         TEXT NOT NULL,
  segment      TEXT,
  status       TEXT NOT NULL DEFAULT 'ativo',
  csm_owner    TEXT,
  health_score INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- CATÁLOGO DE CONHECIMENTO (GitLab como fonte primária)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_items (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type              TEXT NOT NULL, -- agente_ia | chatbot | instruction | arvore_dialogo | integracao | infraestrutura
  name              TEXT NOT NULL,
  description       TEXT,
  owner_team        TEXT,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'ativo', -- ativo | deprecado | em_revisao

  gitlab_project_id TEXT,
  gitlab_path       TEXT,
  gitlab_web_url    TEXT,
  gitlab_namespace  TEXT,
  last_synced_at    TIMESTAMPTZ,

  client_id         TEXT REFERENCES clients(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- GESTÃO DE PROJETOS DE ATIVAÇÃO
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activation_projects (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'em_andamento', -- planejado | em_andamento | concluido | atrasado
  owner_name  TEXT,
  start_date  DATE,
  target_date DATE,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activation_phases (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       TEXT NOT NULL,
  "order"    INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'pendente', -- pendente | em_andamento | concluido
  project_id TEXT NOT NULL REFERENCES activation_projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activation_artifacts (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name         TEXT NOT NULL,
  type         TEXT, -- documento | configuracao | treinamento | homologacao | outro
  status       TEXT NOT NULL DEFAULT 'pendente', -- pendente | em_andamento | concluido | bloqueado
  responsible  TEXT,
  due_date     DATE,
  completed_at TIMESTAMPTZ,
  phase_id     TEXT NOT NULL REFERENCES activation_phases(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- VISÃO 360 DO CLIENTE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_clickup_mappings (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  mapping_type  TEXT NOT NULL, -- custom_field | tag | list
  mapping_value TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clickup_task_cache (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  clickup_task_id TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL,
  list_name       TEXT,
  assignee        TEXT,
  due_date        TIMESTAMPTZ,
  url             TEXT,
  priority        TEXT,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_documents (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title      TEXT NOT NULL,
  source     TEXT NOT NULL, -- gitlab | drive | manual
  url        TEXT,
  category   TEXT,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_alerts (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  severity    TEXT NOT NULL, -- baixa | media | alta | critica
  message     TEXT NOT NULL,
  source      TEXT,
  resolved    BOOLEAN NOT NULL DEFAULT false,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS client_metrics (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  metric_key  TEXT NOT NULL,
  value       DOUBLE PRECISION NOT NULL,
  unit        TEXT,
  period      TEXT NOT NULL,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_type ON knowledge_items(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_client ON knowledge_items(client_id);
CREATE INDEX IF NOT EXISTS idx_activation_projects_client ON activation_projects(client_id);
CREATE INDEX IF NOT EXISTS idx_activation_phases_project ON activation_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_activation_artifacts_phase ON activation_artifacts(phase_id);
CREATE INDEX IF NOT EXISTS idx_clickup_cache_client ON clickup_task_cache(client_id);
CREATE INDEX IF NOT EXISTS idx_client_documents_client ON client_documents(client_id);
CREATE INDEX IF NOT EXISTS idx_client_alerts_client ON client_alerts(client_id);
CREATE INDEX IF NOT EXISTS idx_client_metrics_client ON client_metrics(client_id);

-- ---------------------------------------------------------------------------
-- USUÁRIOS / AUTENTICAÇÃO
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'dev', -- dev | analista_suporte | analista_ativacao | admin
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- FÓRUM
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_categories (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  "order"     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS forum_threads (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  category_id       TEXT NOT NULL REFERENCES forum_categories(id) ON DELETE RESTRICT,
  author_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id         TEXT REFERENCES clients(id) ON DELETE SET NULL,
  knowledge_item_id TEXT REFERENCES knowledge_items(id) ON DELETE SET NULL,
  pinned            BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forum_replies (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  body       TEXT NOT NULL,
  thread_id  TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forum_threads_category ON forum_threads(category_id);
CREATE INDEX IF NOT EXISTS idx_forum_threads_client ON forum_threads(client_id);
CREATE INDEX IF NOT EXISTS idx_forum_threads_knowledge_item ON forum_threads(knowledge_item_id);
CREATE INDEX IF NOT EXISTS idx_forum_replies_thread ON forum_replies(thread_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ---------------------------------------------------------------------------
-- RECUPERAÇÃO DE SENHA
-- Modo dev: sem provedor de email configurado ainda, o token é retornado pela
-- API e logado no console em vez de enviado por email (ver módulo auth).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON password_resets(token_hash);

-- ---------------------------------------------------------------------------
-- ÍNDICE DE RAG DO ASSISTENTE DE IA
-- Um "chunk" de texto por item relevante da plataforma (cliente, item do catálogo,
-- projeto de ativação, tópico/resposta do fórum, documento, alerta, métrica), com
-- um vetor denso calculado localmente (TF-IDF + SVD, ver ai-service/rag.py — não
-- depende de nenhuma API de embeddings externa). Reconstruído por completo a cada
-- chamada de POST /api/assistant/reindex (e automaticamente quando o ai-service sobe
-- com a tabela vazia). 192 dimensões é um valor fixo escolhido no ai-service; mudar
-- lá exige recriar esta coluna com a nova dimensão.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rag_chunks (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source_type TEXT NOT NULL, -- cliente | catalogo | ativacao | forum | documento | alerta | metrica
  source_id   TEXT NOT NULL,
  title       TEXT NOT NULL,
  path        TEXT,
  content     TEXT NOT NULL,
  embedding   VECTOR(192) NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_source_type ON rag_chunks(source_type);
-- Índice aproximado de vizinho mais próximo por similaridade de cosseno; com poucas
-- centenas de linhas o Postgres nem usa ele (scan completo já é rápido), mas já fica
-- pronto para quando a base crescer.
CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding ON rag_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
