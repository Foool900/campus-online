import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

// GET /api/world —— 返回全局「世界频道」（隐藏区域下的频道）
router.get('/world', (req, res) => {
  const world = db.prepare("SELECT id FROM areas WHERE slug = 'world' AND hidden = 1").get();
  if (!world) {
    return res.status(404).json({ error: '世界频道不存在' });
  }
  const channel = db.prepare('SELECT id, name FROM channels WHERE area_id = ? ORDER BY id ASC LIMIT 1').get(world.id);
  if (!channel) {
    return res.status(404).json({ error: '世界频道不存在' });
  }
  res.json({ channel });
});

export default router;
