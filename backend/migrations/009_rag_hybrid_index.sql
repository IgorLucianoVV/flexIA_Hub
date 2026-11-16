-- 009 — Índice de RAG híbrido e incremental.
--
-- 1. Busca híbrida: além do vetor (semântica), cada chunk ganha um tsvector (palavra-chave).
--    As duas listas são fundidas por Reciprocal Rank Fusion no ai-service — o padrão que o
--    mercado adota para RAG em Postgres, porque vetor sozinho erra nomes próprios e siglas.
-- 2. Índice incremental: `content_hash` permite reindexar só o que mudou.
-- 3. Serviço sem estado: o modelo ajustado (TF-IDF + SVD) passa a morar no banco
--    (`rag_index_state`) em vez de em arquivo local — necessário para rodar em contêiner.
-- 4. HNSW no lugar de IVFFlat: IVFFlat com poucas linhas e `probes = 1` examina só uma
--    fração das listas e perde resultados; HNSW não precisa de treino e tem recall melhor.

CREATE EXTENSION IF NOT EXISTS unaccent;

-- `unaccent()` é STABLE, e colunas geradas/índices exigem IMMUTABLE. O wrapper fixa o
-- dicionário, o que torna a função de fato determinística.
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- O índice é derivado dos dados da plataforma: esvaziar aqui é seguro, o ai-service o
-- reconstrói sozinho ao subir (rag.ensure_index).
DELETE FROM rag_chunks;

ALTER TABLE rag_chunks ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT '';
-- Título com peso A e conteúdo com peso B: a busca consegue distinguir "o termo está no
-- nome do item" de "o termo é citado no texto", e dar mais valor ao primeiro caso.
ALTER TABLE rag_chunks ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese', immutable_unaccent(title)), 'A') ||
    setweight(to_tsvector('portuguese', immutable_unaccent(content)), 'B')
  ) STORED;

DROP INDEX IF EXISTS idx_rag_chunks_embedding;
CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding_hnsw ON rag_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_tsv ON rag_chunks USING gin (tsv);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_chunks_source ON rag_chunks(source_type, source_id);

CREATE TABLE IF NOT EXISTS rag_index_state (
  id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- linha única
  model             BYTEA,                -- vetorizador TF-IDF + SVD serializados (joblib)
  effective_dims    INTEGER,
  n_chunks          INTEGER NOT NULL DEFAULT 0,
  -- Chunks alterados desde o último ajuste completo: quando passa de um limite, o modelo
  -- é reajustado do zero (o vocabulário mudou demais para só projetar os chunks novos).
  changes_since_fit INTEGER NOT NULL DEFAULT 0,
  fitted_at         TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
