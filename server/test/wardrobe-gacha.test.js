import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { ensureWardrobe } = await import('../wardrobe.js');
const { listWardrobePools, importWardrobePools, drawWardrobe, ensureWardrobePools } = await import('../wardrobe-gacha.js');

initDb();
ensureWardrobe();
ensureWardrobePools();

let seq = 0;
function makeUser(coin = 0) {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', 0, ?, 0, 'student', ?)")
    .run(`用户${seq}`, coin, nowIso());
  return Number(info.lastInsertRowid);
}
function coinOf(uid) {
  return db.prepare('SELECT coin FROM users WHERE id = ?').get(uid).coin;
}

test('ensureWardrobePools：幂等种子 1 个演示奖池（5 条目）', () => {
  ensureWardrobePools();
  const pools = listWardrobePools(makeUser());
  assert.equal(pools.length, 1);
  assert.equal(pools[0].entryCount, 5);
  assert.equal(pools[0].ownedCount, 0);
});

test('drawWardrobe：扣费 + 装扮入背包（source=gacha）+ 排除已拥有', () => {
  const u = makeUser(1000);
  const pid = listWardrobePools(u)[0].id;

  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    const r = drawWardrobe(u, pid);
    assert.equal(r.ok, true);
    assert.equal(r.item.kind, 'apparel');
    assert.equal(r.item.source, 'gacha');
    assert.ok(r.item.wardrobeItemId > 0);
    seen.add(r.item.wardrobeItemId);
  }
  assert.equal(seen.size, 5); // 排除已拥有 → 不重复
  assert.equal(coinOf(u), 1000 - 5 * 50);

  const again = drawWardrobe(u, pid);
  assert.equal(again.code, 'WARDROBE_POOL_EMPTY');

  const draws = db.prepare('SELECT * FROM wardrobe_gacha_draws WHERE user_id = ?').all(u);
  assert.equal(draws.length, 5);
  assert.ok(draws.every((d) => d.inventory_item_id != null));
});

test('drawWardrobe：余额不足回滚', () => {
  const u = makeUser(10);
  const pid = listWardrobePools(u)[0].id;
  const r = drawWardrobe(u, pid);
  assert.equal(r.code, 'COIN_INSUFFICIENT');
  assert.equal(r.status, 400);
  assert.equal(coinOf(u), 10);
});

test('importWardrobePools：按 code 幂等 upsert + 引用不存在装扮报错', () => {
  const ok = importWardrobePools(1, [{ code: 'p2', name: '测试池', entries: [{ wardrobeCode: 'hat_beanie', weight: 1 }] }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.created.length, 1);

  const bad = importWardrobePools(1, [{ code: 'p3', name: '坏池', entries: [{ wardrobeCode: '不存在', weight: 1 }] }]);
  assert.equal(bad.code, 'WARDROBE_POOL_INVALID');
});
