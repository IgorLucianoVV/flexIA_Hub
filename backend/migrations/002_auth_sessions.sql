-- 002 — Sessões com refresh token e contas desativáveis.
--
-- Antes: um único JWT de 30 dias, sem revogação (logout só apagava o token no navegador).
-- Agora: access token curto + refresh token opaco, guardado só como hash, rotacionado a
-- cada uso e revogável no servidor (logout, desativação de conta, detecção de reuso).

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active     BOOLEAN     NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('dev', 'analista_suporte', 'analista_ativacao', 'admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  -- Todos os tokens gerados por rotação a partir de um mesmo login compartilham a família.
  -- Se um token já rotacionado for apresentado de novo (sinal de roubo), a família inteira cai.
  family_id      TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  replaced_by_id TEXT REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user   ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
