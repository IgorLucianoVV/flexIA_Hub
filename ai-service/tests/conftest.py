"""Infraestrutura dos testes do ai-service.

Os testes rodam contra um Postgres de verdade, num banco próprio (`flexia_hub_ai_test`),
recriado do zero a cada execução e montado com as MESMAS migrações do backend
(`backend/migrations/*.sql`) — assim o schema testado é o schema real, não uma cópia.
"""
import glob
import os
import sys
from urllib.parse import urlsplit

import psycopg2
import pytest

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/flexia_hub_ai_test"
)
SERVICE_TOKEN = "token-de-teste"

# Precisa acontecer ANTES de importar qualquer módulo do serviço: `config` lê o ambiente
# uma única vez, no import.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SERVICE_TOKEN"] = SERVICE_TOKEN
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["APP_ENV"] = "test"
os.environ["LOG_LEVEL"] = "WARNING"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "migrations")


def _recreate_database() -> None:
    db_name = urlsplit(TEST_DATABASE_URL).path.lstrip("/")
    # Trava de segurança: este código APAGA o banco. Só aceita um banco com "test" no nome.
    if "test" not in db_name:
        raise RuntimeError(f'O banco de testes precisa ter "test" no nome (recebido: {db_name}).')

    admin_url = TEST_DATABASE_URL.rsplit("/", 1)[0] + "/postgres"
    admin = psycopg2.connect(admin_url)
    admin.autocommit = True
    with admin.cursor() as cur:
        cur.execute(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)')
        cur.execute(f'CREATE DATABASE "{db_name}"')
    admin.close()

    conn = psycopg2.connect(TEST_DATABASE_URL)
    with conn, conn.cursor() as cur:
        for path in sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql"))):
            with open(path, encoding="utf-8") as handle:
                cur.execute(handle.read())
    conn.close()


@pytest.fixture(scope="session", autouse=True)
def database():
    _recreate_database()
    yield
    import db

    db.close_pool()


@pytest.fixture(autouse=True)
def clean_tables(database):
    """Cada teste começa com as tabelas de negócio e o índice vazios."""
    import db
    import rag

    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """TRUNCATE TABLE rag_chunks, rag_index_state, forum_replies, forum_threads, forum_categories,
                   client_metrics, client_alerts, client_documents, clickup_task_cache,
                   activation_artifacts, activation_phases, activation_projects,
                   knowledge_attachments, knowledge_relations, knowledge_items, clients, users
               RESTART IDENTITY CASCADE"""
        )
    rag._model_cache.update(fitted_at=None, bundle=None)
    yield


@pytest.fixture
def seed():
    """Popula um conjunto pequeno e conhecido de dados e devolve os ids criados."""
    import db

    ids = {}
    with db.connection() as conn, conn.cursor() as cur:
        def insert(sql, params):
            cur.execute(sql + " RETURNING id", params)
            return cur.fetchone()[0]

        ids["libercard"] = insert(
            "INSERT INTO clients (name, segment, csm_owner, health_score) VALUES (%s,%s,%s,%s)",
            ["Libercard", "Meios de pagamento", "Ana Ribeiro", 92],
        )
        ids["crea"] = insert(
            "INSERT INTO clients (name, segment, csm_owner, health_score) VALUES (%s,%s,%s,%s)",
            ["CREA", "Órgão de classe", "Bruno Castro", 45],
        )
        ids["pix"] = insert(
            "INSERT INTO knowledge_items (type, name, description, owner_team, tags, client_id) VALUES (%s,%s,%s,%s,%s,%s)",
            ["integracao", "Integração PIX Libercard", "Confirmação de cobrança PIX com o backend.", "Squad FlexIA", ["pix"], ids["libercard"]],
        )
        ids["bot"] = insert(
            "INSERT INTO knowledge_items (type, name, description, owner_team, tags) VALUES (%s,%s,%s,%s,%s)",
            ["chatbot", "Bot de Suporte Técnico", "Triagem de chamados de suporte.", "Squad FlexIA", ["suporte"]],
        )
        cur.execute("INSERT INTO knowledge_relations (from_id, to_id) VALUES (%s,%s)", [ids["bot"], ids["pix"]])
        ids["project"] = insert(
            "INSERT INTO activation_projects (name, client_id, status, target_date) VALUES (%s,%s,%s, CURRENT_DATE - 10)",
            ["Ativação — Bot de Suporte", ids["crea"], "em_andamento"],
        )
        ids["user"] = insert(
            "INSERT INTO users (name, email, password_hash, role) VALUES (%s,%s,%s,%s)",
            ["Pessoa de Teste", "teste@test.local", "x", "dev"],
        )
        ids["category"] = insert("INSERT INTO forum_categories (slug, name) VALUES (%s,%s)", ["geral", "Geral"])
        ids["thread"] = insert(
            "INSERT INTO forum_threads (title, body, category_id, author_id, client_id) VALUES (%s,%s,%s,%s,%s)",
            ["Homologação travada", "A homologação com o cliente está parada aguardando credenciais.", ids["category"], ids["user"], ids["crea"]],
        )
        ids["alert"] = insert(
            "INSERT INTO client_alerts (client_id, severity, message, source) VALUES (%s,%s,%s,%s)",
            [ids["crea"], "alta", "Projeto de ativação atrasado", "manual"],
        )
        ids["task"] = insert(
            "INSERT INTO clickup_task_cache (clickup_task_id, name, status, client_id) VALUES (%s,%s,%s,%s)",
            ["t1", "Revisar integração com sistema de chamados", "aberto", ids["crea"]],
        )
    return ids
