import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const {
  applyCoinTransaction,
  applyCoinRaw,
  mintCoin,
  sinkCoin,
  freezeCoin,
  transferCoin,
  refundCoin,
} = await import('../coin.js');

initDb();

let seq = 0;
function makeUser(coin = 0, frozenCoin = 0) {
  seq += 1;
  const info = db
    .prepare(
      "INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', 0, ?, ?, 'member', ?)"
    )
    .run(`测试用户${seq}`, coin, frozenCoin, nowIso());
  return Number(info.lastInsertRowid);
}

function acct(id) {
  return db.prepare('SELECT coin, frozen_coin AS frozenCoin FROM users WHERE id = ?').get(id);
}

// ============ 五种流转类型 ============

test('mint：造币 → coin 增加', () => {
  const u = makeUser(0);
  const r = mintCoin(u, 50, { idempotencyKey: 'c-mint-1' });
  assert.equal(r.ok, true);
  assert.equal(r.to.coin, 50);
  assert.equal(acct(u).coin, 50);
});

test('sink：回收 → coin 减少，不足则拒绝', () => {
  const u = makeUser(100);
  const r = sinkCoin(u, 30, { idempotencyKey: 'c-sink-1' });
  assert.equal(r.from.coin, 70);
  const fail = sinkCoin(u, 999, { idempotencyKey: 'c-sink-2' });
  assert.equal(fail.code, 'COIN_INSUFFICIENT');
  assert.equal(acct(u).coin, 70);
});

test('freeze：coin → frozen_coin', () => {
  const u = makeUser(100, 0);
  const r = freezeCoin(u, 40, { idempotencyKey: 'c-freeze-1' });
  assert.equal(r.from.coin, 60);
  assert.equal(r.from.frozenCoin, 40);
});

test('refund：frozen_coin → coin', () => {
  const u = makeUser(60, 40);
  const r = refundCoin(u, 25, { idempotencyKey: 'c-refund-1' });
  assert.equal(r.from.coin, 85);
  assert.equal(r.from.frozenCoin, 15);
});

test('transfer：发布者 frozen_coin 减，接取者 coin 增', () => {
  const p = makeUser(0, 100);
  const a = makeUser(0, 0);
  const r = transferCoin(p, a, 60, { idempotencyKey: 'c-transfer-1' });
  assert.equal(r.from.frozenCoin, 40);
  assert.equal(r.to.coin, 60);
  assert.equal(acct(p).frozenCoin, 40);
  assert.equal(acct(a).coin, 60);
});

// ============ 幂等 ============

test('幂等：同一幂等键第二次调用不重复划转', () => {
  const u = makeUser(100);
  const opts = { fromUserId: u, amount: 20, type: 'freeze', idempotencyKey: 'c-idem-1' };
  const r1 = applyCoinTransaction(opts);
  const r2 = applyCoinTransaction(opts);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r2.duplicate, true);
  assert.equal(acct(u).coin, 80);
  assert.equal(acct(u).frozenCoin, 20);
});

// ============ 入参校验 ============

test('校验：无效类型 / 金额 / 缺幂等键 / 用户不存在', () => {
  const u = makeUser(10);
  assert.equal(applyCoinTransaction({ toUserId: u, amount: 10, type: 'nope', idempotencyKey: 'c-t1' }).code, 'COIN_INVALID_TYPE');
  assert.equal(applyCoinTransaction({ toUserId: u, amount: 0, type: 'mint', idempotencyKey: 'c-t2' }).code, 'COIN_INVALID_AMOUNT');
  assert.equal(applyCoinTransaction({ toUserId: u, amount: 10, type: 'mint' }).code, 'COIN_MISSING_IDEMPOTENCY');
  assert.equal(applyCoinTransaction({ toUserId: 999999, amount: 10, type: 'mint', idempotencyKey: 'c-t3' }).code, 'COIN_USER_NOT_FOUND');
});

// ============ 组合（无事务变体） ============

test('applyCoinRaw 可在外部 db.transaction 内组合', () => {
  const u = makeUser(100);
  const r = db.transaction(() => applyCoinRaw({ fromUserId: u, amount: 10, type: 'freeze', idempotencyKey: 'c-raw-1' }))();
  assert.equal(r.ok, true);
  assert.equal(acct(u).coin, 90);
  assert.equal(acct(u).frozenCoin, 10);
});
