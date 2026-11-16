-- 006 — Composição e histórico do health score.
--
-- Um número isolado diz pouco: plataformas de customer success (Vitally, Gainsight, Totango)
-- mostram do que o score é composto e como ele evolui. `health_breakdown` guarda os
-- componentes do último cálculo; `client_health_history` guarda um ponto por cliente por dia.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS health_breakdown JSONB;

CREATE TABLE IF NOT EXISTS client_health_history (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  breakdown   JSONB,
  recorded_on DATE NOT NULL DEFAULT CURRENT_DATE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Um ponto por dia: recálculos no mesmo dia sobrescrevem o ponto, em vez de inflar a série.
  CONSTRAINT client_health_history_daily UNIQUE (client_id, recorded_on)
);

CREATE INDEX IF NOT EXISTS idx_client_health_history_client ON client_health_history(client_id, recorded_on DESC);

ALTER TABLE client_alerts  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
