import { Router } from 'express';
import { db, nowIso } from '../db.js';

const router = Router();

const SELECT_TODO = `
  SELECT t.*, a.name AS area_name
  FROM todos t
  LEFT JOIN areas a ON a.id = t.area_id
`;

function mapTodo(row) {
  if (!row) return row;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    status: row.status,
    expReward: row.exp_reward,
    areaId: row.area_id,
    areaName: row.area_name || null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// GET /api/todos?userId=... —— 某用户的待办列表（待办在前，已完成在后）
router.get('/todos', (req, res) => {
  const userId = Number(req.query.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: '缺少有效的 userId' });
  }

  const rows = db
    .prepare(`${SELECT_TODO} WHERE t.user_id = ? ORDER BY (t.status = 'completed') ASC, t.id DESC`)
    .all(userId);
  res.json(rows.map(mapTodo));
});

// POST /api/todos —— 创建待办
router.post('/todos', (req, res) => {
  const { userId, title, description, dueDate, areaId, expReward } = req.body || {};
  const uid = Number(userId);
  if (!Number.isInteger(uid)) {
    return res.status(400).json({ error: '缺少有效的 userId' });
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  const t = typeof title === 'string' ? title.trim() : '';
  if (!t) {
    return res.status(400).json({ error: '任务标题不能为空' });
  }
  if (t.length > 60) {
    return res.status(400).json({ error: '任务标题过长（最多 60 字）' });
  }

  const desc = typeof description === 'string' ? description.trim() : '';
  const due = dueDate ? String(dueDate) : null;

  let areaIdParsed = areaId ? Number(areaId) : null;
  if (areaIdParsed !== null && !Number.isInteger(areaIdParsed)) {
    areaIdParsed = null;
  }
  if (areaIdParsed !== null) {
    const area = db.prepare('SELECT id FROM areas WHERE id = ?').get(areaIdParsed);
    if (!area) {
      return res.status(404).json({ error: '关联区域不存在' });
    }
  }

  let reward = Number(expReward);
  if (!Number.isFinite(reward) || reward <= 0) reward = 10;
  reward = Math.min(Math.round(reward), 1000);

  const info = db
    .prepare(
      `INSERT INTO todos (user_id, title, description, due_date, status, exp_reward, area_id, created_at, completed_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, NULL)`
    )
    .run(uid, t, desc, due, reward, areaIdParsed, nowIso());

  const row = db.prepare(`${SELECT_TODO} WHERE t.id = ?`).get(info.lastInsertRowid);
  res.status(201).json(mapTodo(row));
});

// PATCH /api/todos/:id/complete —— 完成任务（幂等：已完成的不能重复加经验）
router.patch('/todos/:id/complete', (req, res) => {
  const todoId = Number(req.params.id);
  if (!Number.isInteger(todoId)) {
    return res.status(400).json({ error: '无效的任务 ID' });
  }
  const { userId } = req.body || {};
  const uid = Number(userId);
  if (!Number.isInteger(uid)) {
    return res.status(400).json({ error: '缺少有效的 userId' });
  }

  const completeTx = db.transaction(() => {
    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(todoId);
    if (!todo) return { error: '任务不存在', status: 404 };
    if (todo.user_id !== uid) return { error: '无权操作该任务', status: 403 };

    if (todo.status === 'completed') {
      return { alreadyCompleted: true };
    }

    const completedAt = nowIso();
    db.prepare("UPDATE todos SET status = 'completed', completed_at = ? WHERE id = ?").run(completedAt, todoId);
    db.prepare('UPDATE users SET exp = exp + ? WHERE id = ?').run(todo.exp_reward, uid);
    return { alreadyCompleted: false };
  });

  const result = completeTx();
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  const row = db.prepare(`${SELECT_TODO} WHERE t.id = ?`).get(todoId);
  const user = db.prepare('SELECT exp FROM users WHERE id = ?').get(uid);
  res.json({ ...mapTodo(row), alreadyCompleted: result.alreadyCompleted, userExp: user.exp });
});

export default router;
