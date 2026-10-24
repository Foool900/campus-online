import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { config } from '../config.js';
import { applyCoinRaw } from '../coin.js';
import { treasuryBalance, spendTreasury } from '../treasury.js';

const router = Router();

// 抽奖。返回 { ok, prize, cost, net, treasury } 或 { error, code, status }
export function drawLottery(userId) {
  const cost = config.lottery.cost;
  const prizes = config.lottery.prizes;
  const minPrize = Math.min(...prizes);
  const pool = treasuryBalance();
  if (pool < minPrize) {
    return { error: `奖池余额不足（当前 ${pool}，最低奖金 ${minPrize}），等待市场手续费补充`, status: 409 };
  }

  try {
    const r = db.transaction(() => {
      const pay = applyCoinRaw({
        fromUserId: userId,
        amount: cost,
        type: 'sink',
        relatedType: 'lottery',
        idempotencyKey: `lottery:${userId}:${randomUUID()}`,
      });
      if (pay.error) throw Object.assign(new Error(pay.error), { code: pay.code, status: pay.status });

      const prize = Math.min(prizes[Math.floor(Math.random() * prizes.length)], pool);
      if (prize > 0) {
        spendTreasury(prize);
        const win = applyCoinRaw({
          toUserId: userId,
          amount: prize,
          type: 'mint',
          relatedType: 'lottery',
          idempotencyKey: `lottery:win:${userId}:${randomUUID()}`,
        });
        if (win.error) throw Object.assign(new Error(win.error), { code: win.code, status: win.status });
      }
      return { prize, cost, net: prize - cost };
    })();
    return { ok: true, ...r, treasury: treasuryBalance() };
  } catch (e) {
    if (e && e.status) return { error: e.message, code: e.code, status: e.status };
    throw e;
  }
}

// GET /api/lottery —— 奖池余额 + 抽奖配置
router.get('/lottery', (req, res) => {
  res.json({ treasury: treasuryBalance(), cost: config.lottery.cost, prizes: config.lottery.prizes });
});

// POST /api/lottery/draw —— 抽奖
router.post('/lottery/draw', requireRole('student', 'admin'), (req, res) => {
  const result = drawLottery(req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

export default router;
