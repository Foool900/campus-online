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
      return db
        .prepare(
          `SELECT COUNT(DISTINCT m.channel_id) AS c
           FROM messages m
           JOIN channels ch ON ch.id = m.channel_id
           JOIN areas a ON a.id = ch.area_id
           WHERE m.user_id = ? AND a.hidden = 0`
        )
        .get(userId).c;
    default:
      return 0;
  }
}

// GET /api/achievements?userId=... —— 成就列表（含当前进度与解锁状态）
router.get('/achievements', (req, res) => {
  const userId = req.user.id;
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  const totalChannels = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM channels ch
       JOIN areas a ON a.id = ch.area_id
       WHERE a.hidden = 0`
    )
    .get().c;
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
