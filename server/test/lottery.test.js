import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const { treasuryBalance, addTreasury } = await import('../treasury.js');
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
function coinOf(id) {
  return db.prepare('SELECT coin FROM users WHERE id = ?').get(id).coin;
}

test('奖池不足时拒绝抽奖', () => {
  const u = makeUser(1000);
  const r = drawLottery(u);
  assert.equal(r.status, 409);
});

test('抽奖：花费 cost，奖金从奖池支出', () => {
  addTreasury(1000);
  const u = makeUser(1000);
  const beforeCoin = coinOf(u);
  const beforeTreasury = treasuryBalance();
  const r = drawLottery(u);
  assert.equal(r.error, undefined);
  assert.ok(r.prize >= 0 && r.prize <= Math.max(...config.lottery.prizes));
  assert.equal(coinOf(u), beforeCoin - config.lottery.cost + r.prize);
  assert.equal(treasuryBalance(), beforeTreasury - r.prize);
});
