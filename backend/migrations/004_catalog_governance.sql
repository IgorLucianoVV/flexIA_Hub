-- 004 — Governança do Catálogo: ciclo de vida, revisão periódica e dependências.
--
-- Inspirado no que portais internos (Backstage, Port, Cortex) e registros de agentes de IA
-- tratam como o mínimo de governança: todo item tem dono, estado de ciclo de vida, data da
-- última revisão e relações explícitas com os componentes dos quais depende.

ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS deprecation_note TEXT;
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS replaced_by_id   TEXT REFERENCES knowledge_items(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS knowledge_relations (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  from_id       TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  to_id         TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'depende_de', -- "from depende de to"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_relations_no_self CHECK (from_id <> to_id),
  CONSTRAINT knowledge_relations_unique UNIQUE (from_id, to_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_relations_from ON knowledge_relations(from_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_to   ON knowledge_relations(to_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_status   ON knowledge_items(status);
