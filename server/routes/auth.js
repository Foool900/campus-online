import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { hashPassword, verifyPassword, createSession, destroySession, requireAuth, readToken, getSessionUser } from '../auth.js';
import { levelOf } from '../config.js';
import { triggerAchievement } from '../achievements.js';

const router = Router();

function mapUser(row) {
  if (!row) return row;
  return {
    id: row.id,
    nickname: row.nickname,
    college: row.college,
    avatar: row.avatar,
    exp: row.exp, // 累计经验，只增不减，决定等级
    coin: row.coin,
    frozenCoin: row.frozen_coin,
    level: levelOf(row.exp),
    role: row.role,
    permissions: (() => {
      try {
        return JSON.parse(row.permissions || '[]');
      } catch {
        return [];
      }
    })(),
    createdAt: row.created_at,
  };
}

// 幂等触发成就，并通过 socket 通知该用户
function notifyAchievement(req, userId, code) {
  const ach = triggerAchievement(userId, code);
  const io = req.app.get('io');
  if (ach && io) {
    io.to(`user:${userId}`).emit('achievement:unlocked', {
      code: ach.code,
      name: ach.name,
      icon: ach.icon,
      description: ach.description,
    });
  }
}

function validateCredential(nickname, password) {
  const name = typeof nickname === 'string' ? nickname.trim() : '';
  if (name.length < 2 || name.length > 20) return '昵称长度需为 2-20 个字符';
  if (typeof password !== 'string' || password.length < 6) return '密码至少 6 位';
  return null;
}

// POST /api/auth/register —— 注册（昵称 + 密码 + 可选学院）
router.post('/auth/register', (req, res) => {
  const { nickname, password, college } = req.body || {};
  const err = validateCredential(nickname, password);
  if (err) return res.status(400).json({ error: err });
  const name = nickname.trim();
  const col = typeof college === 'string' ? college.trim() : '';

  const existing = db.prepare('SELECT id, password_hash FROM users WHERE nickname = ?').get(name);
  if (existing) {
    if (existing.password_hash) return res.status(409).json({ error: '该昵称已被注册' });
    // 老账号（无密码）：注册即完成迁移——设置密码
    db.prepare('UPDATE users SET password_hash = ?, college = ? WHERE id = ?').run(hashPassword(password), col || '', existing.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
    return res.json({ user: mapUser(user), token: createSession(existing.id) });
  }

  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, role, password_hash, created_at) VALUES (?, ?, '🎓', 0, 'member', ?, ?)")
    .run(name, col, hashPassword(password), nowIso());
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  notifyAchievement(req, user.id, 'EXP_001');
  res.status(201).json({ user: mapUser(user), token: createSession(user.id) });
});

// POST /api/auth/login —— 登录
router.post('/auth/login', (req, res) => {
  const { nickname, password } = req.body || {};
  const name = typeof nickname === 'string' ? nickname.trim() : '';
  if (!name || typeof password !== 'string') {
    return res.status(400).json({ error: '请输入昵称和密码' });
  }
  const user = db.prepare('SELECT * FROM users WHERE nickname = ?').get(name);
  if (!user) return res.status(404).json({ error: '用户不存在，请先注册' });
  if (!user.password_hash) return res.status(409).json({ error: '该账号还未设置密码，请先设置密码' });
  if (!verifyPassword(password, user.password_hash)) return res.status(401).json({ error: '密码错误' });
  notifyAchievement(req, user.id, 'EXP_001');
  res.json({ user: mapUser(user), token: createSession(user.id) });
});

// POST /api/auth/set-password —— 老账号首次设置密码（迁移）
router.post('/auth/set-password', (req, res) => {
  const { nickname, password } = req.body || {};
  const err = validateCredential(nickname, password);
  if (err) return res.status(400).json({ error: err });
  const name = nickname.trim();
  const user = db.prepare('SELECT * FROM users WHERE nickname = ?').get(name);
  if (!user) return res.status(404).json({ error: '用户不存在，请先注册' });
  if (user.password_hash) return res.status(409).json({ error: '该账号已设置过密码，请直接登录' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ user: mapUser(fresh), token: createSession(user.id) });
});

// POST /api/auth/logout —— 退出登录
router.post('/auth/logout', (req, res) => {
  const token = readToken(req);
  if (token) destroySession(token);
  res.json({ ok: true });
});

// GET /api/auth/me —— 从 token 取当前用户
router.get('/auth/me', (req, res) => {
  const user = getSessionUser(readToken(req));
  if (!user) return res.status(401).json({ error: '未登录或登录已失效' });
  res.json(mapUser(user));
});

export default router;
