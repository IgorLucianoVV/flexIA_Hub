"""
Índice de RAG (Retrieval-Augmented Generation) do Assistente de IA.

O assistente recupera trechos ("chunks") de TODOS os dados da plataforma — clientes,
catálogo de conhecimento, projetos de ativação, tópicos/respostas do fórum, documentos,
alertas, métricas e tasks do ClickUp — e responde com base neles.

### Busca híbrida (vetor + palavra-chave, fundidos por RRF)

Cada chunk é indexado de duas formas na tabela `rag_chunks`:

  - `embedding` (pgvector): um vetor denso — captura semelhança de assunto, mesmo sem as
    mesmas palavras;
  - `tsv` (full-text do Postgres, em português e sem acentos): captura a palavra exata —
    nomes próprios, siglas e códigos, que é justamente onde busca vetorial sozinha erra.

Uma pergunta consulta as duas listas (20 candidatos de cada) e as funde por Reciprocal Rank
Fusion: `score = Σ 1 / (60 + posição)`. Quem aparece bem colocado nas duas sobe; quem só
aparece em uma ainda entra. É o padrão que o mercado adotou para RAG em Postgres.

O lado de palavra-chave pondera cada termo da pergunta pela raridade (IDF): o `ts_rank` do
Postgres não faz isso sozinho, e sem essa correção uma palavra que aparece em quase todo
chunk ("cliente") domina o ranking. Termos presentes em mais de 40% do índice são ignorados;
os demais valem mais quanto mais raros forem — na prática, um BM25 simplificado.

### Por que TF-IDF + SVD (LSA) como embedding, e não um modelo neural

Um modelo de embeddings neural exigiria ou uma API paga (mais uma credencial pendente — a
Anthropic não tem API própria de embeddings) ou baixar um modelo, e o ambiente onde isto
foi desenvolvido bloqueia `huggingface.co` por política de rede. TF-IDF + SVD truncado é
calculado localmente, sem rede. Com a busca por palavra-chave ao lado, a principal fraqueza
do LSA (termos raros) fica coberta. A troca por embeddings neurais continua localizada:
só `_fit`/`_transform` mudariam — o schema, a busca híbrida e o grafo não mudam.

### Índice incremental e serviço sem estado

  - `sync_index()` compara o hash de cada chunk com o que está no banco e só reprocessa o
    que mudou. O backend chama isso sozinho quando o conteúdo muda (com debounce).
  - O modelo ajustado só é refeito do zero quando uma fração relevante do índice mudou
    (`RAG_REFIT_THRESHOLD`) — até lá, chunks novos são projetados no espaço já existente.
  - O modelo mora no banco (`rag_index_state`), não em arquivo local: o serviço pode
    reiniciar ou ter mais de uma réplica sem perder nem divergir o índice.
"""
import hashlib
import io
import logging
import re
import threading
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
import psycopg2.extras
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer

import db
from config import settings

logger = logging.getLogger(__name__)

EMBED_DIM = 192
RRF_K = 60
CANDIDATES_PER_SIDE = 20
# Vizinho vetorial abaixo disso não tem semelhança real com a pergunta: não conta como candidato.
MIN_VECTOR_SIMILARITY = 0.1
# Termo da pergunta presente em mais do que esta fração dos chunks não discrimina nada.
MAX_TERM_DOCUMENT_RATIO = 0.4
# Chave arbitrária do advisory lock: uma sincronização do índice por vez, mesmo com réplicas.
SYNC_LOCK_KEY = 727_274_002

# Palavras sem conteúdo (já sem acento, porque o vetorizador remove acentos antes).
PT_STOPWORDS = sorted(
    {
        "a", "ao", "aos", "as", "ate", "com", "como", "da", "das", "de", "dela", "dele", "deles", "depois",
        "do", "dos", "e", "ela", "elas", "ele", "eles", "em", "entre", "era", "essa", "essas", "esse", "esses",
        "esta", "estao", "estas", "este", "estes", "eu", "foi", "foram", "ha", "isso", "isto", "ja", "la",
        "mais", "mas", "me", "mesmo", "meu", "minha", "muito", "na", "nao", "nas", "nem", "no", "nos", "nossa",
        "nosso", "num", "numa", "o", "os", "ou", "para", "pela", "pelas", "pelo", "pelos", "por", "pra", "qual",
        "quais", "quando", "que", "quem", "se", "sem", "ser", "seu", "seus", "so", "sobre", "sua", "suas",
        "tambem", "te", "tem", "tinha", "um", "uma", "voce", "voces",
    }
)

