-- 011 — Ordem explícita dos artefatos dentro da fase.
--
-- Até aqui a ordem era a de criação (`created_at`). Projetos criados a partir de um template
-- inserem todos os artefatos numa única transação — todos com o mesmo `created_at` —, então
-- a ordem dos artefatos na tela ficava ao acaso. `position` torna a ordem determinística.

ALTER TABLE activation_artifacts ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- Artefatos que já existiam: numera na ordem em que apareciam (criação).
UPDATE activation_artifacts a
   SET position = ranked.rn
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY phase_id ORDER BY created_at, id) - 1 AS rn
      FROM activation_artifacts
  ) ranked
 WHERE ranked.id = a.id;
