import crypto from "crypto";
import jwt, { SignOptions } from "jsonwebtoken";
import { config } from "../../config";
import { pool } from "../../db";
import { unauthorized } from "../../lib/errors";

/**
 * Sessão em duas peças:
 *
 *  - access token: JWT curto (padrão 1h), sem estado — é o que acompanha cada requisição.
 *  - refresh token: valor aleatório opaco, de vida longa (padrão 30 dias), guardado no
 *    banco apenas como hash SHA-256. Serve só para pedir um access token novo.
 *
 * O refresh token é ROTACIONADO a cada uso: quem o apresenta recebe um novo e o antigo é
 * revogado. Se um token já rotacionado aparecer de novo, alguém está reutilizando um token
 * copiado — a família inteira (todos os tokens derivados daquele login) é revogada e a
 * pessoa precisa entrar de novo. É o que permite logout de verdade e limita o estrago de um
 * token roubado, coisa que o JWT único de 30 dias de antes não permitia.
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface SessionTokens {
  token: string;
  refreshToken: string;
  /** Segundos até o access token expirar. */
  expiresIn: number;
}

const ROTATION_GRACE_MS = 15_000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function signAccessToken(user: SessionUser): { token: string; expiresIn: number } {
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, config.jwtSecret, {
    expiresIn: config.accessTokenTtl as SignOptions["expiresIn"],
  });
  const decoded = jwt.decode(token) as { exp: number; iat: number };
  return { token, expiresIn: decoded.exp - decoded.iat };
}

async function createRefreshToken(userId: string, familyId: string, userAgent?: string) {
  const raw = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60_000);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [userId, hashToken(raw), familyId, expiresAt, userAgent?.slice(0, 300) ?? null]
  );
  return { raw, id: rows[0].id };
}

/** Abre uma sessão nova (login ou cadastro). */
export async function startSession(user: SessionUser, userAgent?: string): Promise<SessionTokens> {
  const refresh = await createRefreshToken(user.id, crypto.randomUUID(), userAgent);
  const access = signAccessToken(user);
  return { token: access.token, refreshToken: refresh.raw, expiresIn: access.expiresIn };
}

/** Troca um refresh token válido por um par novo (rotação). */
export async function rotateSession(
  rawRefreshToken: string,
  userAgent?: string
): Promise<SessionTokens & { user: SessionUser }> {
  const { rows } = await pool.query(
    `SELECT rt.id, rt.user_id, rt.family_id, rt.expires_at, rt.revoked_at, rt.replaced_by_id,
            u.name, u.email, u.role, u.is_active
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = $1`,
    [hashToken(rawRefreshToken)]
  );
  const row = rows[0];
  if (!row) throw unauthorized("Sessão inválida. Entre de novo.");

  // Duas abas do navegador podem tentar renovar com o mesmo token quase ao mesmo tempo.
  // Um token rotacionado há poucos segundos ainda é aceito, para que a segunda aba não
  // seja confundida com um ataque e derrube a sessão legítima.
  const rotatedJustNow =
    row.revoked_at && row.replaced_by_id && Date.now() - new Date(row.revoked_at).getTime() < ROTATION_GRACE_MS;

  if (row.revoked_at && !rotatedJustNow) {
    // Reuso de um token já rotacionado: trata como comprometimento e derruba a família.
    await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [
      row.family_id,
    ]);
    throw unauthorized("Sessão encerrada por segurança. Entre de novo.");
  }
  if (new Date(row.expires_at) < new Date()) throw unauthorized("Sessão expirada. Entre de novo.");
  if (!row.is_active) throw unauthorized("Conta desativada. Fale com um administrador.");

  const user: SessionUser = { id: row.user_id, name: row.name, email: row.email, role: row.role };
  const next = await createRefreshToken(user.id, row.family_id, userAgent);
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()), replaced_by_id = $1 WHERE id = $2`,
    [next.id, row.id]
  );
  const access = signAccessToken(user);
  return { token: access.token, refreshToken: next.raw, expiresIn: access.expiresIn, user };
}

/** Logout: revoga a família do refresh token apresentado (silencioso se o token não existir). */
export async function endSession(rawRefreshToken: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE revoked_at IS NULL
        AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
    [hashToken(rawRefreshToken)]
  );
}

/** Revoga todas as sessões de um usuário (troca de senha, desativação da conta). */
export async function endAllSessions(userId: string): Promise<void> {
  await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}
