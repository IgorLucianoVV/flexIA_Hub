# FlexIA Hub — AI Service

Serviço Python (FastAPI + LangGraph) do Assistente de IA: recupera, por busca híbrida (RAG),
os trechos relevantes de toda a plataforma e sintetiza a resposta.

Este serviço é chamado **apenas pelo backend** — nunca direto pelo navegador.

## Como funciona

Grafo LangGraph com 3 nós:

1. **route** — um modelo rápido (`claude-haiku-5-5` por padrão) decide quais categorias
   (clientes, catálogo, ativação, fórum) são relevantes para a pergunta.
2. **retrieve** — busca híbrida nas categorias escolhidas (ver abaixo), e sempre inclui
   sinais estratégicos independentes da pergunta (clientes em risco, alertas abertos).
3. **synthesize** — um modelo mais capaz (`claude-sonnet-5-5` por padrão) redige a resposta
   citando as fontes, levando em conta as últimas trocas da conversa.

Sem `ANTHROPIC_API_KEY`, as etapas 1 e 2 funcionam normalmente (sem LLM) e a etapa 3 lista
os trechos recuperados, agrupados por tipo, com a similaridade e o caminho pelo qual cada um
foi encontrado.

> Os modelos `claude-3-5-*` usados em versões anteriores foram aposentados pela Anthropic;
> os padrões foram atualizados. O caminho com chave configurada **não foi exercitado** neste
> ambiente (não há chave) — vale um teste rápido ao configurá-la.

## Busca híbrida (`rag.py`)

Cada chunk fica em `rag_chunks` com um vetor denso (pgvector, índice HNSW) e um `tsvector`
em português sem acento (índice GIN; título com peso maior que o corpo). Uma pergunta:

1. vira um vetor e busca os 20 vizinhos mais próximos por cosseno (descartando os sem
   semelhança real);
2. tem seus termos ponderados por raridade (IDF) — termos presentes em mais de 40% do índice
   são ignorados — e busca os 20 chunks com maior soma de pesos;
3. as duas listas são fundidas por Reciprocal Rank Fusion (`Σ 1/(60 + posição)`), com um
   terceiro voto proporcional a quantos termos da pergunta estão no título do chunk.

Fontes indexadas: clientes (com a composição do health score), catálogo (com dependências e
descontinuação), projetos de ativação (com artefatos em aberto e prazos), tópicos e respostas
do fórum, documentos, alertas abertos, métricas e tasks do ClickUp.

Os embeddings são TF-IDF + SVD truncado, calculados localmente — sem API paga e sem baixar
modelo. Para trocar por embeddings neurais, só `_fit` e `_transform` mudam.

## Índice incremental e sem estado

- `POST /reindex` compara o hash de cada chunk com o banco e reprocessa só o que mudou;
  `?full=true` reajusta o modelo e reindexa tudo.
- O backend chama `/reindex` sozinho (com debounce) quando o conteúdo da plataforma muda.
- O modelo ajustado é reajustado do zero quando as mudanças acumuladas passam de
  `RAG_REFIT_THRESHOLD` (30%) do índice.
- O modelo fica na tabela `rag_index_state`, não em disco: o serviço pode reiniciar ou ter
  réplicas sem perder nem divergir o índice.
- Na subida, se o índice estiver vazio, ele é construído em segundo plano.

## Rodando localmente

```bash
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # DATABASE_URL, SERVICE_TOKEN e, se tiver, ANTHROPIC_API_KEY
python main.py             # http://localhost:8000
```

O banco precisa estar com as migrações do backend aplicadas (`cd backend && npm run migrate`).

## Testes

```bash
pip install -r requirements-dev.txt
python -m pytest
```

Rodam contra um PostgreSQL de verdade, num banco próprio (`flexia_hub_ai_test`) recriado a
cada execução com as migrações de `backend/migrations`.

## Endpoints

- `GET /health` — `{ ok, configured, checks.database, index }` (503 se o banco não responde)
- `POST /ask` — `{ question, history? }` → `{ answer, sources_used, citations, ai_configured }`
- `POST /reindex?full=false` — `{ mode, chunks_indexed, updated, removed, by_type, ... }`

`/ask` e `/reindex` exigem o cabeçalho `X-Service-Token` quando `SERVICE_TOKEN` está
definido (obrigatório com `APP_ENV=production`).
