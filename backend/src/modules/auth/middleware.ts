import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../../config";
import type { EventActor } from "../../lib/events";

export const ROLES = ["dev", "analista_suporte", "analista_ativacao", "admin"] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

// Exige um Bearer token válido; anexa req.user
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = readBearerToken(req);
  if (!token) return res.status(401).json({ error: "Não autenticado" });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthUser;
    req.user = { id: payload.id, name: payload.name, email: payload.email, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

// Exige que req.user (já autenticado por requireAuth) tenha um dos papéis informados.
// Uso: router.post('/x', requireAuth, requireRole('admin', 'analista_ativacao'), handler)
export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Não autenticado" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Ação restrita a: ${roles.join(", ")}. Seu papel atual: ${req.user.role}.`,
      });
    }
    next();
  };
}

/** Converte o usuário da requisição no "ator" de um evento de domínio. */
export function actorOf(req: AuthedRequest): EventActor | null {
  return req.user ? { id: req.user.id, name: req.user.name, role: req.user.role } : null;
}
