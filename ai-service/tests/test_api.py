import pytest
from fastapi.testclient import TestClient

import graph
import main
from conftest import SERVICE_TOKEN

AUTH = {"X-Service-Token": SERVICE_TOKEN}


@pytest.fixture
def client(seed):
    with TestClient(main.app) as test_client:
        yield test_client


def test_health_reporta_banco_e_indice(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["checks"]["database"]["ok"] is True
    assert body["configured"] is False  # sem ANTHROPIC_API_KEY nos testes


def test_ask_e_reindex_exigem_o_token_de_servico(client):
    assert client.post("/ask", json={"question": "oi"}).status_code == 401
    assert client.post("/ask", json={"question": "oi"}, headers={"X-Service-Token": "errado"}).status_code == 401
    assert client.post("/reindex").status_code == 401


def test_reindex_devolve_o_resumo_da_sincronizacao(client):
    res = client.post("/reindex", params={"full": True}, headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "completo"
    assert body["by_type"]["cliente"] == 2


def test_ask_sem_chave_da_anthropic_devolve_os_trechos_recuperados(client):
    client.post("/reindex", params={"full": True}, headers=AUTH)
    res = client.post("/ask", json={"question": "o que temos sobre integração pix?"}, headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["ai_configured"] is False
    assert "Integração PIX Libercard" in body["answer"]
    assert any(c["label"] == "Integração PIX Libercard" for c in body["citations"])
    # sinais estratégicos (cliente em risco) entram mesmo sem terem sido "buscados"
    assert any(c["label"] == "CREA" for c in body["citations"])


def test_ask_valida_a_entrada(client):
    assert client.post("/ask", json={"question": ""}, headers=AUTH).status_code == 422
    assert client.post("/ask", json={}, headers=AUTH).status_code == 422


def test_pergunta_de_continuacao_carrega_o_assunto_anterior():
    history = [{"question": "Como está o projeto de ativação do CREA?", "answer": "Está atrasado."}]
    assert graph.build_search_query("e o prazo dele?", history) == "Como está o projeto de ativação do CREA? e o prazo dele?"
    # pergunta longa e completa não é misturada com a anterior
    long_question = "Quais itens do catálogo dependem do conector Watson Assistant hoje?"
    assert graph.build_search_query(long_question, history) == long_question
    assert graph.build_search_query("e o prazo dele?", []) == "e o prazo dele?"
