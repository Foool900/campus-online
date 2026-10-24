import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

// GET /api/areas —— 列出所有区域；可加 ?campusId= 按校区过滤
router.get('/areas', (req, res) => {
  const campusId = req.query.campusId ? Number(req.query.campusId) : null;
  if (campusId !== null && !Number.isInteger(campusId)) {
    return res.status(400).json({ error: '无效的校区 ID' });
  }

  const areas = campusId
    ? db.prepare('SELECT * FROM areas WHERE campus_id = ? AND hidden = 0 ORDER BY id ASC').all(campusId)
    : db.prepare('SELECT * FROM areas WHERE hidden = 0 ORDER BY campus_id ASC, id ASC').all();

  res.json(areas);
});

export default router;
