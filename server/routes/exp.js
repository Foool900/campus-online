import { Router } from 'express';
import { db } from '../db.js';
import { config, levelOf } from '../config.js';

const router = Router();

// GET /api/exp/wallet —— 我的经验账户（可用 / 冻结 / 累计 / 等级）
router.get('/exp/wallet', (req, res) => {
  const u = db
    .prepare('SELECT exp, available_exp, frozen_exp FROM users WHERE id = ?')
    .get(req.user.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  res.json({
    id: req.user.id,
    totalExp: u.exp,
    availableExp: u.available_exp,
    frozenExp: u.frozen_exp,
    level: levelOf(u.exp),
  });
});

// GET /api/exp/config —— 经验 / 任务上限配置（前端渲染用）
router.get('/exp/config', (req, res) => {
  res.json(config);
});

export default router;
