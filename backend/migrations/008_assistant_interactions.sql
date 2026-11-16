-- 008 — Histórico e feedback do Assistente de IA.
--
-- Cada pergunta respondida vira uma linha: dá histórico por usuário (a conversa não some ao
-- fechar o painel), feedback 👍/👎 por resposta e, para o admin, visão do que o time pergunta.

CREATE TABLE IF NOT EXISTS assistant_interactions (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question         TEXT NOT NULL,
  answer           TEXT NOT NULL,
  citations        JSONB NOT NULL DEFAULT '[]',
  sources_used     TEXT[] NOT NULL DEFAULT '{}',
  ai_configured    BOOLEAN NOT NULL DEFAULT false,
  feedback         SMALLINT CHECK (feedback IN (-1, 1)),
  feedback_comment TEXT,
  duration_ms      INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_interactions_user ON assistant_interactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_interactions_feedback ON assistant_interactions(feedback) WHERE feedback IS NOT NULL;
