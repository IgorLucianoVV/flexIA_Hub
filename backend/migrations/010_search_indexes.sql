-- 010 — Índices para a busca global (Ctrl+K) e para as buscas por texto dos módulos.
--
-- A busca compara `immutable_unaccent(lower(coluna)) LIKE '%termo%'`. Sem índice isso é
-- varredura completa; com pg_trgm o Postgres resolve `LIKE '%...%'` por índice.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_clients_name_trgm
  ON clients USING gin (immutable_unaccent(lower(name)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_name_trgm
  ON knowledge_items USING gin (immutable_unaccent(lower(name)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_forum_threads_title_trgm
  ON forum_threads USING gin (immutable_unaccent(lower(title)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_activation_projects_name_trgm
  ON activation_projects USING gin (immutable_unaccent(lower(name)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_client_documents_title_trgm
  ON client_documents USING gin (immutable_unaccent(lower(title)) gin_trgm_ops);
