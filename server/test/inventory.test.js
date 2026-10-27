import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { showcaseSlots } = await import('../config.js');
const {
  grantInventoryItem,
  grantStarterPack,
  listMyInventory,
  setShowcaseItem,
  removeShowcaseItem,
  sellInventoryItem,
  unlistInventoryItem,
  listPublicShowcase,
  listUserShowcase,
} = await import('../inventory.js');
const { createSession, createItem, listItem, buyItem, confirmOrder, settleSession, grabStall, confirmStall } = await import('../routes/market.js');
const { ensureWardrobe } = await import('../wardrobe.js');

initDb();
ensureWardrobe(); // 新手礼包含装扮，需先种子图鉴模板

let seq = 0;
function makeUser(coin = 0, exp = 0) {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', ?, ?, 0, 'student', ?)")
    .run(`用户${seq}`, exp, coin, nowIso());
  return Number(info.lastInsertRowid);
}
function openSession() {
  const r = createSession(new Date(Date.now() + 3600000).toISOString());
  const sid = r.session.id;
  db.prepare("UPDATE market_sessions SET status='open' WHERE id=?").run(sid);
  return sid;
}
function itemRow(id) {
  return db.prepare('SELECT * FROM inventory_items WHERE id=?').get(id);
}

// ============ 新手礼包 ============

test('新手礼包：发 4 件（含 1 件装扮）、幂等不重复', () => {
  const u = makeUser();
  const r1 = grantStarterPack(u);
  assert.equal(r1.ok, true);
  const inv = listMyInventory(u);
  assert.equal(inv.items.length, 4);
  assert.ok(inv.items.every((i) => i.status === 'held' && i.source === 'seed'));
  assert.equal(inv.items.filter((i) => i.kind === 'apparel').length, 1);

  const r2 = grantStarterPack(u);
  assert.equal(r2.duplicate, true);
  assert.equal(listMyInventory(u).items.length, 4); // 不重复发
});

// ============ 橱窗（等级解锁展览位） ============

test('橱窗：放入 / 移出 / 超位拒绝 / 换位清空旧物品', () => {
  const u = makeUser(0, 0); // level 1 → 3 位
  grantStarterPack(u);
  const inv = listMyInventory(u);
  assert.equal(inv.maxShowcaseSlots, showcaseSlots(1));
  assert.equal(showcaseSlots(1), 3);

  const a = inv.items[0].id;
  const b = inv.items[1].id;

  assert.equal(setShowcaseItem(u, a, 0).ok, true);
  assert.equal(itemRow(a).showcase_slot, 0);
  assert.equal(listMyInventory(u).showcase.length, 1);

  // 超位拒绝
  const over = setShowcaseItem(u, b, 3);
  assert.equal(over.status, 400);

  // 换位：把 b 放到已占的 0 位，a 被清空
  assert.equal(setShowcaseItem(u, b, 0).ok, true);
  assert.equal(itemRow(a).showcase_slot, null);
  assert.equal(itemRow(b).showcase_slot, 0);

  assert.equal(removeShowcaseItem(u, b).ok, true);
  assert.equal(itemRow(b).showcase_slot, null);
});

// ============ 开市寄售 / 下架 ============

test('出售：未开市拒绝，开市可挂牌，下架回 held', () => {
  const u = makeUser();
  grantStarterPack(u);
  const inv = listMyInventory(u);
  const itemId = inv.items[0].id;

  const closed = sellInventoryItem(u, itemId, 100);
  assert.equal(closed.code, 'MARKET_CLOSED');

  const sid = openSession();
  const s = sellInventoryItem(u, itemId, 100);
  assert.equal(s.error, undefined);
  assert.equal(itemRow(itemId).status, 'listed');
  assert.equal(itemRow(itemId).list_price_coin, 100);
  const listing = db.prepare('SELECT * FROM market_items WHERE inventory_item_id=?').get(itemId);
  assert.ok(listing);
  assert.equal(listing.status, 'active');
  assert.equal(listing.stock, 1);

  const u2 = unlistInventoryItem(u, itemId);
  assert.equal(u2.ok, true);
  assert.equal(itemRow(itemId).status, 'held');
});

