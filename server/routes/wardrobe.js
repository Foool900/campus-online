import { Router } from 'express';
import { requireRole } from '../auth.js';
import { listWardrobe } from '../wardrobe.js';
import { listWardrobePools, importWardrobePools, drawWardrobe } from '../wardrobe-gacha.js';

const router = Router();

// GET /api/wardrobe —— 装扮图鉴目录（模板列表，供上架/任务奖励选择）
router.get('/wardrobe', (req, res) => {
  res.json(listWardrobe());
});

// GET /api/wardrobe/pools —— 装扮奖池列表（含我的拥有情况）
router.get('/wardrobe/pools', (req, res) => {
  res.json(listWardrobePools(req.user.id));
});

// POST /api/wardrobe/pools/import —— 批量导入奖池（仅 admin）
router.post('/wardrobe/pools/import', requireRole('admin'), (req, res) => {
  const result = importWardrobePools(req.user.id, req.body);
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  res.status(201).json(result);
});

// POST /api/wardrobe/pools/:id/draw —— 抽一次（student+）
router.post('/wardrobe/pools/:id/draw', requireRole('student', 'admin'), (req, res) => {
  const result = drawWardrobe(req.user.id, Number(req.params.id));
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  res.json(result);
});

export default router;
