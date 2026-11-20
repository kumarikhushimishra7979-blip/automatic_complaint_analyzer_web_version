import { Router } from 'express';
import { getDb } from '../database.ts';
import {
  hashPassword,
  requireAuth,
  safeLog,
  signAccessToken,
  validateEmail,
  validatePasswordStrength,
  verifyPassword,
  type AuthenticatedRequest,
} from '../security.ts';

const router = Router();

router.post('/register', (req, res) => {
  try {
    const { username, email, password, confirm_password } = req.body || {};

    const cleanUsername = typeof username === 'string' ? username.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!cleanUsername || cleanUsername.length < 2) {
      res.status(400).json({ detail: 'Username must be at least 2 characters long.' });
      return;
    }
    if (!cleanEmail || !validateEmail(cleanEmail)) {
      res.status(400).json({ detail: 'Please provide a valid email address.' });
      return;
    }

    const pwError = validatePasswordStrength(String(password || ''));
    if (pwError) {
      res.status(400).json({ detail: pwError });
      return;
    }

    if (confirm_password !== undefined && password !== confirm_password) {
      res.status(400).json({ detail: 'Password and confirm password do not match.' });
      return;
    }

    const db = getDb();
    const existing = db
      .prepare('SELECT id FROM users WHERE LOWER(email) = ?')
      .get(cleanEmail);

    if (existing) {
      res.status(409).json({ detail: 'An account with this email address already exists.' });
      return;
    }

    const passwordHash = hashPassword(String(password));
    const result = db
      .prepare(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
      )
      .run(cleanUsername, cleanEmail, passwordHash);

    const userId = Number(result.lastInsertRowid);
    const user = db
      .prepare('SELECT id, username, email, is_active, created_at FROM users WHERE id = ?')
      .get(userId) as {
      id: number;
      username: string;
      email: string;
      is_active: number;
      created_at: string;
    };

    const accessToken = signAccessToken({ id: user.id, email: user.email });
    safeLog('INFO', 'user_registered', { userId: user.id });

    res.status(201).json({
      access_token: accessToken,
      token_type: 'bearer',
      user,
    });
  } catch (err) {
    safeLog('ERROR', 'register_error', {
      msg: err instanceof Error ? err.message : 'unknown',
    });
    res.status(500).json({ detail: 'Unable to complete registration. Please try again.' });
  }
});

router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const rawPassword = typeof password === 'string' ? password : '';

    if (!cleanEmail || !rawPassword) {
      res.status(400).json({ detail: 'Email and password are required.' });
      return;
    }

    const db = getDb();
    const user = db
      .prepare(
        'SELECT id, username, email, password_hash, is_active, created_at FROM users WHERE LOWER(email) = ?'
      )
      .get(cleanEmail) as
      | {
          id: number;
          username: string;
          email: string;
          password_hash: string;
          is_active: number;
          created_at: string;
        }
      | undefined;

    if (!user || !verifyPassword(rawPassword, user.password_hash)) {
      res.status(401).json({ detail: 'Invalid email address or password.' });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ detail: 'This user account has been deactivated.' });
      return;
    }

    const accessToken = signAccessToken({ id: user.id, email: user.email });
    safeLog('INFO', 'user_login', { userId: user.id });

    res.json({
      access_token: accessToken,
      token_type: 'bearer',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_active: user.is_active,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    safeLog('ERROR', 'login_error', {
      msg: err instanceof Error ? err.message : 'unknown',
    });
    res.status(500).json({ detail: 'Unable to complete login. Please try again.' });
  }
});

router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json(req.user);
});

router.put('/password', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body || {};
    if (!current_password || !new_password) {
      res.status(400).json({ detail: 'Current and new passwords are required.' });
      return;
    }
    const pwErr = validatePasswordStrength(String(new_password));
    if (pwErr) {
      res.status(400).json({ detail: pwErr });
      return;
    }
    if (new_password !== confirm_password) {
      res.status(400).json({ detail: 'New password and confirmation do not match.' });
      return;
    }

    const db = getDb();
    const row = db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(req.user!.id) as { password_hash: string } | undefined;

    if (!row || !verifyPassword(String(current_password), row.password_hash)) {
      res.status(400).json({ detail: 'Current password is incorrect.' });
      return;
    }

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      hashPassword(String(new_password)),
      req.user!.id
    );
    res.json({ message: 'Password updated successfully.' });
  } catch {
    res.status(500).json({ detail: 'Failed to update password.' });
  }
});

export default router;
