import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

// 密码哈希：用 Node 内置 scrypt（零依赖），格式 `salt:hash`（hex）
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const computed = scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hash, 'hex');
  return computed.length === storedBuf.length && timingSafeEqual(computed, storedBuf);
}

export function generateToken() {
  return randomBytes(32).toString('hex');
}

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

export function createSession(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    new Date().toISOString(),
    expiresAt
  );
  return token;
}

export function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getSessionUser(token) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  return user || null;
}

// 从请求里取 token（Authorization: Bearer xxx，或 query.token）
export function readToken(req) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];
  return req.query.token || '';
}

// 登录鉴权中间件：把当前用户挂到 req.user
export function requireAuth(req, res, next) {
  const token = readToken(req);
  const user = getSessionUser(token);
  if (!user) {
    return res.status(401).json({ error: '未登录或登录已失效' });
  }
  req.user = user;
  req.token = token;
  next();
}

// 角色鉴权中间件：requireRole('admin') / requireRole('student', 'admin')
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '无权限' });
    }
    next();
  };
}
