-- 012 — Anexos do Catálogo: documentação, diagramas, árvores de diálogo, arquivos e links.
--
-- Cada item do catálogo (agente, chatbot, integração…) passa a carregar o material que explica
-- como ele funciona, no estilo "docs-like-code" de portais internos como o Backstage TechDocs:
--
--   documento       Markdown escrito no próprio Hub (README, decisões, runbook).
--   diagrama        Código Mermaid (arquitetura, fluxo, sequência), desenhado na tela.
--   arvore_dialogo  Fluxo de um chatbot normalizado em {nodes, edges}, navegável na tela.
--   arquivo         Upload (PDF, imagem, planilha, exportação JSON do bot…). Os bytes ficam no
--                   disco (UPLOADS_DIR); aqui ficam os metadados e o texto extraído.
--   link            Referência externa (Figma, Drive, Confluence, painel).
--
-- `content` guarda o Markdown, o código Mermaid ou o JSON da árvore. `extracted_text` guarda o
-- texto lido de um arquivo (PDF, texto, JSON) — é o que o Assistente de IA indexa.

CREATE TABLE IF NOT EXISTS knowledge_attachments (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  item_id        TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('documento', 'diagrama', 'arvore_dialogo', 'arquivo', 'link')),
  title          TEXT NOT NULL,
  content        TEXT,
  url            TEXT,
  file_name      TEXT,
  mime_type      TEXT,
  size_bytes     BIGINT,
  storage_key    TEXT UNIQUE,
  extracted_text TEXT,
  position       INT NOT NULL DEFAULT 0,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_attachments_item ON knowledge_attachments(item_id, position);
CREATE INDEX IF NOT EXISTS idx_knowledge_attachments_title_trgm
  ON knowledge_attachments USING gin (immutable_unaccent(lower(title)) gin_trgm_ops);
