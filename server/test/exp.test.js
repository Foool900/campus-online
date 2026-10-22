import { test } from 'node:test';
import assert from 'node:assert/strict';

// 用独立内存库跑单测，不污染 server/data/campus.db
process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { applyExpTransaction, applyExpRaw } = await import('../exp.js');
const { levelOf, taskRewardCap, dailyPublishCap } = await import('../config.js');

initDb();

let seq = 0;
function makeUser(overrides = {}) {
  seq += 1;
  const info = db
    .prepare(
      `INSERT INTO users (nickname, college, avatar, exp, available_exp, frozen_exp, role, created_at)
       VALUES (?, '计算机与信息工程学院', '🎓', ?, ?, ?, 'member', ?)`
    )
    .run(
      overrides.nickname ?? `测试用户${seq}`,
      overrides.exp ?? 0,
      overrides.availableExp ?? 0,
      overrides.frozenExp ?? 0,
      nowIso()
    );
  return Number(info.lastInsertRowid);
}

function getAccount(id) {
  return db
    .prepare('SELECT exp AS totalExp, available_exp AS availableExp, frozen_exp AS frozenExp FROM users WHERE id = ?')
    .get(id);
}

// ============ 经验账户与托管事务 ============

test('freeze：available → frozen，totalExp 不变', () => {
  const u = makeUser({ exp: 100, availableExp: 80, frozenExp: 0 });
  const r = applyExpTransaction({ fromUserId: u, amount: 30, type: 'freeze', idempotencyKey: 'k-freeze-1' });
  assert.equal(r.ok, true);
  assert.equal(r.duplicate, false);
  assert.equal(r.from.totalExp, 100);
  assert.equal(r.from.availableExp, 50);
  assert.equal(r.from.frozenExp, 30);
});

test('freeze：可用经验不足返回明确错误码，字段不变', () => {
  const u = makeUser({ exp: 100, availableExp: 10, frozenExp: 0 });
  const r = applyExpTransaction({ fromUserId: u, amount: 30, type: 'freeze', idempotencyKey: 'k-freeze-2' });
  assert.equal(r.code, 'EX_INSUFFICIENT_AVAILABLE');
  assert.equal(r.error, '可用经验不足');
  const a = getAccount(u);
  assert.equal(a.availableExp, 10);
  assert.equal(a.frozenExp, 0);
  assert.equal(a.totalExp, 100);
});

test('transfer：发布者 frozen 减，接取者 available + total 增', () => {
  const p = makeUser({ exp: 100, availableExp: 20, frozenExp: 50 });
  const a = makeUser({ exp: 10, availableExp: 5, frozenExp: 0 });
  const r = applyExpTransaction({ fromUserId: p, toUserId: a, amount: 30, type: 'transfer', idempotencyKey: 'k-transfer-1' });
  assert.equal(r.ok, true);
  assert.equal(r.from.frozenExp, 20);
  assert.equal(r.from.totalExp, 100); // 发布者 total 不变
  assert.equal(r.to.totalExp, 40); // 10 + 30
  assert.equal(r.to.availableExp, 35); // 5 + 30
});

test('refund：frozen → available，totalExp 不变', () => {
  const p = makeUser({ exp: 100, availableExp: 20, frozenExp: 50 });
  const r = applyExpTransaction({ fromUserId: p, amount: 30, type: 'refund', idempotencyKey: 'k-refund-1' });
  assert.equal(r.ok, true);
  assert.equal(r.from.frozenExp, 20);
  assert.equal(r.from.availableExp, 50);
  assert.equal(r.from.totalExp, 100);
});

test('grant：available + total 同时增', () => {
  const u = makeUser({ exp: 100, availableExp: 20, frozenExp: 0 });
  const r = applyExpTransaction({ toUserId: u, amount: 15, type: 'grant', idempotencyKey: 'k-grant-1' });
  assert.equal(r.ok, true);
  assert.equal(r.to.totalExp, 115);
  assert.equal(r.to.availableExp, 35);
});

// ============ 幂等 ============

