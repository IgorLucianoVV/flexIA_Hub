"""Acesso ao Postgres do FlexIA Hub para o serviço de IA.

Leitura das tabelas de negócio (o serviço nunca escreve nelas) e leitura/escrita apenas das
tabelas do próprio índice de RAG (`rag_chunks`, `rag_index_state`).

As conexões vêm de um pool. Antes, cada consulta abria uma conexão nova com o banco — caro
por requisição e, com várias perguntas simultâneas, o suficiente para esgotar o limite de
conexões do Postgres.
"""
import logging
import threading
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional, Sequence

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

from config import settings

logger = logging.getLogger(__name__)

_pool: Optional[ThreadedConnectionPool] = None
_pool_lock = threading.Lock()


def get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ThreadedConnectionPool(
                    settings.db_pool_min,
                    settings.db_pool_max,
                    dsn=settings.database_url,
                    connect_timeout=5,
                    # Nenhuma consulta deste serviço deveria passar disso; melhor cancelar
                    # do que segurar uma conexão do pool indefinidamente.
                    options="-c statement_timeout=30000",
                )
    return _pool


def close_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.closeall()
            _pool = None


@contextmanager
def connection() -> Iterator[Any]:
    """Empresta uma conexão do pool. COMMIT ao sair sem erro, ROLLBACK se houver exceção —
    tudo que roda dentro de um mesmo `with` é uma única transação."""
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        # Conexão quebrada (ex.: banco reiniciou) é descartada em vez de voltar para o pool.
        pool.putconn(conn, close=bool(conn.closed))


def fetch_all(query: str, params: Optional[Sequence[Any]] = None) -> List[Dict[str, Any]]:
    with connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params or [])
            return [dict(row) for row in cur.fetchall()]


def ping() -> Dict[str, Any]:
    """Confere se o banco responde — usado pelo health check."""
    try:
        fetch_all("SELECT 1 AS ok")
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001 — o health check precisa reportar qualquer falha
        return {"ok": False, "error": str(exc)}


def strategic_signals(limit: int = 5) -> Dict[str, List[Dict[str, Any]]]:
    """Sinais estratégicos independentes da pergunta: clientes em risco e alertas abertos.
    Ficam de fora do índice de RAG de propósito — são fatos estruturados exatos (não texto
    livre), então uma consulta SQL direta é mais confiável do que uma busca por similaridade."""
    at_risk = fetch_all(
        """SELECT c.id, c.name, c.health_score,
                (SELECT COUNT(*) FROM client_alerts a WHERE a.client_id = c.id AND a.resolved = false) AS open_alerts
            FROM clients c
            WHERE c.health_score < 75 OR EXISTS (
                SELECT 1 FROM client_alerts a WHERE a.client_id = c.id AND a.resolved = false
            )
            ORDER BY c.health_score ASC NULLS LAST LIMIT %s""",
        [limit],
    )
    alerts = fetch_all(
        """SELECT a.id, a.severity, a.message, a.source, c.name AS client_name, a.created_at
            FROM client_alerts a JOIN clients c ON c.id = a.client_id
            WHERE a.resolved = false ORDER BY a.created_at DESC LIMIT %s""",
        [limit],
    )
    return {"clients_at_risk": at_risk, "open_alerts": alerts}
