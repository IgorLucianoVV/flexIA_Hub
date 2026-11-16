-- 003 — Log de auditoria e notificações in-app.
--
-- Os dois são alimentados pelo barramento de eventos de domínio (src/lib/events.ts):
-- cada rota de escrita publica um evento; um assinante grava a linha de auditoria,
-- outro decide quem precisa ser notificado.

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- SET NULL (e não CASCADE): apagar um usuário não pode apagar o rastro do que ele fez.
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT NOT NULL DEFAULT 'Sistema',
  action      TEXT NOT NULL,           -- ex.: forum.thread.created, activation.artifact.updated
  entity_type TEXT NOT NULL,           -- ex.: forum_thread, client, knowledge_item
  entity_id   TEXT,
  summary     TEXT NOT NULL,           -- frase legível: "Marcou o artefato X como concluído"
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity  ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON audit_log(actor_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,            -- mesmo nome do evento que originou
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,                     -- rota do frontend para abrir ao clicar
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;
