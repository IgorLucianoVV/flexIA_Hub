# FlexIA Hub — Arquitetura

Como as peças se encaixam e por que foram desenhadas assim. Para rodar, veja o `README.md`.

## Visão de conjunto

```
navegador ──► frontend (nginx/Vite) ──/api──► backend (Express) ──► PostgreSQL
                                                  │  ▲                 ▲
                                    X-Service-Token│  │eventos          │ lê dados de negócio,
                                                  ▼  │                 │ grava só o índice de RAG
                                              ai-service (FastAPI + LangGraph) ─┘
```

- O **usuário só fala com o backend**. É o backend que valida login e papel.
- O **serviço de IA só aceita chamadas do backend** (segredo compartilhado). Ele lê as tabelas de negócio e escreve apenas nas do próprio índice (`rag_chunks`, `rag_index_state`).
- **Um banco só**: dados relacionais, vetores (pgvector) e busca textual (full-text, `pg_trgm`) moram no mesmo PostgreSQL. Não há serviço de busca nem fila à parte para manter em sincronia.

## Backend

### Fundação (`src/lib`, `src/config.ts`)

| Peça | O que resolve |
|---|---|
| `config.ts` | Único ponto que lê `process.env`, validado com zod na subida. Configuração errada derruba o processo com mensagem clara em vez de falhar no meio de uma requisição. |
| `lib/errors.ts` | Tratamento central de erros. As rotas lançam `HttpError`/`ZodError`; erros de cliente do PostgreSQL (FK, unicidade) viram 4xx; o inesperado vira 500 logado com o id da requisição, sem vazar detalhes. |
| `lib/validate.ts` | Schemas zod para o corpo das rotas de escrita. |
| `lib/logger.ts` | Logs estruturados (pino), com mascaramento de dados sensíveis. |
| `lib/migrate.ts` | Runner de migrações versionadas, com advisory lock contra execução concorrente. |
| `lib/rateLimit.ts` | Limite de requisições por IP. O contador é em memória — com mais de uma réplica, troque o store por um compartilhado (Redis). |
| `db.ts` | Pool com timeouts de conexão e de consulta; `withTransaction` para escritas que não podem ficar pela metade. |

### Eventos de domínio (`lib/events.ts`)

As rotas não chamam auditoria, notificação nem reindexação diretamente. Elas **publicam um evento** ("resposta criada no fórum") e três assinantes reagem:

```
rota de escrita ──publish──► barramento ──► auditoria      (grava audit_log)
                                        ├─► notificações   (decide quem avisar)
                                        └─► reindexação    (agenda sync do RAG, com debounce)
```

Acrescentar um efeito novo (email, webhook para o Slack) é escrever um assinante; nenhuma rota muda. A falha de um assinante é logada e não derruba a requisição.

O barramento é **in-process**: simples e suficiente para uma instância. Se um evento precisar sobreviver a uma queda do processo ou ser consumido por outro serviço, o passo seguinte é uma tabela de outbox no PostgreSQL — a interface `publish`/`subscribe` não muda.

### Sessão

Access token JWT curto + refresh token opaco com rotação e detecção de reuso (`modules/auth/tokens.ts`). O JWT é verificado sem ir ao banco; a revogação acontece no refresh. Consequência assumida: desativar uma conta ou mudar um papel leva até `ACCESS_TOKEN_TTL` (1h) para valer em sessões já abertas.

### Módulos

Cada módulo em `src/modules/<nome>` tem suas rotas e, quando há regra de negócio que vale ser testada isoladamente, um arquivo próprio para ela (`clients/healthScore.ts`, `knowledge/scorecard.ts`). Regras derivadas são calculadas, não digitadas: health score, status de fase/projeto de ativação, scorecard do catálogo.

## Serviço de IA

Grafo LangGraph de três nós: `route` (um modelo rápido escolhe as categorias) → `retrieve` (busca híbrida) → `synthesize` (um modelo mais capaz redige a resposta com as fontes).

**Recuperação (`rag.py`)**

1. Cada registro relevante vira um *chunk* de texto com um hash do conteúdo.
2. Cada chunk é indexado duas vezes: vetor denso (`embedding`, índice HNSW) e `tsvector` em português sem acento (índice GIN), com o título pesando mais que o corpo.
3. A pergunta consulta as duas listas; os resultados são fundidos por **Reciprocal Rank Fusion**. Do lado de palavra-chave, cada termo pesa pela raridade (IDF) e termos presentes em quase todo o índice são ignorados.
4. `sync_index()` compara hashes e reprocessa só o que mudou; o modelo é reajustado do zero quando o índice mudou demais.

**Por que TF-IDF + SVD e não embeddings neurais:** não exige API paga nem download de modelo. A busca por palavra-chave ao lado cobre a principal fraqueza dessa técnica (termos raros). A substituição por um modelo neural fica restrita a `_fit`/`_transform` em `rag.py`.

**Conversa:** o backend guarda cada interação e envia as últimas trocas junto com a pergunta; perguntas curtas de continuação são buscadas junto com a pergunta anterior.

## Frontend

- `api.ts` centraliza as chamadas e a renovação silenciosa da sessão (uma única renovação mesmo com várias requisições recebendo 401 ao mesmo tempo).
- `ErrorBoundary` por rota: um erro de renderização não derruba o app inteiro.
- A interface nunca depende só de cor para comunicar estado (ícone e texto acompanham).
- Estado de servidor é buscado por tela, sem cache compartilhado. Se a navegação começar a parecer lenta com mais dados, adotar uma camada de cache (TanStack Query) é o próximo passo natural.

## Decisões e seus custos

| Decisão | Ganho | Custo aceito |
|---|---|---|
| SQL direto, sem ORM | Consultas explícitas, sem dependência de binários | Sem tipos gerados a partir do schema |
| Eventos in-process | Efeitos colaterais desacoplados, sem infraestrutura nova | Evento se perde se o processo cair entre a escrita e o assinante |
| JWT sem consulta ao banco | Autenticação barata por requisição | Revogação não é instantânea (até 1h) |
| Tokens em `localStorage` | Sessão entre abas, implementação simples | Exposição a XSS; mitigada por token curto e refresh revogável |
| Embeddings locais (LSA) | Zero credencial, zero rede | Qualidade semântica inferior à de um modelo neural |
| Um PostgreSQL para tudo | Uma coisa só para operar e fazer backup | Em escala muito maior, busca e vetores podem pedir serviços dedicados |
