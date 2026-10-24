import { Router } from 'express';
import { db } from '../db.js';
import { config, levelOf } from '../config.js';

const router = Router();

// GET /api/coin/wallet —— 我的账户（经验等级 + 金币）
router.get('/coin/wallet', (req, res) => {
  const u = db.prepare('SELECT exp, coin, frozen_coin FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  res.json({
    id: req.user.id,
    exp: u.exp,
    level: levelOf(u.exp),
    coin: u.coin,
    frozenCoin: u.frozen_coin,
  });
});

// GET /api/coin/config —— 金币经济配置（前端渲染用）
router.get('/coin/config', (req, res) => {
  res.json(config.coin);
});

// GET /api/coin/transactions —— 我的金币流水（最近 50 条）
router.get('/coin/transactions', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM coin_transactions WHERE from_user_id = ? OR to_user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id, req.user.id);
  res.json(rows);
});

export default router;
