import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const { systemAccountId } = await import('../treasury.js');
const { applyCoinRaw } = await import('../coin.js');
const { drawLottery } = await import('../routes/lottery.js');

initDb();

let seq = 0;
function makeUser(coin = 0) {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', 0, ?, 0, 'student', ?)")
    .run(`用户${seq}`, coin, nowIso());
  return Number(info.lastInsertRowid);
}
function acct(id) {
  return db.prepare('SELECT coin, frozen_coin AS frozenCoin FROM users WHERE id=?').get(id);
}
function sysCoin() {
  return db.prepare('SELECT coin FROM users WHERE id=?').get(systemAccountId()).coin;
}
function totalCoin() {
  return db.prepare('SELECT COALESCE(SUM(coin),0) + COALESCE(SUM(frozen_coin),0) AS t FROM users').get().t;
}
// 测试专用：直接设定 SYSTEM 账户余额（SYSTEM 不参与交易，frozen 恒 0）
function setSystemCoin(amount) {
  db.prepare('UPDATE users SET coin=?, frozen_coin=0 WHERE id=?').run(amount, systemAccountId());
}

test('b: SYSTEM 余额 < minPrize → 409，不落 lottery_draws，不扣 cost', () => {
  setSystemCoin(0);
  const user = makeUser(1000);
  const beforeDraws = db.prepare('SELECT COUNT(*) AS c FROM lottery_draws').get().c;
  const r = drawLottery(user);
  assert.equal(r.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM lottery_draws').get().c, beforeDraws);
  assert.equal(acct(user).coin, 1000);
});

test('a: 中奖者 +prize、SYSTEM −prize、总金币 −cost（真实划转，无销毁/铸造的 prize）', () => {
  setSystemCoin(1000);
  const user = makeUser(1000);
  const sysBefore = sysCoin();
  const totalBefore = totalCoin();

  const r = drawLottery(user);
  assert.equal(r.error, undefined);
  assert.ok(r.prize >= 5 && r.prize <= 200);
  assert.equal(acct(user).coin, 1000 - config.lottery.cost + r.prize); // 中奖者 +prize，扣 cost
  assert.equal(sysCoin(), sysBefore - r.prize); // SYSTEM −prize
  assert.equal(totalCoin(), totalBefore - config.lottery.cost); // 只有 cost 被 sink 销毁，prize 守恒
});

test('c: SYSTEM 余额只够小奖 → prize clamp 到 SYSTEM 余额，lottery_draws 记实际值', () => {
  setSystemCoin(30);
  const user = makeUser(1000);
  const r = drawLottery(user);
  assert.equal(r.error, undefined);
  assert.ok(r.prize >= 5 && r.prize <= 30); // clamp 到 30
  assert.equal(db.prepare('SELECT prize_coin FROM lottery_draws WHERE id=?').get(r.drawId).prize_coin, r.prize);
});

test('d: 同一 draw_id 的 pay 幂等键重放，不重复付', () => {
  setSystemCoin(1000);
  const user = makeUser(1000);
  const key = 'lottery_prize:999999';
  const r1 = applyCoinRaw({ fromUserId: systemAccountId(), toUserId: user, amount: 10, type: 'pay', relatedType: 'lottery', relatedId: 999999, idempotencyKey: key });
  const r2 = applyCoinRaw({ fromUserId: systemAccountId(), toUserId: user, amount: 10, type: 'pay', relatedType: 'lottery', relatedId: 999999, idempotencyKey: key });
  assert.equal(r1.ok, true);
  assert.equal(r2.duplicate, true); // 第二次返回首次结果
  assert.equal(acct(user).coin, 1000 + 10); // 只付一次
});

test('e: 真实余额不足回滚 —— pay COIN_INSUFFICIENT（coin.js 层）+ sink 失败回滚 lottery_draws', () => {
  // e1: pay 真实 COIN_INSUFFICIENT。注：drawLottery 内 prize 已 clamp 到 pool，pay 不会不足；
  // 此处直接调 pay 验证「SYSTEM 余额 < amount」时返回 COIN_INSUFFICIENT（真实扣款校验）。
  setSystemCoin(5);
  const u1 = makeUser(1000);
  const payR = applyCoinRaw({ fromUserId: systemAccountId(), toUserId: u1, amount: 200, type: 'pay', relatedType: 'lottery', idempotencyKey: 'lottery_prize:888888' });
  assert.equal(payR.code, 'COIN_INSUFFICIENT');

  // e2: drawLottery 里 sink(cost) 余额不足 → lottery_draws + sink 整体回滚（真实余额不足）
  setSystemCoin(1000);
  const u2 = makeUser(10); // 10 < cost 50
  const beforeDraws = db.prepare('SELECT COUNT(*) AS c FROM lottery_draws').get().c;
  const sysBefore = sysCoin();
  const r = drawLottery(u2);
  assert.equal(r.code, 'COIN_INSUFFICIENT'); // sink 失败
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM lottery_draws').get().c, beforeDraws); // lottery_draws 回滚
  assert.equal(acct(u2).coin, 10); // 未扣
  assert.equal(sysCoin(), sysBefore); // SYSTEM 未变
});