PT_STOPWORD_SET = frozenset(PT_STOPWORDS)
_TOKEN_RE = re.compile(r"[a-z0-9]{2,}")


def _singular(token: str) -> str:
    """Reduz plurais comuns do português ao singular ("clientes" -> "cliente", "integrações"
    -> "integracao", "atrasados" -> "atrasado"). Sem isso, pergunta no plural e conteúdo no
    singular seriam palavras diferentes para o modelo."""
    if len(token) <= 3 or not token.endswith("s"):
        return token
    if token.endswith("oes") or token.endswith("aes"):
        return token[:-3] + "ao"
    if token.endswith("ais") and len(token) > 4:
        return token[:-2] + "l"
    if token.endswith("ns"):
        return token[:-2] + "m"
    if token.endswith("res") or token.endswith("zes"):
        return token[:-2]
    if token.endswith("ss"):
        return token
    return token[:-1]


def tokenize(text: str) -> List[str]:
    """Tokenizador do modelo de embeddings: minúsculas, sem acento, sem palavras vazias e
    com plural normalizado. (Função de módulo — e não lambda — porque é serializada junto
    com o vetorizador.)"""
    normalized = unicodedata.normalize("NFKD", text.lower()).encode("ascii", "ignore").decode("ascii")
    return [_singular(t) for t in _TOKEN_RE.findall(normalized) if t not in PT_STOPWORD_SET]


_sync_lock = threading.Lock()
_model_cache: Dict[str, Any] = {"fitted_at": None, "bundle": None}


