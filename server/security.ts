import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.ts';
import { getDb } from './database.ts';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  is_active: number;
  created_at: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signAccessToken(user: { id: number; email: string }): string {
  return jwt.sign(
    { sub: String(user.id), email: user.email },
    config.jwtSecret,
    { expiresIn: `${config.accessTokenExpireMinutes}m` }
  );
}

export function verifyAccessToken(token: string): { sub: string; email: string } {
  const decoded = jwt.verify(token, config.jwtSecret);
  if (typeof decoded === 'string' || !decoded.sub) {
    throw new Error('Invalid token payload');
  }
  return { sub: String(decoded.sub), email: String(decoded.email || '') };
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ detail: 'Authentication required. Please sign in.' });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ detail: 'Missing authentication token.' });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const db = getDb();
    const user = db
      .prepare(
        'SELECT id, username, email, is_active, created_at FROM users WHERE id = ?'
      )
      .get(Number(payload.sub)) as AuthUser | undefined;

    if (!user || !user.is_active) {
      res.status(401).json({ detail: 'User account is inactive or no longer exists.' });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ detail: 'Your session has expired or is invalid. Please log in again.' });
  }
}

export function safeLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, meta?: Record<string, string | number | boolean>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(meta || {}),
  };
  if (level === 'ERROR') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}
