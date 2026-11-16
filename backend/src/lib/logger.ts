import pino from "pino";
import { config } from "../config";

/**
 * Logger estruturado (JSON em produção, legível em desenvolvimento).
 *
 * Em produção cada linha é um objeto JSON com nível, horário, id da requisição e campos
 * extras — o formato que agregadores de log (Loki, CloudWatch, Datadog, ELK) indexam sem
 * configuração. Dados sensíveis são mascarados antes de sair do processo.
 */
export const logger = pino({
  level: config.logLevel,
  base: { service: "flexia-hub-api" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-service-token']",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.refreshToken",
    ],
    censor: "[oculto]",
  },
  transport:
    !config.isProduction && !config.isTest
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname,service" } }
      : undefined,
});