# ---------------------------------------------------------------------------
# 1. Coleta de chunks — todo texto relevante de toda a plataforma
# ---------------------------------------------------------------------------
def _clean(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _chunk(source_type: str, source_id: str, title: str, path: str, content: str) -> Dict[str, str]:
    content = " ".join(content.split())
    digest = hashlib.sha256(f"{title}\n{path}\n{content}".encode("utf-8")).hexdigest()
    return {
        "source_type": source_type,
        "source_id": source_id,
        "title": title,
        "path": path,
        "content": content,
        "content_hash": digest,
    }


def _describe_health(breakdown: Optional[Dict[str, Any]]) -> str:
    """Transforma a composição do health score em texto, para o assistente conseguir
    explicar POR QUE um cliente está com o score que está."""
    if not breakdown:
        return ""
    parts = [
        f"{c['count']} {c['label'].lower()} (-{c['penalty']} pontos)"
        for c in breakdown.get("components", [])
        if c.get("penalty")
    ]
    return f" O que pesa no score: {'; '.join(parts)}." if parts else " Nenhum sinal negativo pesando no score."


def collect_chunks() -> List[Dict[str, str]]:
    chunks: List[Dict[str, str]] = []

    for r in db.fetch_all(
        """SELECT c.id, c.name, c.segment, c.status, c.csm_owner, c.health_score, c.health_breakdown,
                  (SELECT COUNT(*) FROM client_alerts a WHERE a.client_id = c.id AND a.resolved = false) AS open_alerts
             FROM clients c"""
    ):
        score = r["health_score"]
        if score is None:
            situation = "health score ainda não calculado"
        elif score < 70:
            situation = "cliente em risco (health score baixo)"
        elif score < 85:
            situation = "cliente em atenção"
        else:
            situation = "cliente saudável"
        content = (
            f"Cliente: {r['name']}. Segmento: {_clean(r['segment']) or 'não informado'}. "
            f"Status: {r['status']}. CSM responsável: {_clean(r['csm_owner']) or 'não informado'}. "
            f"Health score atual: {score if score is not None else 'não calculado'}. Situação: {situation}. "
            f"Alertas abertos: {r['open_alerts']}.{_describe_health(r['health_breakdown'])}"
        )
        chunks.append(_chunk("cliente", r["id"], r["name"], f"/clientes/{r['id']}", content))

    for r in db.fetch_all(
        """SELECT k.id, k.type, k.name, k.description, k.tags, k.status, k.owner_team, k.deprecation_note,
                  c.name AS client_name, rb.name AS replaced_by_name,
                  (SELECT string_agg(d.name, ', ' ORDER BY d.name)
                     FROM knowledge_relations r JOIN knowledge_items d ON d.id = r.to_id
                    WHERE r.from_id = k.id) AS depends_on,
                  (SELECT string_agg(d.name, ', ' ORDER BY d.name)
                     FROM knowledge_relations r JOIN knowledge_items d ON d.id = r.from_id
                    WHERE r.to_id = k.id) AS dependents
             FROM knowledge_items k
             LEFT JOIN clients c ON c.id = k.client_id
             LEFT JOIN knowledge_items rb ON rb.id = k.replaced_by_id"""
    ):
        tags = ", ".join(r["tags"] or [])
        content = (
            f"Item do catálogo de conhecimento ({r['type']}): {r['name']}. {_clean(r['description'])} "
            f"Tags: {tags or 'nenhuma'}. Time responsável: {_clean(r['owner_team']) or 'sem time definido'}. "
            f"Status: {r['status']}. Cliente: {r['client_name'] or 'compartilhado entre clientes'}."
        )
        if r["depends_on"]:
            content += f" Depende de: {r['depends_on']}."
        if r["dependents"]:
            content += f" Usado por (dependentes): {r['dependents']}."
        if r["status"] == "deprecado":
            content += f" Item descontinuado. {_clean(r['deprecation_note'])}"
            if r["replaced_by_name"]:
                content += f" Substituído por: {r['replaced_by_name']}."
        chunks.append(_chunk("catalogo", r["id"], r["name"], f"/catalogo?item={r['id']}", content))

    open_artifacts: Dict[str, List[str]] = {}
    for a in db.fetch_all(
        """SELECT ph.project_id, a.name, a.status, to_char(a.due_date, 'DD/MM/YYYY') AS due,
                  (a.due_date < CURRENT_DATE) AS overdue
             FROM activation_artifacts a JOIN activation_phases ph ON ph.id = a.phase_id
            WHERE a.status <> 'concluido'
            ORDER BY a.due_date ASC NULLS LAST, a.created_at"""
    ):
        label = a["name"] + (f" (prazo {a['due']}{', vencido' if a['overdue'] else ''})" if a["due"] else "")
        open_artifacts.setdefault(a["project_id"], []).append(label)

    for r in db.fetch_all(
        """SELECT p.id, p.name, p.status, p.owner_name, c.name AS client_name,
                  to_char(p.target_date, 'DD/MM/YYYY') AS target,
                  (p.status <> 'concluido' AND p.target_date < CURRENT_DATE) AS overdue,
                  (SELECT COUNT(*) FROM activation_artifacts art JOIN activation_phases ph ON ph.id = art.phase_id
                    WHERE ph.project_id = p.id) AS total_artifacts,
                  (SELECT COUNT(*) FROM activation_artifacts art JOIN activation_phases ph ON ph.id = art.phase_id
                    WHERE ph.project_id = p.id AND art.status = 'concluido') AS done_artifacts
             FROM activation_projects p JOIN clients c ON c.id = p.client_id"""
    ):
        total = r["total_artifacts"] or 0
        done = r["done_artifacts"] or 0
        pct = round((done / total) * 100) if total else 0
        content = (
            f"Projeto de ativação '{r['name']}' do cliente {r['client_name']}. "
            f"Status: {r['status']}{' (atrasado: prazo vencido)' if r['overdue'] else ''}. "
            f"Responsável: {_clean(r['owner_name']) or 'não informado'}. "
            f"Prazo: {r['target'] or 'sem prazo definido'}. "
            f"Progresso: {done} de {total} artefatos concluídos ({pct}%)."
        )
        pending = open_artifacts.get(r["id"], [])
        if pending:
            content += f" Artefatos em aberto: {'; '.join(pending[:8])}."
        chunks.append(_chunk("ativacao", r["id"], r["name"], f"/ativacao?projeto={r['id']}", content))

    for r in db.fetch_all(
        """SELECT t.id, t.title, t.body, t.accepted_reply_id, cat.name AS category_name, u.name AS author_name,
                  cl.name AS client_name, ki.name AS knowledge_item_name
             FROM forum_threads t
             JOIN forum_categories cat ON cat.id = t.category_id
             JOIN users u ON u.id = t.author_id
             LEFT JOIN clients cl ON cl.id = t.client_id
             LEFT JOIN knowledge_items ki ON ki.id = t.knowledge_item_id"""
    ):
        content = f"Tópico do fórum (categoria {r['category_name']}) por {r['author_name']}: '{r['title']}'. {_clean(r['body'])}"
        if r["client_name"]:
            content += f" Relacionado ao cliente {r['client_name']}."
        if r["knowledge_item_name"]:
            content += f" Relacionado ao item do catálogo {r['knowledge_item_name']}."
        content += " Tópico com solução aceita." if r["accepted_reply_id"] else ""
        chunks.append(_chunk("forum", r["id"], r["title"], f"/forum/{r['id']}", content))

    for r in db.fetch_all(
        """SELECT rep.id, rep.body, u.name AS author_name, t.id AS thread_id, t.title AS thread_title,
                  (t.accepted_reply_id = rep.id) AS accepted
             FROM forum_replies rep
             JOIN users u ON u.id = rep.author_id
             JOIN forum_threads t ON t.id = rep.thread_id"""
    ):
        content = f"Resposta de {r['author_name']} no tópico do fórum '{r['thread_title']}': {_clean(r['body'])}"
        if r["accepted"]:
            content += " (resposta marcada como solução do tópico)"
        chunks.append(_chunk("forum", r["id"], f"Resposta em: {r['thread_title']}", f"/forum/{r['thread_id']}", content))

    for r in db.fetch_all(
        """SELECT d.id, d.title, d.source, d.category, c.id AS client_id, c.name AS client_name
             FROM client_documents d JOIN clients c ON c.id = d.client_id"""
    ):
        content = (
            f"Documento '{r['title']}' do cliente {r['client_name']}. "
            f"Fonte: {r['source']}. Categoria: {_clean(r['category']) or 'não informada'}."
        )
        chunks.append(_chunk("documento", r["id"], r["title"], f"/clientes/{r['client_id']}", content))

    for r in db.fetch_all(
        """SELECT a.id, a.severity, a.message, a.source, c.id AS client_id, c.name AS client_name
             FROM client_alerts a JOIN clients c ON c.id = a.client_id
            WHERE a.resolved = false"""
    ):
        content = (
            f"Alerta de severidade {r['severity']} aberto para o cliente {r['client_name']}: "
            f"{r['message']} (origem: {r['source'] or 'manual'})."
        )
        chunks.append(_chunk("alerta", r["id"], f"Alerta: {r['client_name']}", f"/clientes/{r['client_id']}", content))

    for r in db.fetch_all(
        """SELECT m.id, m.metric_key, m.value, m.unit, m.period, c.id AS client_id, c.name AS client_name
             FROM client_metrics m JOIN clients c ON c.id = m.client_id"""
    ):
        content = (
            f"Métrica do cliente {r['client_name']} no período {r['period']}: "
            f"{r['metric_key']} = {r['value']} {r['unit'] or ''}."
        )
        chunks.append(
            _chunk("metrica", r["id"], f"Métricas de {r['client_name']} ({r['period']})", f"/clientes/{r['client_id']}", content)
        )

    for r in db.fetch_all(
        """SELECT t.id, t.name, t.status, t.list_name, t.assignee, to_char(t.due_date, 'DD/MM/YYYY') AS due,
                  (t.due_date < now()) AS past_due, c.id AS client_id, c.name AS client_name
             FROM clickup_task_cache t JOIN clients c ON c.id = t.client_id"""
    ):
        content = (
            f"Task do ClickUp do cliente {r['client_name']}: '{r['name']}'. Status: {r['status']}. "
            f"Lista: {_clean(r['list_name']) or 'não informada'}. Responsável: {_clean(r['assignee']) or 'não atribuído'}."
        )
        if r["due"]:
            content += f" Prazo: {r['due']}{' (prazo já passou)' if r['past_due'] else ''}."
        chunks.append(_chunk("tarefa", r["id"], r["name"], f"/clientes/{r['client_id']}", content))

    return chunks


# ---------------------------------------------------------------------------
# 2. Modelo de embeddings (TF-IDF + SVD), guardado no banco
# ---------------------------------------------------------------------------
def _vectorizer(max_df: float) -> TfidfVectorizer:
    return TfidfVectorizer(
        max_features=6000,
        ngram_range=(1, 2),
        sublinear_tf=True,
        lowercase=False,  # o tokenizador já normaliza
        tokenizer=tokenize,
        token_pattern=None,
        min_df=1,
        max_df=max_df,
    )


def _fit(texts: List[str]) -> Tuple[Dict[str, Any], np.ndarray]:
    # Termos presentes em mais de 60% dos chunks ("cliente", "status") não distinguem um
    # chunk do outro e só adicionam ruído ao vetor. Com poucos chunks o corte não se aplica
    # (removeria o vocabulário quase todo).
    vectorizer = _vectorizer(max_df=0.6 if len(texts) >= 20 else 1.0)
    try:
        tfidf = vectorizer.fit_transform(texts)
    except ValueError:
        vectorizer = _vectorizer(max_df=1.0)
        tfidf = vectorizer.fit_transform(texts)
    # TruncatedSVD exige n_components < min(n_amostras, n_termos).
    actual_dim = max(1, min(EMBED_DIM, tfidf.shape[0] - 1, tfidf.shape[1] - 1))
    svd = TruncatedSVD(n_components=actual_dim, random_state=42)
    reduced = svd.fit_transform(tfidf)
    bundle = {"vectorizer": vectorizer, "svd": svd, "actual_dim": actual_dim}
    return bundle, _pad(reduced, actual_dim)


def _pad(matrix: np.ndarray, actual_dim: int) -> np.ndarray:
    # A coluna do banco tem dimensão fixa; com poucos chunks o SVD gera menos componentes.
    if actual_dim >= EMBED_DIM:
        return matrix
    return np.hstack([matrix, np.zeros((matrix.shape[0], EMBED_DIM - actual_dim))])


def _transform(bundle: Dict[str, Any], texts: List[str]) -> np.ndarray:
    tfidf = bundle["vectorizer"].transform(texts)
    return _pad(bundle["svd"].transform(tfidf), bundle["actual_dim"])


def _vector_literal(vec: np.ndarray) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec.tolist()) + "]"


