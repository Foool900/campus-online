import { Router } from 'express';
import { db } from '../db.js';
import { listAllAchievements, notifyAchievement, notifyNewProgressAchievements } from '../achievements.js';

const router = Router();

// GET /api/achievements —— 统一成就列表（进度型 + 触发型，含解锁状态与进度）
router.get('/achievements', (req, res) => {
  res.json({ achievements: listAllAchievements(req.user.id) });
});

// POST /api/achievements/trigger —— 客户端埋点触发（EXP_002/003/004/015 等）
router.post('/achievements/trigger', (req, res) => {
  const code = (req.body?.code || '').toString().trim();
  if (!code) return res.status(400).json({ error: '缺少成就 code' });
  const ach = notifyAchievement(req.user.id, code, req.app.get('io'));
  res.json({ unlocked: !!ach, achievement: ach || null });
});

// POST /api/achievements/page-open —— 记录一次「打开界面」次数（供 page_opens 进度型成就统计）
router.post('/achievements/page-open', (req, res) => {
  const page = (req.body?.page || '').toString().trim();
  if (!page) return res.status(400).json({ error: '缺少 page' });
  const userId = req.user.id;

  db.prepare(
    'INSERT INTO page_opens (user_id, page, count) VALUES (?, ?, 1) ON CONFLICT(user_id, page) DO UPDATE SET count = count + 1'
  ).run(userId, page);

  const count = db
    .prepare('SELECT count FROM page_opens WHERE user_id = ? AND page = ?')
    .get(userId, page).count;

  // 打开界面可能让 page_opens 等进度型成就跨过阈值 → 检测并弹窗
  notifyNewProgressAchievements(userId, req.app.get('io'));

  res.json({ page, count });
});

export default router;
