import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "./logger";

/** Erro com status HTTP. Lançar um destes em qualquer rota vira a resposta JSON correspondente. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = "Não autenticado") => new HttpError(401, message);
export const forbidden = (message: string) => new HttpError(403, message);
export const notFound = (message: string) => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
};

// Códigos de erro do PostgreSQL que são culpa da requisição, não do servidor.
const PG_CLIENT_ERRORS: Record<string, { status: number; message: string }> = {
  "23503": { status: 400, message: "Referência inválida: um dos registros informados não existe." },
  "23505": { status: 409, message: "Já existe um registro com esses dados." },
  "23514": { status: 400, message: "Valor fora do conjunto permitido para um dos campos." },
  "22P02": { status: 400, message: "Formato inválido em um dos campos." },
  "22007": { status: 400, message: "Data em formato inválido." },
};

/**
 * Tratamento central de erros. O Express 5 encaminha para cá qualquer exceção ou promise
 * rejeitada de uma rota `async`, então as rotas não precisam de try/catch repetido: basta
 * lançar. Erros esperados (4xx) respondem com a mensagem; erros inesperados (5xx) são
 * logados com o id da requisição e respondem com uma mensagem genérica, sem vazar detalhes
 * internos (stack, SQL) para o cliente.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;
  const requestId = (req as { id?: string }).id;

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    const first = details[0];
    return res.status(400).json({
      error: first ? `${first.field ? `${first.field}: ` : ""}${first.message}` : "Dados inválidos",
      details,
    });
  }

  // Corpo JSON malformado (erro do express.json()).
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON inválido no corpo da requisição" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Corpo da requisição grande demais" });
  }

  const pgError = typeof err?.code === "string" ? PG_CLIENT_ERRORS[err.code] : undefined;
  if (pgError) {
    return res.status(pgError.status).json({ error: pgError.message });
  }

  logger.error({ err, requestId, method: req.method, url: req.originalUrl }, "Erro não tratado na requisição");
  res.status(500).json({ error: "Erro interno do servidor", requestId });
};
