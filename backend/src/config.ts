import path from "path";
import dotenv from "dotenv";
import { z } from "zod";

// Carrega o .env aqui mesmo em vez de depender da ordem de imports de quem consome este
// módulo — assim os valores são sempre lidos de forma determinística.
dotenv.config({ quiet: true });

/**
 * Único ponto do backend que lê `process.env`. Tudo é validado na subida: uma variável
 * obrigatória ausente ou um valor inválido derruba o processo com uma mensagem clara, em
 * vez de o serviço subir "meio configurado" e falhar depois, no meio de uma requisição.
 */
const booleanFromEnv = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),

  DATABASE_URL: z.string().min(1, "não definida"),

  // Sem valor padrão de propósito: um segredo previsível permite forjar um token válido
  // (inclusive com role "admin") para qualquer conta.
  JWT_SECRET: z.string().min(16, "precisa ter pelo menos 16 caracteres"),
  ACCESS_TOKEN_TTL: z.string().default("1h"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Lista separada por vírgula. Vazio = qualquer origem (aceitável só em desenvolvimento).
  CORS_ORIGINS: z.string().default(""),
  RATE_LIMIT_ENABLED: booleanFromEnv,
  // Atrás de um proxy reverso (nginx, load balancer) o IP real vem em X-Forwarded-For.
  TRUST_PROXY: booleanFromEnv,
  // Sem provedor de email, o token de redefinição de senha é devolvido na resposta da API.
  // Isso só é tolerável fora de produção; em produção o padrão é não expor.
  EXPOSE_RESET_TOKEN: booleanFromEnv,

  AI_SERVICE_URL: z.string().default("http://localhost:8000"),
  // Segredo compartilhado backend ↔ ai-service. Vazio = sem autenticação entre serviços (dev).
  AI_SERVICE_TOKEN: z.string().default(""),
  // Atraso (ms) entre a última alteração de conteúdo e o disparo da reindexação do RAG.
  REINDEX_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(5000),

  // Arquivos anexados ao catálogo (PDF, imagens…). No Docker, é um volume próprio.
  UPLOADS_DIR: z.string().default(""),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(200).default(25),

  GITLAB_URL: z.string().default(""),
  GITLAB_TOKEN: z.string().default(""),
  GITLAB_GROUP: z.string().default(""),
  CLICKUP_API_TOKEN: z.string().default(""),
  CLICKUP_TEAM_ID: z.string().default(""),
});

const PLACEHOLDER_SECRETS = new Set(["troque-por-um-segredo-forte", "dev-secret-inseguro", "changeme"]);

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Configuração inválida. Variável de ambiente obrigatória ausente ou com valor inválido:\n${problems}\n` +
        `Configure-as em backend/.env (veja backend/.env.example) antes de iniciar o serviço.`
    );
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === "production";
  const isTest = env.NODE_ENV === "test";

  if (isProduction && PLACEHOLDER_SECRETS.has(env.JWT_SECRET)) {
    throw new Error(
      `JWT_SECRET está com um valor de exemplo. Gere um segredo de verdade antes de subir em produção ` +
        `(ex.: openssl rand -base64 48).`
    );
  }

  return {
    env: env.NODE_ENV,
    isProduction,
    isTest,
    port: env.PORT,
    logLevel: env.LOG_LEVEL ?? (isTest ? "silent" : isProduction ? "info" : "debug"),
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    accessTokenTtl: env.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    corsOrigins: env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    rateLimitEnabled: env.RATE_LIMIT_ENABLED ?? !isTest,
    trustProxy: env.TRUST_PROXY ?? false,
    exposeResetToken: env.EXPOSE_RESET_TOKEN ?? !isProduction,
    aiServiceUrl: env.AI_SERVICE_URL.replace(/\/$/, ""),
    aiServiceToken: env.AI_SERVICE_TOKEN,
    reindexDebounceMs: env.REINDEX_DEBOUNCE_MS,
    uploadsDir: path.resolve(env.UPLOADS_DIR || path.join(process.cwd(), "data", "uploads")),
    maxUploadBytes: Math.round(env.MAX_UPLOAD_MB * 1024 * 1024),
    gitlab: { url: env.GITLAB_URL, token: env.GITLAB_TOKEN, group: env.GITLAB_GROUP },
    clickup: { apiToken: env.CLICKUP_API_TOKEN, teamId: env.CLICKUP_TEAM_ID },
  };
}

export const config = load();
export type AppConfig = typeof config;
