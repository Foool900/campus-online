import { Router } from 'express';
import { db, nowIso } from '../db.js';

const router = Router();

// 等级规则：level = floor(exp / 100) + 1
const levelOf = (exp) => Math.floor(exp / 100) + 1;

function mapUser(row) {
  if (!row) return row;
  return {
    id: row.id,
    nickname: row.nickname,
    college: row.college,
    avatar: row.avatar,
    exp: row.exp,
    level: levelOf(row.exp),
    createdAt: row.created_at,
  };
}

// POST /api/users —— 首次创建 / 复用匿名用户
router.post('/users', (req, res) => {
  const { nickname, college } = req.body || {};
  const name = typeof nickname === 'string' ? nickname.trim() : '';
  if (!name) {
    return res.status(400).json({ error: '昵称不能为空' });
  }
  if (name.length < 2 || name.length > 20) {
    return res.status(400).json({ error: '昵称长度需为 2-20 个字符' });
  }

  const col = typeof college === 'string' ? college.trim() : '';

  // 本地原型的简化复用策略：同名用户直接复用，避免重复创建
  const existing = db.prepare('SELECT * FROM users WHERE nickname = ?').get(name);
  if (existing) {
    if (col && col !== existing.college) {
      db.prepare('UPDATE users SET college = ? WHERE id = ?').run(col, existing.id);
      existing.college = col;
    }
    return res.json(mapUser(existing));
  }

  const info = db
    .prepare('INSERT INTO users (nickname, college, avatar, exp, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(name, col, '🎓', nowIso());
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(mapUser(row));
});

// GET /api/users/:id —— 单个用户信息
router.get('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: '无效的用户 ID' });
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json(mapUser(row));
});

// PATCH /api/users/:id —— 修改昵称/学院（个人页使用）
router.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: '无效的用户 ID' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  const { nickname, college } = req.body || {};
  let name = user.nickname;
  let col = user.college;

  if (nickname !== undefined) {
    name = typeof nickname === 'string' ? nickname.trim() : '';
    if (!name) {
      return res.status(400).json({ error: '昵称不能为空' });
    }
    if (name.length < 2 || name.length > 20) {
      return res.status(400).json({ error: '昵称长度需为 2-20 个字符' });
    }
  }
  if (college !== undefined) {
    col = typeof college === 'string' ? college.trim() : '';
  }

  db.prepare('UPDATE users SET nickname = ?, college = ? WHERE id = ?').run(name, col, id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json(mapUser(row));
});

// GET /api/leaderboard —— 按经验值降序排行
router.get('/leaderboard', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY exp DESC, id ASC').all();
  res.json(rows.map(mapUser));
});

export default router;
