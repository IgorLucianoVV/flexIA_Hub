-- 007 — Fórum: resposta aceita como solução e carimbo de edição nas respostas.

ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS accepted_reply_id TEXT REFERENCES forum_replies(id) ON DELETE SET NULL;
ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_forum_replies_author ON forum_replies(author_id);
