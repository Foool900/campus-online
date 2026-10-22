import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { levelOf } from '../config.js';

const router = Router();

function mapUser(row) {
  if (!row) return row;
  return {
    id: row.id,
    nickname: row.nickname,
    college: row.college,
    avatar: row.avatar,
    exp: row.exp, // 累计经验 totalExp（保留旧字段名，兼容前端）
    availableExp: row.available_exp,
    frozenExp: row.frozen_exp,
    level: levelOf(row.exp),
    role: row.role,
    createdAt: row.created_at,
  };
}

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
  if (req.user.id !== id) {
    return res.status(403).json({ error: '只能修改自己的资料' });
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