def _serialize(bundle: Dict[str, Any]) -> bytes:
    buffer = io.BytesIO()
    joblib.dump(bundle, buffer, compress=3)
    return buffer.getvalue()


def _load_model() -> Optional[Dict[str, Any]]:
    """Carrega o modelo ajustado do banco, com cache em memória invalidado quando outra
    réplica (ou um reajuste) grava um modelo mais novo."""
    rows = db.fetch_all("SELECT fitted_at FROM rag_index_state WHERE id = 1 AND model IS NOT NULL")
    if not rows:
        _model_cache.update(fitted_at=None, bundle=None)
        return None
    fitted_at = rows[0]["fitted_at"]
    if _model_cache["bundle"] is None or _model_cache["fitted_at"] != fitted_at:
        blob = db.fetch_all("SELECT model FROM rag_index_state WHERE id = 1")[0]["model"]
        # O conteúdo vem de uma tabela que só este serviço escreve — não de entrada de usuário.
        _model_cache.update(fitted_at=fitted_at, bundle=joblib.load(io.BytesIO(bytes(blob))))
    return _model_cache["bundle"]


# ---------------------------------------------------------------------------
# 3. Sincronização do índice (incremental por padrão)
# ---------------------------------------------------------------------------
def sync_index(full: bool = False) -> Dict[str, Any]:
    """Deixa `rag_chunks` igual ao conteúdo atual da plataforma.

    Reprocessa só os chunks novos/alterados e remove os que deixaram de existir. O modelo é
    reajustado do zero quando `full=True`, quando ainda não existe, ou quando a quantidade
    de mudanças acumuladas desde o último ajuste passa de `RAG_REFIT_THRESHOLD` do índice.
    """
    with _sync_lock:
        chunks = collect_chunks()
        by_type: Dict[str, int] = {}
        for c in chunks:
            by_type[c["source_type"]] = by_type.get(c["source_type"], 0) + 1

        existing = {
            (r["source_type"], r["source_id"]): r["content_hash"]
            for r in db.fetch_all("SELECT source_type, source_id, content_hash FROM rag_chunks")
        }
        current_keys = {(c["source_type"], c["source_id"]) for c in chunks}
        changed = [c for c in chunks if existing.get((c["source_type"], c["source_id"])) != c["content_hash"]]
        removed = [key for key in existing if key not in current_keys]

        state = db.fetch_all("SELECT changes_since_fit, effective_dims FROM rag_index_state WHERE id = 1")
        changes_since_fit = state[0]["changes_since_fit"] if state else 0
        bundle = _load_model()

        result: Dict[str, Any] = {
            "chunks_indexed": len(chunks),
            "dims": EMBED_DIM,
            "by_type": by_type,
            "updated": len(changed),
            "removed": len(removed),
        }

        if not chunks:
            with db.connection() as conn, conn.cursor() as cur:
                cur.execute("DELETE FROM rag_chunks")
                cur.execute("DELETE FROM rag_index_state")
            _model_cache.update(fitted_at=None, bundle=None)
            return {**result, "mode": "vazio", "effective_dims": 0}

        pending = len(changed) + len(removed)
        drift = (changes_since_fit + pending) / len(chunks)
        needs_refit = full or bundle is None or not existing or drift > settings.refit_threshold

        if not needs_refit and pending == 0:
            return {**result, "mode": "sem_mudancas", "effective_dims": bundle["actual_dim"]}

        if needs_refit:
            bundle, vectors = _fit([c["content"] for c in chunks])
            rows = [
                (c["source_type"], c["source_id"], c["title"], c["path"], c["content"], c["content_hash"], _vector_literal(v))
                for c, v in zip(chunks, vectors)
            ]
            with db.connection() as conn, conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(%s)", [SYNC_LOCK_KEY])
                # DELETE (e não TRUNCATE) dentro da transação: quem está buscando continua
                # enxergando o índice antigo até o COMMIT, sem janela de índice vazio.
                cur.execute("DELETE FROM rag_chunks")
                psycopg2.extras.execute_values(
                    cur,
                    """INSERT INTO rag_chunks (source_type, source_id, title, path, content, content_hash, embedding)
                       VALUES %s""",
                    rows,
                    template="(%s,%s,%s,%s,%s,%s,%s::vector)",
                    page_size=200,
                )
                cur.execute(
                    """INSERT INTO rag_index_state (id, model, effective_dims, n_chunks, changes_since_fit, fitted_at, updated_at)
                       VALUES (1, %s, %s, %s, 0, now(), now())
                       ON CONFLICT (id) DO UPDATE SET model = EXCLUDED.model, effective_dims = EXCLUDED.effective_dims,
                         n_chunks = EXCLUDED.n_chunks, changes_since_fit = 0, fitted_at = now(), updated_at = now()""",
                    [psycopg2.Binary(_serialize(bundle)), bundle["actual_dim"], len(chunks)],
                )
            _model_cache.update(fitted_at=None, bundle=None)  # força recarregar com o novo fitted_at
            logger.info("Índice de RAG reajustado do zero", extra={"chunks": len(chunks), "dims": bundle["actual_dim"]})
            return {**result, "mode": "completo", "updated": len(chunks), "effective_dims": bundle["actual_dim"]}

        # Incremental: projeta só os chunks alterados no espaço do modelo já ajustado.
        vectors = _transform(bundle, [c["content"] for c in changed]) if changed else []
        rows = [
            (c["source_type"], c["source_id"], c["title"], c["path"], c["content"], c["content_hash"], _vector_literal(v))
            for c, v in zip(changed, vectors)
        ]
        with db.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", [SYNC_LOCK_KEY])
            if rows:
                psycopg2.extras.execute_values(
                    cur,
                    """INSERT INTO rag_chunks (source_type, source_id, title, path, content, content_hash, embedding)
                       VALUES %s
                       ON CONFLICT (source_type, source_id) DO UPDATE SET
                         title = EXCLUDED.title, path = EXCLUDED.path, content = EXCLUDED.content,
                         content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding, updated_at = now()""",
                    rows,
                    template="(%s,%s,%s,%s,%s,%s,%s::vector)",
                    page_size=200,
                )
            for source_type, source_id in removed:
                cur.execute("DELETE FROM rag_chunks WHERE source_type = %s AND source_id = %s", [source_type, source_id])
            cur.execute(
                """UPDATE rag_index_state SET n_chunks = %s, changes_since_fit = changes_since_fit + %s, updated_at = now()
                    WHERE id = 1""",
                [len(chunks), pending],
            )
        logger.info("Índice de RAG atualizado de forma incremental", extra={"updated": len(changed), "removed": len(removed)})
        return {**result, "mode": "incremental", "effective_dims": bundle["actual_dim"]}


