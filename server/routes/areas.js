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

// PATCH /api/areas/:id —— 更新标记坐标（地图编辑模式拖拽定位用）
router.patch('/areas/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: '无效的区域 ID' });
  }
  const area = db.prepare('SELECT * FROM areas WHERE id = ?').get(id);
  if (!area) {
    return res.status(404).json({ error: '区域不存在' });
  }

  const { x, y } = req.body || {};
  const nx = x !== undefined ? Number(x) : area.x;
  const ny = y !== undefined ? Number(y) : area.y;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return res.status(400).json({ error: '无效的坐标' });
  }

  db.prepare('UPDATE areas SET x = ?, y = ? WHERE id = ?').run(nx, ny, id);
  res.json(db.prepare('SELECT * FROM areas WHERE id = ?').get(id));
});

export default router;
