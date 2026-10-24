import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { isoWeekOf, auctionTerm, ensureMarketShops, bidShop, listShops } = await import('../routes/market.js');
const { db, initDb, nowIso } = await import('../db.js');

initDb();
ensureMarketShops();

let seq = 0;
function makeUser(coin = 0) {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', 0, ?, 0, 'student', ?)")
    .run(`用户${seq}`, coin, nowIso());
  return Number(info.lastInsertRowid);
}
function shopByNo(no) {
  return db.prepare('SELECT * FROM market_shops WHERE shop_no=?').get(no);
}

test('isoWeekOf：跨年边界（2026 有 53 周）', () => {
  assert.equal(isoWeekOf(new Date('2026-12-28T00:00:00Z')), '2026-W53'); // 周一，仍在上一年的第 53 周
  assert.equal(isoWeekOf(new Date('2027-01-01T00:00:00Z')), '2026-W53'); // 1 月 1 日落在上一年最后一周
  assert.equal(isoWeekOf(new Date('2027-01-04T00:00:00Z')), '2027-W01'); // 新 ISO 年首个周一
  assert.equal(isoWeekOf(new Date('2025-12-29T00:00:00Z')), '2026-W01'); // 12 月底落在下一年第 1 周
});

test('auctionTerm：周一 00:00 整返回下一周，而非当天（严格未来）', () => {
  assert.deepEqual(auctionTerm(new Date('2026-10-26T00:00:00.000Z')), {
    termWeek: '2026-W45',
    deadlineAt: '2026-11-02T00:00:00.000Z',
  });
  // 非边界：周六应指向下一个周一所在周
  assert.deepEqual(auctionTerm(new Date('2026-10-24T12:00:00Z')), {
    termWeek: '2026-W44',
    deadlineAt: '2026-10-26T00:00:00.000Z',
  });
});

test('listShops：5 店 + 当期最高价/我的出价/截止时间，未出价店 term=null', () => {
  const user = makeUser(500);
  const shop = shopByNo(1);
  const { termWeek } = auctionTerm();
  bidShop(user, shop.id, termWeek, 200);

  const r = listShops(user);
  assert.equal(r.shops.length, 5);
  assert.equal(r.termWeek, termWeek);
  assert.ok(r.deadlineAt);
  assert.ok(r.serverTime);

  const s = r.shops.find((x) => x.id === shop.id);
  assert.equal(s.highestBid, 200);
  assert.equal(s.myBid, 200);
  assert.equal(s.bidCount, 1);
  assert.equal(s.term, null); // 出价不产生租期，未结算前 term 恒 null

  const other = r.shops.find((x) => x.id === shopByNo(2).id);
  assert.equal(other.highestBid, 0);
  assert.equal(other.myBid, null);
  assert.equal(other.bidCount, 0);
  assert.equal(other.term, null);
});

test('listShops：2 用户同店出价，highestBid 取最高、bidCount=2、各见各 myBid', () => {
  const a = makeUser(500);
  const b = makeUser(500);
  const shop = shopByNo(3);
  const { termWeek } = auctionTerm();
  bidShop(a, shop.id, termWeek, 300);
  bidShop(b, shop.id, termWeek, 200);

  const ra = listShops(a);
  const sa = ra.shops.find((x) => x.id === shop.id);
  assert.equal(sa.highestBid, 300);
  assert.equal(sa.bidCount, 2);
  assert.equal(sa.myBid, 300);

  const rb = listShops(b);
  const sb = rb.shops.find((x) => x.id === shop.id);
  assert.equal(sb.highestBid, 300); // 最高价对谁都一样
  assert.equal(sb.bidCount, 2);
  assert.equal(sb.myBid, 200); // B 只见自己的，看不到 A 的 300
});

test('listShops：非当期出价不进入 highestBid/bidCount/myBid（只查当期）', () => {
  const user = makeUser(500);
  const shop = shopByNo(4);
  const { deadlineAt } = auctionTerm();
  const otherWeek = isoWeekOf(new Date(Date.parse(deadlineAt) + 7 * 86400000)); // 未来但非当期（过期期已被 bidShop 拒绝）
  bidShop(user, shop.id, otherWeek, 999);

  const r = listShops(user);
  const s = r.shops.find((x) => x.id === shop.id);
  assert.equal(s.highestBid, 0);
  assert.equal(s.bidCount, 0);
  assert.equal(s.myBid, null);
});
