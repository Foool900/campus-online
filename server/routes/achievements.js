import { Router } from 'express';
import { db } from '../db.js';
import { listUserAchievements, triggerAchievement } from '../achievements.js';

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
      return db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE publisher_id = ? AND type = 'private' AND status = 'done'").get(userId).c;
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
  const list = db.prepare("SELECT * FROM achievements WHERE metric != 'trigger' ORDER BY id ASC").all();

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

// GET /api/user/achievements —— 全部触发式成就（含解锁状态与时间）
router.get('/user/achievements', (req, res) => {
  res.json(listUserAchievements(req.user.id));
});

// POST /api/user/achievements/trigger —— 客户端埋点触发（EXP_002/003/004/015 等）
router.post('/user/achievements/trigger', (req, res) => {
  const code = (req.body?.code || '').toString().trim();
  if (!code) return res.status(400).json({ error: '缺少成就 code' });
  const ach = triggerAchievement(req.user.id, code);
  const io = req.app.get('io');
  if (ach && io) {
    io.to(`user:${req.user.id}`).emit('achievement:unlocked', {
      code: ach.code,
      name: ach.name,
      icon: ach.icon,
      description: ach.description,
    });
  }
  res.json({ unlocked: !!ach, achievement: ach || null });
});

export default router;
