import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { AssistantCitation } from "../types";
import { AnswerText } from "./AnswerText";
import { IconSpark, IconSync, IconThumbDown, IconThumbUp } from "./icons";

interface Exchange {
  /** Id da interação gravada no servidor (permite avaliar a resposta). */
  id?: string;
  question: string;
  answer?: string;
  citations?: AssistantCitation[];
  feedback?: 1 | -1 | null;
  error?: string;
  loading: boolean;
}

const SUGGESTIONS = [
  "Quais clientes estão em risco agora?",
  "O que temos sobre o Libercard?",
  "Quais projetos de ativação estão atrasados?",
  "O que o time discutiu recentemente no fórum?",
];

const TYPE_LABELS: Record<string, string> = {
  cliente: "Cliente",
  catalogo: "Catálogo",
  anexo: "Documentação",
  ativacao: "Ativação",
  forum: "Fórum",
  documento: "Documento",
  alerta: "Alerta",
  metrica: "Métrica",
  tarefa: "Task",
};

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [serviceUp, setServiceUp] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    api
      .getAssistantStatus()
      .then((s) => {
        setConfigured(s.configured);
        setServiceUp(s.ok);
      })
      .catch(() => setServiceUp(false));

    // A conversa fica guardada no servidor: reabrir o painel (ou trocar de computador)
    // traz as últimas perguntas de volta.
    if (!historyLoaded) {
      api
        .getAssistantHistory()
        .then((history) =>
          setExchanges(
            history.map((h) => ({
              id: h.id,
              question: h.question,
              answer: h.answer,
              citations: h.citations,
              feedback: h.feedback,
              loading: false,
            }))
          )
        )
        .catch(() => undefined)
        .finally(() => setHistoryLoaded(true));
    }
  }, [open, historyLoaded]);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [open, exchanges]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function ask(q: string) {
    const text = q.trim();
    if (!text) return;
    setQuestion("");
    setExchanges((prev) => [...prev, { question: text, loading: true }]);
    const update = (patch: Partial<Exchange>) =>
      setExchanges((prev) => prev.map((ex, i) => (i === prev.length - 1 ? { ...ex, ...patch, loading: false } : ex)));
    try {
      const response = await api.askAssistant(text);
      update({ id: response.interactionId, answer: response.answer, citations: response.citations, feedback: null });
    } catch (err: any) {
      update({ error: err.message });
    }
  }

  async function sendFeedback(index: number, value: 1 | -1) {
    const exchange = exchanges[index];
    if (!exchange.id) return;
    // Clicar de novo na mesma avaliação desfaz.
    const next = exchange.feedback === value ? null : value;
    setExchanges((prev) => prev.map((ex, i) => (i === index ? { ...ex, feedback: next } : ex)));
    try {
      await api.sendAssistantFeedback(exchange.id, next);
    } catch {
      setExchanges((prev) => prev.map((ex, i) => (i === index ? { ...ex, feedback: exchange.feedback } : ex)));
    }
  }

  async function clearHistory() {
    if (!window.confirm("Apagar o histórico desta conversa?")) return;
    await api.clearAssistantHistory().catch(() => undefined);
    setExchanges([]);
  }

  async function reindex() {
    setReindexing(true);
    setNotice(null);
    try {
      const res = await api.reindexAssistant();
      setNotice(
        res.mode === "sem_mudancas"
          ? `Índice já estava em dia (${res.chunks_indexed} trechos).`
          : `Índice atualizado: ${res.updated} trecho(s) reprocessado(s), ${res.removed} removido(s) — ${res.chunks_indexed} no total.`
      );
    } catch (err: any) {
      setNotice(`Falha ao atualizar o índice: ${err.message}`);
    } finally {
      setReindexing(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    ask(question);
  }

  if (!open) return null;

  return (
    <>
      {/* Catcher invisível: fecha o painel ao clicar fora dele, sem escurecer a tela
          (o painel é um widget flutuante no canto, não um modal de tela cheia). */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div
        role="dialog"
        aria-label="Assistente de IA"
        className="fixed top-5 right-5 z-50 w-[26rem] max-w-[calc(100vw-2.5rem)] max-h-[calc(100vh-2.5rem)] bg-white border border-gray-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-semibold text-sm flex items-center gap-1.5">
              <IconSpark className="h-4 w-4 text-indigo-600" /> Assistente de IA
            </h2>
            <p className="text-xs text-gray-400">Busca híbrida (RAG) sobre toda a base do Hub</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={reindex}
              disabled={reindexing}
              title="O índice se atualiza sozinho quando o conteúdo muda; use para forçar uma sincronização agora"
              className="text-xs text-gray-400 hover:text-indigo-600 disabled:opacity-50 px-1.5 py-1 rounded flex items-center gap-1"
            >
              <IconSync className={`h-3.5 w-3.5 ${reindexing ? "animate-spin" : ""}`} />
              {reindexing ? "Sincronizando…" : "Sincronizar índice"}
            </button>
            <button onClick={onClose} aria-label="Fechar" className="text-gray-400 hover:text-gray-700 text-lg leading-none px-1">
              ×
            </button>
          </div>
        </div>

        {notice && (
          <p className="mx-5 mt-3 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">{notice}</p>
        )}
        {!serviceUp && (
          <p className="mx-5 mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            O serviço de IA não está respondendo. O restante do Hub funciona normalmente.
          </p>
        )}
        {serviceUp && configured === false && (
          <p className="mx-5 mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            IA ainda não configurada com uma chave da Anthropic — mostrando os trechos mais relevantes encontrados pelo RAG, sem síntese por IA.
          </p>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {exchanges.length === 0 && historyLoaded && (
            <div>
              <p className="text-xs text-gray-400 mb-2">Sugestões:</p>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="text-left text-sm text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-3 py-2"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {exchanges.map((ex, i) => (
            <div key={ex.id ?? `novo-${i}`} className="space-y-2">
              <p className="text-sm font-medium bg-gray-50 rounded-lg px-3 py-2">{ex.question}</p>
              {ex.loading && <p className="text-xs text-gray-400 px-1">Pensando…</p>}
              {ex.error && <p className="text-xs text-rose-600 px-1">{ex.error}</p>}
              {ex.answer !== undefined && (
                <div className="text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2.5">
                  <AnswerText text={ex.answer} />
                  {ex.citations && ex.citations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-1.5">
                      {ex.citations.map((c) => (
                        <Link
                          key={`${c.type}-${c.id}`}
                          to={c.path}
                          onClick={onClose}
                          className="text-[11px] text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-full px-2 py-0.5"
                        >
                          {TYPE_LABELS[c.type] ?? c.type}: {c.label}
                        </Link>
                      ))}
                    </div>
                  )}
                  {ex.id && (
                    <div className="mt-3 pt-2 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-400">
                      <span>Essa resposta ajudou?</span>
                      <button
                        onClick={() => sendFeedback(i, 1)}
                        aria-pressed={ex.feedback === 1}
                        aria-label="Resposta ajudou"
                        className={`px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${
                          ex.feedback === 1 ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-transparent hover:bg-gray-50"
                        }`}
                      >
                        <IconThumbUp className="h-3.5 w-3.5" /> Sim
                      </button>
                      <button
                        onClick={() => sendFeedback(i, -1)}
                        aria-pressed={ex.feedback === -1}
                        aria-label="Resposta não ajudou"
                        className={`px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${
                          ex.feedback === -1 ? "border-rose-300 bg-rose-50 text-rose-700" : "border-transparent hover:bg-gray-50"
                        }`}
                      >
                        <IconThumbDown className="h-3.5 w-3.5" /> Não
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 border-t border-gray-100 space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={1000}
              placeholder="Pergunte algo sobre clientes, catálogo, ativação…"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={!question.trim()}
              className="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              Enviar
            </button>
          </div>
          {exchanges.length > 0 && (
            <button type="button" onClick={clearHistory} className="text-[11px] text-gray-400 hover:text-rose-600">
              Apagar histórico da conversa
            </button>
          )}
        </form>
      </div>
    </>
  );
}
