import { Router } from 'express';
import { requireRole } from '../auth.js';
import {
  listMyInventory,
  setShowcaseItem,
  removeShowcaseItem,
  sellInventoryItem,
  unlistInventoryItem,
  listPublicShowcase,
  listUserShowcase,
} from '../inventory.js';

const router = Router();

// GET /api/inventory —— 我的背包 + 我的橱窗 + 展览位上限
router.get('/inventory', (req, res) => {
  const result = listMyInventory(req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// GET /api/inventory/showcase —— 橱窗广场（全服公开）
router.get('/inventory/showcase', (req, res) => {
  res.json(listPublicShowcase());
});

// GET /api/inventory/showcase/:userId —— 某用户的公开橱窗
router.get('/inventory/showcase/:userId', (req, res) => {
  const result = listUserShowcase(req.params.userId);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// POST /api/inventory/:id/showcase —— 放入橱窗
router.post('/inventory/:id/showcase', (req, res) => {
  const slot = req.body?.slot;
  const result = setShowcaseItem(req.user.id, req.params.id, slot);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// DELETE /api/inventory/:id/showcase —— 移出橱窗
router.delete('/inventory/:id/showcase', (req, res) => {
  const result = removeShowcaseItem(req.user.id, req.params.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// POST /api/inventory/:id/sell —— 开市时寄售（与市场写接口一致，需 student/admin）
router.post('/inventory/:id/sell', requireRole('student', 'admin'), (req, res) => {
  const result = sellInventoryItem(req.user.id, req.params.id, req.body?.priceCoin);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// POST /api/inventory/:id/unlist —— 下架寄售
router.post('/inventory/:id/unlist', requireRole('student', 'admin'), (req, res) => {
  const result = unlistInventoryItem(req.user.id, req.params.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

export default router;
