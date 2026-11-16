import dataclasses

import db
import rag


def test_tokenize_normaliza_acento_plural_e_palavras_vazias():
    assert rag.tokenize("Quais clientes estão em risco?") == ["cliente", "risco"]
    assert rag.tokenize("Integrações e ATIVAÇÕES atrasadas") == ["integracao", "ativacao", "atrasada"]
    # singular já no singular e palavras curtas não são mutiladas
    assert rag.tokenize("o pix do CREA") == ["pix", "crea"]


def test_collect_chunks_cobre_todas_as_fontes(seed):
    chunks = rag.collect_chunks()
    by_type = {}
    for chunk in chunks:
        by_type.setdefault(chunk["source_type"], []).append(chunk)

    assert set(by_type) == {"cliente", "catalogo", "ativacao", "forum", "alerta", "tarefa"}
    crea = next(c for c in by_type["cliente"] if c["title"] == "CREA")
    assert "cliente em risco" in crea["content"]
    bot = next(c for c in by_type["catalogo"] if c["title"] == "Bot de Suporte Técnico")
    assert "Depende de: Integração PIX Libercard" in bot["content"]
    project = by_type["ativacao"][0]
    assert "atrasado" in project["content"]
    # o hash muda quando (e só quando) o conteúdo muda
    assert all(len(c["content_hash"]) == 64 for c in chunks)


def test_sync_e_completo_na_primeira_vez_e_nao_faz_nada_sem_mudancas(seed):
    first = rag.sync_index()
    assert first["mode"] == "completo"
    assert first["chunks_indexed"] == len(rag.collect_chunks())

    second = rag.sync_index()
    assert second["mode"] == "sem_mudancas"
    assert second["updated"] == 0 and second["removed"] == 0


def test_sync_incremental_so_reprocessa_o_que_mudou(seed, monkeypatch):
    rag.sync_index()
    fitted_before = rag.index_status()["fitted_at"]
    # limite alto para o teste exercitar o caminho incremental mesmo com poucos chunks
    monkeypatch.setattr(rag, "settings", dataclasses.replace(rag.settings, refit_threshold=0.9))

    with db.connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE knowledge_items SET description = 'Triagem e abertura de chamados.' WHERE id = %s", [seed["bot"]])
        cur.execute("DELETE FROM clickup_task_cache WHERE id = %s", [seed["task"]])

    result = rag.sync_index()
    assert result["mode"] == "incremental"
    assert result["updated"] == 1
    assert result["removed"] == 1
    # o modelo não foi reajustado: mesmo carimbo de ajuste
    assert rag.index_status()["fitted_at"] == fitted_before

    rows = db.fetch_all("SELECT content FROM rag_chunks WHERE source_id = %s", [seed["bot"]])
    assert "abertura de chamados" in rows[0]["content"]
    assert db.fetch_all("SELECT 1 FROM rag_chunks WHERE source_id = %s", [seed["task"]]) == []


def test_sync_reajusta_o_modelo_quando_muda_demais(seed):
    rag.sync_index()
    fitted_before = rag.index_status()["fitted_at"]
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE clients SET segment = segment || ' (revisado)'")
        cur.execute("UPDATE knowledge_items SET description = description || ' Revisado.'")
        cur.execute("UPDATE forum_threads SET body = body || ' Atualização.'")

    result = rag.sync_index()
    assert result["mode"] == "completo"
    assert rag.index_status()["fitted_at"] > fitted_before


def test_sync_full_forca_reajuste(seed):
    rag.sync_index()
    assert rag.sync_index(full=True)["mode"] == "completo"


def test_sync_com_base_vazia_limpa_o_indice():
    result = rag.sync_index()
    assert result["mode"] == "vazio"
    assert rag.search("qualquer coisa") == []


def test_busca_encontra_por_palavra_chave_e_por_semantica(seed):
    rag.sync_index()
    results = rag.search("integração pix")
    assert results, "a busca deveria devolver resultados"
    top = results[0]
    assert top["title"] == "Integração PIX Libercard"
    assert top["match"] in {"ambos", "palavra-chave"}
    assert 0 <= top["score"] <= 1
    assert top["rrf_score"] > 0


def test_busca_ignora_acentos_e_plural(seed):
    rag.sync_index()
    titles = [r["title"] for r in rag.search("homologacoes travadas")]
    assert "Homologação travada" in titles


def test_busca_respeita_filtro_de_tipo(seed):
    rag.sync_index()
    results = rag.search("CREA", source_types=["forum"])
    assert results
    assert {r["source_type"] for r in results} == {"forum"}


def test_busca_sem_relacao_com_a_base_nao_devolve_ruido(seed):
    rag.sync_index()
    assert rag.search("xyzzy qwerty plugh") == []


def test_modelo_fica_no_banco_e_sobrevive_a_reinicio(seed):
    rag.sync_index()
    # simula o processo reiniciando: cache em memória vazio, modelo recarregado do banco
    rag._model_cache.update(fitted_at=None, bundle=None)
    assert rag.search("pix")[0]["title"] == "Integração PIX Libercard"
