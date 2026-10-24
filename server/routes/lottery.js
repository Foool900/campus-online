import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, nowIso } from '../db.js';
import { requireRole } from '../auth.js';
import { config } from '../config.js';
import { applyCoinRaw } from '../coin.js';
import { systemAccountId } from '../treasury.js';

const router = Router();

function systemCoin() {
  return db.prepare('SELECT coin FROM users WHERE id = ?').get(systemAccountId())?.coin ?? 0;
}

// 抽奖。返回 { ok, prize, cost, net, treasury, drawId } 或 { error, code, status }
// TODO: 抽奖请求级幂等需客户端传 client_request_id（防网络重试重复扣 cost），当前每抽用新 uuid。
export function drawLottery(userId) {
  const cost = config.lottery.cost;
  const prizes = config.lottery.prizes;
  const minPrize = Math.min(...prizes);

  // 入口校验：读 SYSTEM 账户余额（事务外快照；单连接同步模型下无并发，可接受）
  const pool = systemCoin();
  if (pool < minPrize) {
    return { error: `奖池余额不足（当前 ${pool}，最低奖金 ${minPrize}），等待市场手续费补充`, status: 409 };
  }

  try {
    const r = db.transaction(() => {
      // prize 先算，clamp 到入口 pool（保证 prize ≤ pool，pay 一定成功）
      const prize = Math.min(prizes[Math.floor(Math.random() * prizes.length)], pool);

      // 先落抽奖记录拿 draw_id（prize 已定值，一次写入）
      const drawInfo = db.prepare('INSERT INTO lottery_draws (user_id, prize_coin, created_at) VALUES (?, ?, ?)').run(userId, prize, nowIso());
      const drawId = Number(drawInfo.lastInsertRowid);

      // 抽奖费销毁（保持不变）
      const payCost = applyCoinRaw({
        fromUserId: userId,
        amount: cost,
        type: 'sink',
        relatedType: 'lottery',
        idempotencyKey: `lottery:${userId}:${randomUUID()}`,
      });
      if (payCost.error) throw Object.assign(new Error(payCost.error), { code: payCost.code, status: payCost.status });

      // 奖金：真实划转 SYSTEM → winner（pay 有 from.coin >= amount 校验，不足 COIN_INSUFFICIENT 回滚）
      const sysId = systemAccountId();
      const prizeKey = `lottery_prize:${drawId}`;
      const win = applyCoinRaw({
        fromUserId: sysId,
        toUserId: userId,
        amount: prize,
        type: 'pay',
        relatedType: 'lottery',
        relatedId: drawId,
        idempotencyKey: prizeKey,
      });
      if (win.error) throw Object.assign(new Error(win.error), { code: win.code, status: win.status });

      // 统一业务流水：treasury_out/prize（session 不绑期次，coin_tx_id = pay 的流水 id）
      db.prepare('INSERT INTO market_ledger (session_id, biz_type, biz_id, op, user_id, counterparty_id, amount, coin_tx_id, idempotency_key, created_at) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('prize', drawId, 'treasury_out', userId, sysId, prize, win.txId, `${prizeKey}:ledger`, nowIso());

      return { prize, cost, net: prize - cost, drawId };
    })();
    return { ok: true, ...r, treasury: systemCoin() };
  } catch (e) {
    if (e && e.status) return { error: e.message, code: e.code, status: e.status };
    throw e;
  }
}

// GET /api/lottery —— 奖池余额（SYSTEM 账户）+ 抽奖配置
router.get('/lottery', (req, res) => {
  res.json({ treasury: systemCoin(), cost: config.lottery.cost, prizes: config.lottery.prizes });
});

// POST /api/lottery/draw —— 抽奖
router.post('/lottery/draw', requireRole('student', 'admin'), (req, res) => {
  const result = drawLottery(req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

export default router;
