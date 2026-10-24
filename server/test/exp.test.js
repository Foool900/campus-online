import { test } from 'node:test';
import assert from 'node:assert/strict';

// 用独立内存库跑单测，不污染 server/data/campus.db
process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { grantExp, applyExpRaw } = await import('../exp.js');
const { levelOf } = await import('../config.js');

initDb();

let seq = 0;
function makeUser(exp = 0) {
  seq += 1;
  const info = db
    .prepare(
      "INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机与信息工程学院', '🎓', ?, 0, 0, 'member', ?)"
    )
    .run(`测试用户${seq}`, exp, nowIso());
  return Number(info.lastInsertRowid);
}

function expOf(id) {
  return db.prepare('SELECT exp FROM users WHERE id = ?').get(id).exp;
}

// ============ 经验发放（只发不扣） ============

test('grant：经验累加 + 写流水（source 可追溯）', () => {
  const u = makeUser(100);
  const r = grantExp(u, 15, { source: 'behavior', idempotencyKey: 'k-grant-1' });
  assert.equal(r.ok, true);
  assert.equal(r.duplicate, false);
  assert.equal(r.to.exp, 115);
  assert.equal(expOf(u), 115);

  const tx = db.prepare("SELECT * FROM exp_transactions WHERE idempotency_key = 'k-grant-1'").get();
  assert.equal(tx.type, 'grant');
  assert.equal(tx.source, 'behavior');
  assert.equal(tx.amount, 15);
  assert.equal(tx.to_user_id, u);
});

// ============ 幂等 ============

test('幂等：同一幂等键第二次调用不重复发放', () => {
  const u = makeUser(0);
  const r1 = grantExp(u, 10, { idempotencyKey: 'k-idem-1' });
  const r2 = grantExp(u, 10, { idempotencyKey: 'k-idem-1' });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r2.duplicate, true);
  assert.equal(expOf(u), 10);
  const c = db.prepare("SELECT COUNT(*) AS c FROM exp_transactions WHERE idempotency_key = 'k-idem-1'").get().c;
  assert.equal(c, 1);
});

// ============ 入参校验 ============

test('非法金额：0 / 负数 / 非整数被拒绝', () => {
  const u = makeUser(0);
  for (const amt of [0, -5, 1.5]) {
    const r = grantExp(u, amt, { idempotencyKey: `k-amt-${amt}` });
    assert.equal(r.code, 'EX_INVALID_AMOUNT', `金额 ${amt} 应被拒绝`);
  }
});

test('缺少幂等键被拒绝', () => {
  const u = makeUser(0);
  const r = grantExp(u, 10, {});
  assert.equal(r.code, 'EX_MISSING_IDEMPOTENCY');
});

test('发放到不存在用户被拒绝，且无写入', () => {
  const r = grantExp(999999, 30, { idempotencyKey: 'k-nouser-1' });
  assert.equal(r.code, 'EX_USER_NOT_FOUND');
  const c = db.prepare("SELECT COUNT(*) AS c FROM exp_transactions WHERE idempotency_key = 'k-nouser-1'").get().c;
  assert.equal(c, 0);
});

// ============ 组合（无事务变体） ============

test('applyExpRaw 可在外部 db.transaction 内组合（如任务验收）', () => {
  const u = makeUser(100);
  const r = db.transaction(() => applyExpRaw({ toUserId: u, amount: 10, source: 'behavior', idempotencyKey: 'k-raw-1' }))();
  assert.equal(r.ok, true);
  assert.equal(expOf(u), 110);
});

// ============ 等级纯函数 ============

test('levelOf：floor(exp/100)+1', () => {
  assert.equal(levelOf(0), 1);
  assert.equal(levelOf(99), 1);
  assert.equal(levelOf(100), 2);
  assert.equal(levelOf(250), 3);
});
