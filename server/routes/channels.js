import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

// GET /api/areas/:areaId/channels —— 某区域下的频道
router.get('/areas/:areaId/channels', (req, res) => {
  const areaId = Number(req.params.areaId);
  if (!Number.isInteger(areaId)) {
    return res.status(400).json({ error: '无效的区域 ID' });
  }

  const area = db.prepare('SELECT id FROM areas WHERE id = ?').get(areaId);
  if (!area) {
    return res.status(404).json({ error: '区域不存在' });
  }

  const channels = db.prepare('SELECT * FROM channels WHERE area_id = ? ORDER BY id ASC').all(areaId);
  res.json(channels);
});

export default router;