// ============ 背包寄售闭环：卖 → 买 → 确认 → 物品转移 ============

test('闭环：背包寄售成交后物品转给买家，卖家收金币', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  grantStarterPack(seller);
  const itemId = listMyInventory(seller).items[0].id;

  assert.equal(sellInventoryItem(seller, itemId, 120).error, undefined);

  const b = buyItem(buyer, db.prepare('SELECT id FROM market_items WHERE inventory_item_id=?').get(itemId).id);
  assert.equal(b.error, undefined);

  const c = confirmOrder(buyer, b.orderId);
  assert.equal(c.error, undefined);

  assert.equal(itemRow(itemId).owner_id, buyer); // 所有权转移
  assert.equal(itemRow(itemId).status, 'held');
  assert.equal(itemRow(itemId).source, 'market');
  assert.ok(itemRow(itemId).sold_price_coin === 120);
  assert.equal(listMyInventory(buyer).items.some((i) => i.id === itemId), true);
});

// ============ 市场自营商品成交 → 买家获得新物品 ============

test('市场自营商品成交：买家获得新背包物品（source=market）', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = grabStall(seller, sid).stallId;
  confirmStall(seller, stallId);

  const c = createItem(seller, { sessionId: sid, title: '手办', priceCoin: 80, icon: '🧸', rarity: 'rare' });
  assert.equal(listItem(seller, c.itemId, { stallId }).error, undefined);

  const b = buyItem(buyer, c.itemId);
  assert.equal(confirmOrder(buyer, b.orderId).error, undefined);

  const buyerInv = listMyInventory(buyer).items.filter((i) => i.source === 'market');
  assert.equal(buyerInv.length, 1);
  assert.equal(buyerInv[0].name, '手办');
  assert.equal(buyerInv[0].icon, '🧸');
  assert.equal(buyerInv[0].rarity, 'rare');
});

// ============ 橱窗广场（公开） ============

test('橱窗广场：只含正在展览的物品，可查某人橱窗', () => {
  const a = makeUser();
  const b = makeUser();
  grantStarterPack(a);
  grantStarterPack(b);

  const aItem = listMyInventory(a).items[0].id;
  setShowcaseItem(a, aItem, 0);

  const pub = listPublicShowcase();
  assert.equal(pub.length, 1);
  assert.equal(pub[0].ownerId, a);
  assert.ok(pub[0].ownerName);

  const ua = listUserShowcase(a);
  assert.equal(ua.user.id, a);
  assert.equal(ua.items.length, 1);
  assert.equal(listUserShowcase(b).items.length, 0);
});

// ============ 期次结算：挂牌物品退回 ============

test('期次结算：挂牌未成交的背包物品退回 held', () => {
  const u = makeUser();
  grantStarterPack(u);
  const itemId = listMyInventory(u).items[0].id;

  const sid = openSession();
  assert.equal(sellInventoryItem(u, itemId, 100).error, undefined);
  assert.equal(itemRow(itemId).status, 'listed');

  const st = settleSession(sid);
  assert.equal(st.error, undefined);
  assert.equal(itemRow(itemId).status, 'held');
  assert.equal(itemRow(itemId).listed_session_id, null);
});

// ============ 单物品入库入口 ============

test('grantInventoryItem：非法名称 / 非法稀有度回退', () => {
  const u = makeUser();
  assert.equal(grantInventoryItem(u, { name: '  ' }).status, 400);
  const r = grantInventoryItem(u, { name: '测试物', rarity: '不存在的稀有度' });
  assert.equal(r.ok, true);
  assert.equal(r.item.rarity, 'common'); // 非法稀有度回退 common
});
