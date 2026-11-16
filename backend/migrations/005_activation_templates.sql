-- 005 — Templates de projeto de Ativação.
--
-- Ferramentas de onboarding (Rocketlane, GUIDEcx) partem de um template de fases e
-- entregáveis em vez de montar cada projeto do zero. `phases` guarda a estrutura:
--   [{ "name": "Kickoff", "artifacts": [{ "name": "Ata de kickoff", "type": "documento", "dueOffsetDays": 3 }] }]
-- `dueOffsetDays` é o prazo do artefato em dias corridos a partir da data de início do projeto.

CREATE TABLE IF NOT EXISTS activation_templates (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  phases      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE activation_projects ADD COLUMN IF NOT EXISTS template_id TEXT REFERENCES activation_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_activation_artifacts_due ON activation_artifacts(due_date) WHERE status <> 'concluido';

-- Template padrão: é dado de referência (a sequência que o squad já usa), não dado de demonstração,
-- por isso vive na migração e não no seed.
INSERT INTO activation_templates (name, description, phases)
VALUES (
  'Ativação padrão',
  'Sequência padrão de onboarding do squad FlexIA: do kickoff ao acompanhamento pós-lançamento.',
  '[
    {"name": "Kickoff", "artifacts": [
      {"name": "Ata de kickoff", "type": "documento", "dueOffsetDays": 3},
      {"name": "Levantamento de requisitos", "type": "documento", "dueOffsetDays": 7},
      {"name": "Definição de escopo", "type": "documento", "dueOffsetDays": 10}
    ]},
    {"name": "Configuração e Integrações", "artifacts": [
      {"name": "Configuração do ambiente", "type": "configuracao", "dueOffsetDays": 17},
      {"name": "Integração com backend do cliente", "type": "configuracao", "dueOffsetDays": 28},
      {"name": "Configuração do fluxo conversacional", "type": "configuracao", "dueOffsetDays": 35}
    ]},
    {"name": "Testes e Homologação", "artifacts": [
      {"name": "Plano de testes", "type": "documento", "dueOffsetDays": 38},
      {"name": "Testes funcionais", "type": "homologacao", "dueOffsetDays": 45},
      {"name": "Homologação com o cliente", "type": "homologacao", "dueOffsetDays": 52}
    ]},
    {"name": "Go-live", "artifacts": [
      {"name": "Checklist de go-live", "type": "documento", "dueOffsetDays": 55},
      {"name": "Publicação em produção", "type": "configuracao", "dueOffsetDays": 58},
      {"name": "Comunicado de lançamento", "type": "documento", "dueOffsetDays": 59}
    ]},
    {"name": "Pós-lançamento", "artifacts": [
      {"name": "Monitoramento das 2 primeiras semanas", "type": "outro", "dueOffsetDays": 73},
      {"name": "Relatório de resultados", "type": "documento", "dueOffsetDays": 80}
    ]}
  ]'::jsonb
)
ON CONFLICT (name) DO NOTHING;