def build_index() -> Dict[str, Any]:
    """Reconstrói o índice inteiro (reajusta o modelo). Equivale a `sync_index(full=True)`."""
    return sync_index(full=True)


def ensure_index() -> None:
    """Garante que existe um índice utilizável (ex.: primeiro start do serviço, ou depois
    de uma migração que esvaziou a tabela). Não derruba o serviço se falhar."""
    try:
        rows = db.fetch_all(
            """SELECT (SELECT COUNT(*) FROM rag_chunks) AS chunks,
                      EXISTS (SELECT 1 FROM rag_index_state WHERE id = 1 AND model IS NOT NULL) AS has_model"""
        )
        if rows[0]["chunks"] == 0 or not rows[0]["has_model"]:
            sync_index(full=True)
    except Exception:  # noqa: BLE001
        logger.exception("ensure_index falhou (o serviço continua no ar)")


def index_status() -> Dict[str, Any]:
    rows = db.fetch_all(
        """SELECT (SELECT COUNT(*) FROM rag_chunks) AS chunks, s.fitted_at, s.updated_at, s.effective_dims,
                  s.changes_since_fit
             FROM (SELECT 1) one LEFT JOIN rag_index_state s ON s.id = 1"""
    )
    return rows[0]


# ---------------------------------------------------------------------------
# 4. Busca híbrida (vetor + palavra-chave) com Reciprocal Rank Fusion
# ---------------------------------------------------------------------------
TERM_STATS_SQL = """
WITH lex AS (
    SELECT unnest(tsvector_to_array(to_tsvector('portuguese', immutable_unaccent(%(question)s)))) AS lexeme
)
SELECT lexeme,
       (SELECT COUNT(*) FROM rag_chunks c WHERE c.tsv @@ to_tsquery('simple', quote_literal(lexeme))) AS df,
       (SELECT COUNT(*) FROM rag_chunks) AS total
  FROM lex
"""

