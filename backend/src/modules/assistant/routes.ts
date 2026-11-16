import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { HttpError, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { param, parse, text } from "../../lib/validate";
import { AuthedRequest, requireAuth } from "../auth/middleware";
import { aiClient, isAiServiceUnreachable } from "./aiClient";

export const assistantRouter = Router();
// Autenticado porque o RAG por trás lê dados de cliente (documentos, alertas, métricas).
assistantRouter.use(requireAuth);

const HISTORY_TURNS_SENT_TO_AI = 3;

const askSchema = z.object({ question: text(1000, "question") });
const feedbackSchema = z.object({
  value: z.union([z.literal(1), z.literal(-1), z.null()], { error: "value deve ser 1, -1 ou null" }),
  comment: z.union([z.string().trim().max(500), z.null()]).optional(),
});

/** Traduz falhas do ai-service em respostas HTTP coerentes para o frontend. */
function aiServiceError(err: any, fallbackMessage: string): HttpError {
  if (isAiServiceUnreachable(err)) {
    return new HttpError(
      503,
      "Serviço de IA indisponível. Verifique se o ai-service está rodando (ver ai-service/README.md)."
    );
  }
  if (err.code === "ECONNABORTED") return new HttpError(504, "O serviço de IA demorou demais para responder.");
  if (err.response) {
    const message = err.response.data?.error ?? err.response.data?.detail ?? fallbackMessage;
    return new HttpError(err.response.status >= 500 ? 502 : err.response.status, String(message));
  }
  logger.error({ err }, fallbackMessage);
  return new HttpError(500, fallbackMessage);
}

// POST /api/assistant/ask { question }
// Encaminha pro serviço Python (FastAPI + LangGraph), que recupera os trechos relevantes
// por busca híbrida (RAG) e sintetiza a resposta. Cada pergunta respondida é gravada em
// `assistant_interactions`: dá histórico por usuário, permite feedback e mostra ao admin o
// que o time anda perguntando.
assistantRouter.post("/ask", async (req: AuthedRequest, res) => {
  const { question } = parse(askSchema, req.body);
  const userId = req.user!.id;

  // Últimas trocas do próprio usuário, para o assistente entender perguntas de continuação
  // ("e o prazo dele?") em vez de tratar cada pergunta como se fosse a primeira.
  const previous = await pool.query(
    `SELECT question, answer FROM assistant_interactions WHERE user_id = $1
      ORDER BY created_at DESC LIMIT $2`,
    [userId, HISTORY_TURNS_SENT_TO_AI]
  );
  const history = previous.rows.reverse().map((r) => ({ question: r.question, answer: String(r.answer).slice(0, 1500) }));

  const started = Date.now();
  let data: any;
  try {
    ({ data } = await aiClient.post("/ask", { question, history }, { timeout: 60_000 }));
  } catch (err) {
    throw aiServiceError(err, "Erro ao consultar o assistente de IA");
  }
  if (data?.error) throw new HttpError(400, String(data.error));

  const { rows } = await pool.query(
    `INSERT INTO assistant_interactions (user_id, question, answer, citations, sources_used, ai_configured, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
    [
      userId,
      question,
      data.answer ?? "",
      JSON.stringify(data.citations ?? []),
      data.sources_used ?? [],
      Boolean(data.ai_configured),
      Date.now() - started,
    ]
  );

  res.json({ ...data, interactionId: rows[0].id, created_at: rows[0].created_at });
});

// GET /api/assistant/history?limit= — últimas perguntas do usuário logado (mais antigas primeiro)
assistantRouter.get("/history", async (req: AuthedRequest, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const { rows } = await pool.query(
    `SELECT id, question, answer, citations, sources_used, ai_configured, feedback, created_at
       FROM assistant_interactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [req.user!.id, limit]
  );
  res.json(rows.reverse());
});

// DELETE /api/assistant/history — apaga o histórico do próprio usuário
assistantRouter.delete("/history", async (req: AuthedRequest, res) => {
  await pool.query(`DELETE FROM assistant_interactions WHERE user_id = $1`, [req.user!.id]);
  res.status(204).send();
});

// POST /api/assistant/interactions/:id/feedback { value: 1 | -1 | null, comment? }
assistantRouter.post("/interactions/:id/feedback", async (req: AuthedRequest, res) => {
  const body = parse(feedbackSchema, req.body);
  // Filtra por user_id: cada pessoa só avalia as próprias respostas.
  const { rows } = await pool.query(
    `UPDATE assistant_interactions SET feedback = $1, feedback_comment = $2
      WHERE id = $3 AND user_id = $4 RETURNING id, feedback, feedback_comment`,
    [body.value, body.comment || null, param(req.params.id), req.user!.id]
  );
  if (!rows[0]) throw notFound("Interação não encontrada");
  res.json(rows[0]);
});

// GET /api/assistant/status - útil pro frontend saber se deve mostrar o painel como ativo
assistantRouter.get("/status", async (_req, res) => {
  try {
    const { data } = await aiClient.get("/health", { timeout: 5_000 });
    res.json(data);
  } catch {
    res.json({ ok: false, configured: false });
  }
});

// POST /api/assistant/reindex?full=1 - atualiza o índice de RAG. Normalmente não é preciso
// chamar: o backend agenda a reindexação sozinho quando o conteúdo muda. O botão continua
// existindo para forçar (ex.: depois de alterar dados direto no banco). Baixo risco (só
// leitura + atualização de um índice de busca), então qualquer usuário logado pode disparar.
assistantRouter.post("/reindex", async (req, res) => {
  try {
    const full = req.query.full === "1" || req.query.full === "true";
    const { data } = await aiClient.post("/reindex", {}, { timeout: 120_000, params: full ? { full: true } : {} });
    res.json(data);
  } catch (err) {
    throw aiServiceError(err, "Erro ao atualizar o índice de RAG");
  }
});
