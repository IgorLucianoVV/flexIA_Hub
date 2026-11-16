import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config";

interface LimiterOptions {
  /** Janela de contagem, em minutos. */
  windowMinutes: number;
  /** Máximo de requisições por IP dentro da janela. */
  limit: number;
  message: string;
  /** Força o limitador mesmo com RATE_LIMIT_ENABLED=false (usado pelos testes do próprio limitador). */
  force?: boolean;
}

/**
 * Limite de requisições por IP. Protege principalmente as rotas de autenticação contra
 * força bruta de senha e enumeração de contas.
 *
 * O contador fica em memória, o que serve para uma instância. Com mais de uma réplica do
 * backend atrás de um balanceador, troque o store por um compartilhado (ex.: rate-limit-redis)
 * — a interface deste arquivo não muda.
 */
export function createLimiter({ windowMinutes, limit, message, force }: LimiterOptions): RequestHandler {
  if (!config.rateLimitEnabled && !force) {
    return (_req, _res, next) => next();
  }
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: message });
    },
  });
}

export const loginLimiter = createLimiter({
  windowMinutes: 15,
  limit: 10,
  message: "Muitas tentativas de login. Aguarde alguns minutos e tente de novo.",
});

export const registerLimiter = createLimiter({
  windowMinutes: 60,
  limit: 20,
  message: "Muitos cadastros a partir deste endereço. Tente de novo mais tarde.",
});

export const passwordResetLimiter = createLimiter({
  windowMinutes: 15,
  limit: 5,
  message: "Muitos pedidos de redefinição de senha. Aguarde alguns minutos e tente de novo.",
});

/** Teto geral da API: generoso para uso normal, mas barra um cliente em loop ou um scraper. */
export const apiLimiter = createLimiter({
  windowMinutes: 1,
  limit: 300,
  message: "Muitas requisições em pouco tempo. Aguarde um instante e tente de novo.",
});