HYBRID_SQL = """
WITH vector_hits AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> %(vec)s::vector) AS rank
      FROM rag_chunks
     WHERE %(use_vector)s
       AND (%(all_types)s OR source_type = ANY(%(types)s))
       AND 1 - (embedding <=> %(vec)s::vector) >= %(min_similarity)s
     ORDER BY embedding <=> %(vec)s::vector
     LIMIT %(candidates)s
),
keyword_hits AS (
    -- Soma do IDF dos termos da pergunta presentes no chunk (termos ligados por OU: numa
    -- pergunta em linguagem natural, exigir todos os termos quase nunca casa com nada).
    -- Termo presente no TÍTULO do chunk (peso A do tsvector) vale o dobro.
    SELECT c.id, ROW_NUMBER() OVER (ORDER BY SUM(t.idf * t.weight) DESC, c.id) AS rank
      FROM rag_chunks c
      JOIN LATERAL (
          SELECT u.idf,
                 CASE WHEN c.tsv @@ to_tsquery('simple', quote_literal(u.lexeme) || ':A') THEN 2.0 ELSE 1.0 END AS weight
            FROM unnest(%(lexemes)s::text[], %(idfs)s::float8[]) AS u(lexeme, idf)
           WHERE c.tsv @@ to_tsquery('simple', quote_literal(u.lexeme))
      ) t ON true
     WHERE %(all_types)s OR c.source_type = ANY(%(types)s)
     GROUP BY c.id
     ORDER BY SUM(t.idf * t.weight) DESC, c.id
     LIMIT %(candidates)s
)
SELECT c.source_type, c.source_id, c.title, c.path, c.content,
       CASE WHEN %(use_vector)s THEN 1 - (c.embedding <=> %(vec)s::vector) ELSE 0 END AS score,
       v.rank AS vector_rank, k.rank AS keyword_rank,
       COALESCE(1.0 / (%(rrf_k)s + v.rank), 0) + COALESCE(1.0 / (%(rrf_k)s + k.rank), 0)
         -- Terceiro "voto": a fração dos termos da pergunta que está no título do chunk.
         -- Quem busca um item pelo nome espera ver o próprio item antes de quem só o cita.
         + (SELECT COUNT(*) FROM unnest(%(lexemes)s::text[]) AS l(lexeme)
             WHERE c.tsv @@ to_tsquery('simple', quote_literal(l.lexeme) || ':A'))::float8
           / GREATEST(cardinality(%(lexemes)s::text[]), 1) / (%(rrf_k)s + 1) AS rrf_score
  FROM rag_chunks c
  LEFT JOIN vector_hits v ON v.id = c.id
  LEFT JOIN keyword_hits k ON k.id = c.id
 WHERE v.id IS NOT NULL OR k.id IS NOT NULL
 ORDER BY rrf_score DESC, score DESC
 LIMIT %(limit)s
"""


