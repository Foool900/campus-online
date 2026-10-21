import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

function metricValue(userId, metric) {
  switch (metric) {
    case 'user_created':
      return 1;
    case 'messages_sent':
      return db.prepare('SELECT COUNT(*) AS c FROM messages WHERE user_id = ?').get(userId).c;
    case 'posts_created':
      return db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?').get(userId).c;
    case 'todos_completed':
      return db.prepare("SELECT COUNT(*) AS c FROM todos WHERE user_id = ? AND status = 'completed'").get(userId).c;
    case 'exp_total':
      return db.prepare('SELECT exp FROM users WHERE id = ?').get(userId)?.exp ?? 0;
    case 'areas_visited':
      return db.prepare('SELECT COUNT(DISTINCT channel_id) AS c FROM messages WHERE user_id = ?').get(userId).c;
    default:
      return 0;
  }
}

// GET /api/achievements?userId=... —— 成就列表（含当前进度与解锁状态）
router.get('/achievements', (req, res) => {
  const userId = Number(req.query.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: '缺少有效的 userId' });
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  const totalChannels = db.prepare('SELECT COUNT(*) AS c FROM channels').get().c;
  const list = db.prepare('SELECT * FROM achievements ORDER BY id ASC').all();

  const achievements = list.map((a) => {
    const target = a.metric === 'areas_visited' ? totalChannels : a.threshold;
    const current = Math.min(metricValue(userId, a.metric), target);
    return {
      ...a,
      target,
      current,
      unlocked: current >= target,
      progressPct: target > 0 ? Math.round((current / target) * 100) : 100,
    };
  });

  res.json({ totalChannels, achievements });
});

export default router;
