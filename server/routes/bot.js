import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { requireRole } from '../auth.js';
import { answer, rebuildIndex, getStatus } from '../kb.js';

const router = Router();

function safeParse(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// POST /api/bot/ask —— 任意登录角色提问（降级也返回 200，前端友好展示）
router.post('/ask', async (req, res) => {
  const q = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!q) return res.status(400).json({ error: '问题不能为空' });
  if (q.length > 500) return res.status(400).json({ error: '问题过长（最多 500 字）' });

  // 带上最近 6 轮对话作为上下文，让 Ala 能「记住」聊天
  const history = db
    .prepare('SELECT question, answer FROM bot_messages WHERE user_id = ? ORDER BY id DESC LIMIT 6')
    .all(req.user.id)
    .reverse();
  const result = await answer(q, history, { web: !!req.body?.web });
  if (result.answer) {
    db.prepare('INSERT INTO bot_messages (user_id, question, answer, sources, created_at) VALUES (?, ?, ?, ?, ?)').run(
      req.user.id,
      q,
      result.answer,
      JSON.stringify(result.sources || []),
      nowIso()
    );
  }
  res.json(result);
});

// GET /api/bot/history —— 最近 50 条
router.get('/history', (req, res) => {
  const rows = db
    .prepare('SELECT id, question, answer, sources, created_at AS createdAt FROM bot_messages WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id);
  res.json(rows.map((r) => ({ ...r, sources: safeParse(r.sources) })));
});

// POST /api/bot/rebuild —— 仅 admin 重建索引
router.post('/rebuild', requireRole('admin'), async (req, res) => {
  const r = await rebuildIndex();
  if (r.error) return res.status(503).json({ error: r.error });
  res.json(r);
});

// GET /api/bot/status —— 任意登录角色
router.get('/status', async (req, res) => {
  res.json(await getStatus());
});

export default router;