def _discriminative_terms(question: str) -> Tuple[List[str], List[float]]:
    """Lexemas da pergunta que valem a pena buscar por palavra-chave, com o peso (IDF) de
    cada um. Ficam de fora os que não existem no índice e os que aparecem em quase tudo."""
    lexemes: List[str] = []
    idfs: List[float] = []
    for row in db.fetch_all(TERM_STATS_SQL, {"question": question}):
        df, total = row["df"], row["total"]
        if df == 0 or total == 0 or df / total > MAX_TERM_DOCUMENT_RATIO:
            continue
        lexemes.append(row["lexeme"])
        idfs.append(float(np.log(1 + total / df)))
    return lexemes, idfs


def search(query: str, source_types: Optional[List[str]] = None, k: int = 10) -> List[Dict[str, Any]]:
    """Retorna os `k` chunks mais relevantes para `query`, combinando similaridade vetorial e
    busca por palavra-chave. Cada resultado traz:

      - `score`: similaridade de cosseno (0 a 1) entre a pergunta e o chunk;
      - `match`: por qual caminho foi encontrado — "ambos", "semantica" ou "palavra-chave";
      - `rrf_score`: a pontuação fundida usada para ordenar.
    """
    bundle = _load_model()
    if bundle is None:
        ensure_index()
        bundle = _load_model()
        if bundle is None:
            return []

    vec = _transform(bundle, [query])[0]
    lexemes, idfs = _discriminative_terms(query)
    params = {
        "vec": _vector_literal(vec),
        # Pergunta sem nenhum termo do vocabulário vira vetor nulo: a distância de cosseno
        # fica indefinida, então o lado vetorial é desligado e sobra a palavra-chave.
        "use_vector": bool(np.linalg.norm(vec) > 1e-9),
        "min_similarity": MIN_VECTOR_SIMILARITY,
        "lexemes": lexemes,
        "idfs": idfs,
        "all_types": not source_types,
        "types": source_types or [],
        "candidates": CANDIDATES_PER_SIDE,
        "rrf_k": RRF_K,
        "limit": k,
    }
    with db.connection() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        # Com filtro por tipo, o índice HNSW filtra DEPOIS de achar os vizinhos; ampliar a
        # lista de candidatos evita devolver menos resultados do que o pedido.
        cur.execute("SET LOCAL hnsw.ef_search = 100")
        cur.execute(HYBRID_SQL, params)
        rows = [dict(r) for r in cur.fetchall()]

    results = []
    for row in rows:
        vector_rank, keyword_rank = row.pop("vector_rank"), row.pop("keyword_rank")
        row["score"] = max(0.0, float(row["score"]))
        row["rrf_score"] = float(row["rrf_score"])
        row["match"] = "ambos" if vector_rank and keyword_rank else "semantica" if vector_rank else "palavra-chave"
        results.append(row)
    return results