test('幂等：同一幂等键第二次调用不重复划转', () => {
  const u = makeUser({ exp: 100, availableExp: 50, frozenExp: 0 });
  const opts = { fromUserId: u, amount: 20, type: 'freeze', idempotencyKey: 'k-idem-1' };
  const r1 = applyExpTransaction(opts);
  const r2 = applyExpTransaction(opts);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r2.duplicate, true);
  const a = getAccount(u);
  assert.equal(a.availableExp, 30); // 只冻结一次
  assert.equal(a.frozenExp, 20);
  const c = db.prepare("SELECT COUNT(*) AS c FROM exp_transactions WHERE idempotency_key = 'k-idem-1'").get().c;
  assert.equal(c, 1);
});

test('幂等：同一幂等键即使换 type 也拦截', () => {
  const u = makeUser({ exp: 100, availableExp: 50, frozenExp: 0 });
  applyExpTransaction({ fromUserId: u, amount: 10, type: 'freeze', idempotencyKey: 'k-idem-2' });
  const r = applyExpTransaction({ fromUserId: u, amount: 10, type: 'refund', idempotencyKey: 'k-idem-2' });
  assert.equal(r.ok, true);
  assert.equal(r.duplicate, true);
  const a = getAccount(u);
  assert.equal(a.frozenExp, 10); // refund 未生效
  assert.equal(a.availableExp, 40);
});

// ============ 入参校验 ============

test('非法金额：0 / 负数 / 非整数被拒绝', () => {
  const u = makeUser({ exp: 100, availableExp: 50, frozenExp: 0 });
  for (const amt of [0, -5, 1.5]) {
    const r = applyExpTransaction({ fromUserId: u, amount: amt, type: 'freeze', idempotencyKey: `k-amt-${amt}` });
    assert.equal(r.code, 'EX_INVALID_AMOUNT', `金额 ${amt} 应被拒绝`);
  }
});

test('无效流转类型被拒绝', () => {
  const u = makeUser({});
  const r = applyExpTransaction({ toUserId: u, amount: 10, type: 'nope', idempotencyKey: 'k-type-1' });
  assert.equal(r.code, 'EX_INVALID_TYPE');
});

test('缺少幂等键被拒绝', () => {
  const u = makeUser({});
  const r = applyExpTransaction({ toUserId: u, amount: 10, type: 'grant' });
  assert.equal(r.code, 'EX_MISSING_IDEMPOTENCY');
});

test('transfer 到不存在用户被拒绝，且无部分写入', () => {
  const p = makeUser({ exp: 100, availableExp: 20, frozenExp: 50 });
  const r = applyExpTransaction({ fromUserId: p, toUserId: 999999, amount: 30, type: 'transfer', idempotencyKey: 'k-nouser-1' });
  assert.equal(r.code, 'EX_USER_NOT_FOUND');
  const a = getAccount(p);
  assert.equal(a.frozenExp, 50); // 未扣
  assert.equal(a.availableExp, 20);
});

// ============ 组合（无事务变体） ============

test('applyExpRaw 可在外部 db.transaction 内组合（如 todos 完成）', () => {
  const u = makeUser({ exp: 100, availableExp: 50, frozenExp: 0 });
  const r = db.transaction(() =>
    applyExpRaw({ toUserId: u, amount: 10, type: 'grant', idempotencyKey: 'k-raw-1' })
  )();
  assert.equal(r.ok, true);
  assert.equal(getAccount(u).totalExp, 110);
  assert.equal(getAccount(u).availableExp, 60);
});

// ============ 配置纯函数 ============

test('taskRewardCap = min(availableExp × 20%, 500)', () => {
  assert.equal(taskRewardCap(100), 20);
  assert.equal(taskRewardCap(2000), 400);
  assert.equal(taskRewardCap(10000), 500);
});

test('dailyPublishCap 按等级分档（越界取边界档）', () => {
  assert.equal(dailyPublishCap(1), 200);
  assert.equal(dailyPublishCap(5), 200);
  assert.equal(dailyPublishCap(6), 500);
  assert.equal(dailyPublishCap(10), 500);
  assert.equal(dailyPublishCap(12), 500);
});

test('levelOf：floor(exp/100)+1', () => {
  assert.equal(levelOf(0), 1);
  assert.equal(levelOf(99), 1);
  assert.equal(levelOf(100), 2);
  assert.equal(levelOf(250), 3);
});
