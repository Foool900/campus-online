import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { ensureSystemAccount, systemAccountId } = await import('../treasury.js');
const { payCoin } = await import('../coin.js');
const { createItem, bidShop, createBargain, buyItem } = await import('../routes/market.js');

initDb();

test('ensureSystemAccount：创建 SYSTEM（role=system），幂等', () => {
  const id1 = ensureSystemAccount();
  const id2 = ensureSystemAccount();
  assert.equal(id1, id2);
  const sys = db.prepare('SELECT * FROM users WHERE id=?').get(id1);
  assert.equal(sys.nickname, 'SYS');
  assert.equal(sys.role, 'system');
});

test('pay 可划给 SYSTEM（accountOf 能查到它）', () => {
  const sysId = systemAccountId();
  const u = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES ('u', '', '🎓', 0, 100, 0, 'member', ?)")
    .run(nowIso());
  const uid = Number(u.lastInsertRowid);
  const r = payCoin(uid, sysId, 30, { idempotencyKey: 'sys-pay-1' });
  assert.equal(r.error, undefined);
  assert.equal(db.prepare('SELECT coin FROM users WHERE id=?').get(sysId).coin, 30);
  assert.equal(db.prepare('SELECT coin FROM users WHERE id=?').get(uid).coin, 70);
});

test('SYSTEM 不能挂单/参拍/砍价/购买', () => {
  const sysId = systemAccountId();
  assert.equal(createItem(sysId, { sessionId: 1, title: 'x', priceCoin: 10 }).status, 403);
  assert.equal(bidShop(sysId, 1, '2026-W01', 100).status, 403);
  assert.equal(createBargain(sysId, 1, 50).status, 403);
  assert.equal(buyItem(sysId, 1).status, 403);
});
