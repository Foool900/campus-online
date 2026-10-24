import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const {
  createSession, createItem, listItem, buyItem, openBlindbox, createDispute, broadcast, grabStall, confirmStall,
} = await import('../routes/market.js');

initDb();

let seq = 0;
function makeUser(coin = 0) {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', 0, ?, 0, 'student', ?)")
    .run(`用户${seq}`, coin, nowIso());
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
function listedItem(seller, sid, stallId, opts = {}) {
  const r = createItem(seller, { sessionId: sid, title: opts.title || '商品', priceCoin: opts.price ?? 100, type: opts.type || 'normal' });
  assert.equal(r.error, undefined);
  assert.equal(listItem(seller, r.itemId, { stallId }).error, undefined);
  return r.itemId;
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
function countFor(userId) {
  const d = new Date();
  const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return db.prepare('SELECT count FROM report_counters WHERE user_id=? AND month_key=?').get(userId, mk)?.count ?? 0;
}
// 造 n 个 draft 商品，返回 itemId 数组（保证 market_disputes.item_id 外键有效）
function makeItems(seller, sid, n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = createItem(seller, { sessionId: sid, title: `商品${i}`, priceCoin: 10 });
    assert.equal(r.error, undefined);
    ids.push(r.itemId);
  }
  return ids;
}

test('a: 月次数达到 reportMonthlyLimit 后再举报 → 429', () => {
  const sid = openSession();
  const seller = makeUser();
  const reporter = makeUser();
  const items = makeItems(seller, sid, 4);

  assert.equal(createDispute(reporter, { itemId: items[0], reason: 'r1' }).error, undefined);
  assert.equal(createDispute(reporter, { itemId: items[1], reason: 'r2' }).error, undefined);
  assert.equal(createDispute(reporter, { itemId: items[2], reason: 'r3' }).error, undefined);
  const r = createDispute(reporter, { itemId: items[3], reason: 'r4' });
  assert.equal(r.code, 'REPORT_LIMIT_EXCEEDED');
  assert.equal(r.status, 429);
  assert.equal(countFor(reporter), config.market.reportMonthlyLimit); // 仍停在 3
});

test('b: 跨月重置（注入时钟改 month_key），下月重新计数', () => {
  const sid = openSession();
  const seller = makeUser();
  const reporter = makeUser();
  const items = makeItems(seller, sid, 5);

  createDispute(reporter, { itemId: items[0], reason: 'r1' });
  createDispute(reporter, { itemId: items[1], reason: 'r2' });
  createDispute(reporter, { itemId: items[2], reason: 'r3' });
  assert.equal(createDispute(reporter, { itemId: items[3], reason: 'r4' }).code, 'REPORT_LIMIT_EXCEEDED');

  // 注入时钟：把本月计数移到上个月，模拟跨月
  db.prepare('UPDATE report_counters SET month_key=? WHERE user_id=?').run('1999-01', reporter);
  const r = createDispute(reporter, { itemId: items[4], reason: 'r5' });
  assert.equal(r.error, undefined); // 下月重新计数
  assert.equal(countFor(reporter), 1);
});

test('c: 盲盒开盒 24h 内成功，24h 后 REPORT_WINDOW_EXPIRED', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);

  const o1 = openedBlindboxOrder(buyer, seller, sid, stallId);
  assert.equal(createDispute(buyer, { orderId: o1, reason: '货不对板' }).error, undefined);

  const o2 = openedBlindboxOrder(buyer, seller, sid, stallId);
  db.prepare('UPDATE market_blindbox_opens SET opened_at=? WHERE order_id=?')
    .run(new Date(Date.now() - 25 * 3600000).toISOString(), o2);
  const r = createDispute(buyer, { orderId: o2, reason: '货不对板' });
  assert.equal(r.code, 'REPORT_WINDOW_EXPIRED');
  assert.equal(r.status, 400);
});

test('d: 普通订单举报不受 24h 限制', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);
  const itemId = listedItem(seller, sid, stallId, { price: 100 });
  const b = buyItem(buyer, itemId);
  assert.equal(b.error, undefined);
  assert.equal(createDispute(buyer, { orderId: b.orderId, reason: '普通商品举报' }).error, undefined);
});

test('e: item_id 举报不受 24h 限制', () => {
  const sid = openSession();
  const seller = makeUser();
  const u = makeUser();
  const item = makeItems(seller, sid, 1)[0];
  assert.equal(createDispute(u, { itemId: item, reason: '纯商品举报' }).error, undefined);
});

test('f: 敏感词命中 400，不命中正常入库', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const stallId = occupiedStall(seller, sid);

  const bad = createItem(seller, { sessionId: sid, title: '傻逼二手书', priceCoin: 10 });
  assert.equal(bad.code, 'SENSITIVE_CONTENT');
  assert.equal(bad.status, 400);
  const good = createItem(seller, { sessionId: sid, title: '二手书', priceCoin: 10 });
  assert.equal(good.error, undefined);

  assert.equal(broadcast(seller, sid, '加微信私聊').code, 'SENSITIVE_CONTENT');
  assert.equal(broadcast(seller, sid, '开摊啦').error, undefined);

  assert.equal(createDispute(seller, { itemId: 1, reason: '对方要求先打款' }).code, 'SENSITIVE_CONTENT');
});

test('g: 重复举报同一对象（report_key 冲突）不消耗月计数', () => {
  const sid = openSession();
  const seller = makeUser();
  const u = makeUser();
  const item = makeItems(seller, sid, 1)[0];

  assert.equal(createDispute(u, { itemId: item, reason: 'r1' }).error, undefined);
  assert.equal(countFor(u), 1);
  const dup = createDispute(u, { itemId: item, reason: 'r1 again' });
  assert.equal(dup.status, 409); // report_key 冲突
  assert.equal(countFor(u), 1); // 计数不增加
});

test('h: createItem 敏感词覆盖 contentJson（对象/字符串/JSON，url 不误伤）', () => {
  const sid = openSession();
  const seller = makeUser(1000);

  // a. 对象含违规词
  const a = createItem(seller, { sessionId: sid, title: '盲盒', priceCoin: 10, type: 'blindbox', contentJson: { text: '刷单' } });
  assert.equal(a.code, 'SENSITIVE_CONTENT'); assert.equal(a.status, 400);
  // b. 纯文本字符串含违规词（parse 失败回退整体查）
  const b = createItem(seller, { sessionId: sid, title: '盲盒', priceCoin: 10, type: 'blindbox', contentJson: '刷单' });
  assert.equal(b.code, 'SENSITIVE_CONTENT'); assert.equal(b.status, 400);
  // c. JSON 字符串含违规词（parse 成功查 .text）
  const c = createItem(seller, { sessionId: sid, title: '盲盒', priceCoin: 10, type: 'blindbox', contentJson: '{"text":"刷单"}' });
  assert.equal(c.code, 'SENSITIVE_CONTENT'); assert.equal(c.status, 400);
  // d. url 不误伤（只查 .text，url 里的「加微信」不触发）
  assert.equal(createItem(seller, { sessionId: sid, title: '盲盒', priceCoin: 10, type: 'blindbox', contentJson: { text: '正常内容', url: 'xxx加微信.png' } }).error, undefined);
  // e. null 正常通过
  assert.equal(createItem(seller, { sessionId: sid, title: '盲盒', priceCoin: 10, type: 'blindbox', contentJson: null }).error, undefined);
});
