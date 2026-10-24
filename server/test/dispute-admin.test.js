import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const {
  createSession, createItem, listItem, buyItem, openBlindbox, createDispute, resolveDispute,
  grabStall, confirmStall, listAdminDisputes,
} = await import('../routes/market.js');

initDb();

let seq = 0;
function makeUser(coin = 0, role = 'student') {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', 0, ?, 0, ?, ?)")
    .run(`用户${seq}`, coin, role, nowIso());
  return Number(info.lastInsertRowid);
}
function openSession() {
  const r = createSession(new Date(Date.now() + 3600000).toISOString());
  const sid = r.session.id;
  db.prepare("UPDATE market_sessions SET status='open' WHERE id=?").run(sid);
  return sid;
}
function occupiedStall(uid, sid) {
  const g = grabStall(uid, sid);
  assert.equal(g.error, undefined);
  assert.equal(confirmStall(uid, g.stallId).error, undefined);
  return g.stallId;
}
function openedBlindboxOrder(buyer, seller, sid, stallId) {
  const r = createItem(seller, { sessionId: sid, title: '盲盒', priceCoin: 100, type: 'blindbox' });
  assert.equal(r.error, undefined);
  assert.equal(listItem(seller, r.itemId, { stallId }).error, undefined);
  const b = buyItem(buyer, r.itemId);
  assert.equal(b.error, undefined);
  assert.equal(openBlindbox(buyer, b.orderId).error, undefined);
  return b.orderId;
}

test('listAdminDisputes: 返回全部纠纷，附举报方/卖家/商品，status 过滤生效', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);

  const o1 = openedBlindboxOrder(buyer, seller, sid, stallId);
  const o2 = openedBlindboxOrder(buyer, seller, sid, stallId);
  assert.equal(createDispute(buyer, { orderId: o1, reason: '货不对板' }).error, undefined);
  assert.equal(createDispute(buyer, { orderId: o2, reason: '与描述不符' }).error, undefined);

  const all = listAdminDisputes();
  assert.equal(all.length, 2);

  const d = all.find((x) => x.orderId === o1);
  assert.equal(d.status, 'pending');
  assert.equal(d.reason, '货不对板');
  assert.equal(d.reporter.nickname, '用户2'); // buyer
  assert.equal(d.seller.nickname, '用户1'); // seller
  assert.equal(d.buyer.id, buyer);
  assert.equal(d.itemTitle, '盲盒');

  // status 过滤：pending 两条都在；dismissed 空
  const pending = listAdminDisputes('pending');
  assert.equal(pending.length, 2);
  assert.equal(listAdminDisputes('resolved_buyer').length, 0);
});

test('listAdminDisputes: resolveDispute 判定后 status 变更，pending 过滤不再包含', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const admin = makeUser(0, 'admin');
  const stallId = occupiedStall(seller, sid);

  const o1 = openedBlindboxOrder(buyer, seller, sid, stallId);
  assert.equal(createDispute(buyer, { orderId: o1, reason: '货不对板' }).error, undefined);
  const disputeId = db.prepare('SELECT id FROM market_disputes WHERE order_id=?').get(o1).id;

  assert.equal(resolveDispute(admin, disputeId, 'resolved_buyer').error, undefined);

  // 判定后该纠纷离开 pending、进入 resolved_buyer（用 id 定位，避免同文件其他用例的全局数据干扰）
  assert.equal(listAdminDisputes('pending').some((d) => d.id === disputeId), false);
  const resolved = listAdminDisputes('resolved_buyer').find((d) => d.id === disputeId);
  assert.ok(resolved);
  assert.equal(resolved.status, 'resolved_buyer');
  assert.equal(resolved.resolvedAt, db.prepare('SELECT resolved_at FROM market_disputes WHERE id=?').get(disputeId).resolved_at);
});
