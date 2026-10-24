import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { config } from '../config.js';
import { applyCoinRaw } from '../coin.js';

const router = Router();

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return fmtDate(d);
}

// 连击奖励：base + 每连续一天 +streakBonus，封顶 streakMaxBonus
export function rewardFor(streak) {
  const { base, streakBonus, streakMaxBonus } = config.signin;
  return base + Math.min((streak - 1) * streakBonus, streakMaxBonus);
}

// 当前签到状态（未签到也返回「即将获得」的连击与奖励）
export function signinStatus(userId) {
  const today = dayOffset(0);
  const yesterday = dayOffset(-1);
  const t = db.prepare('SELECT * FROM sign_ins WHERE user_id = ? AND date = ?').get(userId, today);
  const y = db.prepare('SELECT * FROM sign_ins WHERE user_id = ? AND date = ?').get(userId, yesterday);

  const signedToday = !!t;
  const streak = t ? t.streak : (y ? y.streak : 0);
  const nextStreak = t ? t.streak : (y ? y.streak + 1 : 1);
  const recent = db
    .prepare('SELECT date FROM sign_ins WHERE user_id = ? ORDER BY date DESC LIMIT 7')
    .all(userId)
    .map((r) => r.date);

  return { signedToday, streak, reward: rewardFor(nextStreak), recent };
}

// 签到：写入记录 + 发金币（幂等，重复签到不重复发）
export function claimSignin(userId) {
  const today = dayOffset(0);
  const existing = db.prepare('SELECT * FROM sign_ins WHERE user_id = ? AND date = ?').get(userId, today);
  if (existing) {
    const u = db.prepare('SELECT coin FROM users WHERE id = ?').get(userId);
    return { already: true, streak: existing.streak, reward: existing.reward_coin, coin: u.coin };
  }

  const yesterday = dayOffset(-1);
  const y = db.prepare('SELECT * FROM sign_ins WHERE user_id = ? AND date = ?').get(userId, yesterday);
  const streak = y ? y.streak + 1 : 1;
  const reward = rewardFor(streak);

  const result = db.transaction(() => {
    db.prepare('INSERT INTO sign_ins (user_id, date, streak, reward_coin, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, today, streak, reward, nowIso());
    const coin = applyCoinRaw({
      toUserId: userId,
      amount: reward,
      type: 'mint',
      relatedType: 'signin',
      note: `每日签到第 ${streak} 天`,
      idempotencyKey: `signin:${userId}:${today}`,
    });
    if (coin.error) {
      const e = new Error(coin.error);
      e.code = coin.code;
      e.status = coin.status;
      throw e;
    }
    return coin;
  })();

  return { already: false, streak, reward, coin: result.to.coin };
}

// GET /api/signin —— 签到状态
router.get('/signin', (req, res) => {
  res.json(signinStatus(req.user.id));
});

// POST /api/signin —— 签到领金币
router.post('/signin', (req, res) => {
  try {
    res.json(claimSignin(req.user.id));
  } catch (e) {
    // 只透传 4xx 业务错误（含 code）；未知错误交给全局 errorHandler 兜底 500，不泄露内部信息
    if (e && Number.isInteger(e.status) && e.status >= 400 && e.status < 500) {
      return res.status(e.status).json({ error: e.message || '签到失败', ...(e.code ? { code: e.code } : {}) });
    }
    throw e;
  }
});

export default router;
