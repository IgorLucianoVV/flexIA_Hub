import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { pool } from "../../db";
import { config } from "../../config";
import { badRequest, conflict, forbidden, unauthorized } from "../../lib/errors";
import { publish } from "../../lib/events";
import { logger } from "../../lib/logger";
import { loginLimiter, passwordResetLimiter, registerLimiter } from "../../lib/rateLimit";
import { parse, text } from "../../lib/validate";
import { AuthedRequest, requireAuth } from "./middleware";
import { endAllSessions, endSession, rotateSession, startSession } from "./tokens";

export const authRouter = Router();

const MIN_PASSWORD_LENGTH = 8;
const RESET_TOKEN_TTL_MINUTES = 30;

// Papéis que a própria pessoa pode escolher ao se cadastrar. "admin" fica de fora de
// propósito: antes qualquer um podia criar uma conta já como admin só mandando
// `role: "admin"` no cadastro. Admin agora só é concedido por outro admin (painel de
// administração) ou pelo script `npm run user:promote`.
const SELF_ASSIGNABLE_ROLES = ["dev", "analista_suporte", "analista_ativacao"] as const;

const email = z
  .string({ error: "email é obrigatório" })
  .trim()
  .toLowerCase()
  .pipe(z.email("email inválido").max(200));
const password = z
  .string({ error: "password é obrigatório" })
  .min(MIN_PASSWORD_LENGTH, `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`)
  .max(200, "Senha longa demais");

const registerSchema = z.object({
  name: text(120, "name"),
  email,
  password,
  role: z.string().optional(),
});
const loginSchema = z.object({ email, password: z.string({ error: "password é obrigatório" }).min(1).max(200) });
const refreshSchema = z.object({ refreshToken: z.string({ error: "refreshToken é obrigatório" }).min(1).max(500) });
const forgotSchema = z.object({ email });
const resetSchema = z.object({ token: z.string({ error: "token é obrigatório" }).min(1).max(500), password });

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// POST /api/auth/register
authRouter.post("/register", registerLimiter, async (req, res) => {
  const body = parse(registerSchema, req.body);

  if (body.role === "admin") {
    throw forbidden("O papel de admin não pode ser escolhido no cadastro — peça a um administrador.");
  }
  const role = (SELF_ASSIGNABLE_ROLES as readonly string[]).includes(body.role ?? "") ? body.role! : "dev";

  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [body.email]);
  if (existing.rows[0]) throw conflict("Já existe uma conta com esse email");

  const passwordHash = await bcrypt.hash(body.password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, last_login_at) VALUES ($1,$2,$3,$4, now())
     RETURNING id, name, email, role, created_at`,
    [body.name, body.email, passwordHash, role]
  );
  const user = rows[0];
  const session = await startSession(user, req.headers["user-agent"]);

  await publish({
    type: "user.registered",
    actor: { id: user.id, name: user.name, role: user.role },
    entityType: "user",
    entityId: user.id,
    summary: `Criou a própria conta (${user.email}, papel ${user.role})`,
    contentChanged: false,
  });

  res.status(201).json({ ...session, user });
});

// POST /api/auth/login
authRouter.post("/login", loginLimiter, async (req, res) => {
  const body = parse(loginSchema, req.body);

  const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [body.email]);
  const userRow = rows[0];
  // Mesma mensagem para "email não existe" e "senha errada": não revela quais emails têm conta.
  const invalid = unauthorized("Email ou senha inválidos");

  if (!userRow) {
    logger.warn({ email: body.email }, "Tentativa de login com email inexistente");
    throw invalid;
  }
  const valid = await bcrypt.compare(body.password, userRow.password_hash);
  if (!valid) {
    logger.warn({ userId: userRow.id }, "Tentativa de login com senha incorreta");
    throw invalid;
  }
  if (!userRow.is_active) throw forbidden("Esta conta foi desativada. Fale com um administrador.");

  await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userRow.id]);
  const user = { id: userRow.id, name: userRow.name, email: userRow.email, role: userRow.role };
  const session = await startSession(user, req.headers["user-agent"]);
  res.json({ ...session, user });
});

// POST /api/auth/refresh { refreshToken } -> novo par de tokens (rotação)
authRouter.post("/refresh", async (req, res) => {
  const { refreshToken } = parse(refreshSchema, req.body);
  const session = await rotateSession(refreshToken, req.headers["user-agent"]);
  res.json(session);
});

// POST /api/auth/logout { refreshToken } -> revoga a sessão no servidor
authRouter.post("/logout", async (req, res) => {
  const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : "";
  if (refreshToken) await endSession(refreshToken);
  res.status(204).send();
});

// POST /api/auth/forgot-password
// Sem provedor de email configurado, o token de redefinição é devolvido na resposta (e
// logado) para viabilizar o fluxo em desenvolvimento. Isso é controlado por
// EXPOSE_RESET_TOKEN e fica DESLIGADO por padrão em produção: lá, sem email, o token não
// sai do servidor — devolvê-lo permitiria a qualquer um redefinir a senha de qualquer conta.
authRouter.post("/forgot-password", passwordResetLimiter, async (req, res) => {
  const body = parse(forgotSchema, req.body);

  const { rows } = await pool.query(`SELECT id FROM users WHERE email = $1 AND is_active = true`, [body.email]);
  const userRow = rows[0];

  // Resposta genérica mesmo se o email não existir, pra não vazar quais emails têm conta.
  const genericResponse = {
    message: "Se existir uma conta com esse email, um link de redefinição foi gerado.",
  };
  if (!userRow) return res.json(genericResponse);

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);
  await pool.query(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`, [
    userRow.id,
    hashToken(token),
    expiresAt,
  ]);

  if (!config.exposeResetToken) {
    logger.warn(
      { userId: userRow.id },
      "Redefinição de senha solicitada, mas não há provedor de email configurado e EXPOSE_RESET_TOKEN está desligado — o token não foi entregue."
    );
    return res.json(genericResponse);
  }

  logger.info({ userId: userRow.id }, "Redefinição de senha solicitada (modo dev: token devolvido na resposta)");
  res.json({
    ...genericResponse,
    devModeToken: token,
    devModeNote:
      "Sem provedor de email configurado ainda — em produção este token viria por email, não na resposta da API.",
  });
});

// POST /api/auth/reset-password
authRouter.post("/reset-password", passwordResetLimiter, async (req, res) => {
  const body = parse(resetSchema, req.body);

  const { rows } = await pool.query(
    `SELECT * FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hashToken(body.token)]
  );
  const resetRow = rows[0];
  if (!resetRow) throw badRequest("Link de redefinição inválido ou expirado");

  const passwordHash = await bcrypt.hash(body.password, 10);
  await pool.query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, [
    passwordHash,
    resetRow.user_id,
  ]);
  await pool.query(`UPDATE password_resets SET used_at = now() WHERE id = $1`, [resetRow.id]);
  // Quem trocou a senha provavelmente quer que sessões antigas (talvez de outra pessoa) caiam.
  await endAllSessions(resetRow.user_id);

  await publish({
    type: "user.password_reset",
    actor: null,
    entityType: "user",
    entityId: resetRow.user_id,
    summary: "Senha redefinida pelo fluxo de recuperação",
    contentChanged: false,
  });

  res.json({ message: "Senha redefinida com sucesso." });
});

// GET /api/auth/me — dados atuais do usuário (lidos do banco, não do token)
authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, is_active, created_at FROM users WHERE id = $1`,
    [req.user!.id]
  );
  const user = rows[0];
  if (!user || !user.is_active) throw unauthorized("Usuário não encontrado ou desativado");
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.created_at });
});
