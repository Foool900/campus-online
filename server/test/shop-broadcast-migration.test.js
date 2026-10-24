import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const { systemAccountId } = await import('../treasury.js');
const { createSession, ensureMarketShops, bidShop, settleShopTerms, broadcast, listBroadcasts, auctionTerm, isoWeekOf } = await import('../routes/market.js');

initDb();

let seq = 0;
function makeUser(coin = 0) {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', 0, ?, 0, 'student', ?)")
    .run(`用户${seq}`, coin, nowIso());
  return Number(info.lastInsertRowid);
}
function acct(id) {
  return db.prepare('SELECT coin, frozen_coin AS frozenCoin FROM users WHERE id=?').get(id);
}
function sysCoin() {
  return db.prepare('SELECT coin FROM users WHERE id=?').get(systemAccountId()).coin;
}
function totalCoin() {
  return db.prepare('SELECT COALESCE(SUM(coin),0) + COALESCE(SUM(frozen_coin),0) AS t FROM users').get().t;
}
function openSession() {
  const r = createSession(new Date(Date.now() + 3600000).toISOString());
  const sid = r.session.id;
  db.prepare("UPDATE market_sessions SET status='open' WHERE id=?").run(sid);
  return sid;
}
function firstShop() {
  ensureMarketShops();
  return db.prepare('SELECT * FROM market_shops ORDER BY id LIMIT 1').get();
}

// 未来期次（相对当期 deadlineAt 偏移若干周）：bidShop 现在校验截止时间，过期期会被拒绝
function futureTermWeek(weeksAhead = 0) {
  const { deadlineAt } = auctionTerm();
  return isoWeekOf(new Date(Date.parse(deadlineAt) + weeksAhead * 7 * 86400000));
}

test('店铺租金：50/50 拆分、winner 3 条流水顺序正确、未中标全额退、总金币 −sinkPart', () => {
  const shop = firstShop();
  const termWeek = futureTermWeek(0);
  const winner = makeUser(1000);
  const loser = makeUser(1000);

  bidShop(winner, shop.id, termWeek, 200);
  bidShop(loser, shop.id, termWeek, 100);

  const sysBefore = sysCoin();
  const totalBefore = totalCoin();
  const winnerMaxId = db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM coin_transactions').get().m;

  settleShopTerms(termWeek);

  const treasuryPart = Math.floor(200 * config.market.stallFeeTreasuryRatio);
  const sinkPart = 200 - treasuryPart;
  assert.equal(treasuryPart + sinkPart, 200); // 取整无丢失

  assert.equal(acct(winner).frozenCoin, 0);
  assert.equal(acct(winner).coin, 1000 - 200); // 付满 200 租金
  assert.equal(acct(loser).frozenCoin, 0);
  assert.equal(acct(loser).coin, 1000); // 全额退
  assert.equal(sysCoin(), sysBefore + treasuryPart); // SYSTEM +50%
  assert.equal(totalCoin(), totalBefore - sinkPart); // 总金币 −销毁 50%

  const winnerTx = db.prepare('SELECT * FROM coin_transactions WHERE id > ? AND from_user_id = ? ORDER BY id ASC').all(winnerMaxId, winner);
  assert.equal(winnerTx.length, 3); // transfer / refund / sink
  assert.equal(winnerTx[0].type, 'transfer');
  assert.equal(winnerTx[1].type, 'refund');
  assert.equal(winnerTx[2].type, 'sink');
  assert.equal(winnerTx[0].amount, treasuryPart);
  assert.equal(winnerTx[1].amount, sinkPart);
  assert.equal(winnerTx[2].amount, sinkPart);
});

test('店铺租金：重复 settle 不重复扣', () => {
  const shop = firstShop();
  const termWeek = futureTermWeek(1);
  const winner = makeUser(1000);
  const loser = makeUser(1000);
  bidShop(winner, shop.id, termWeek, 200);
  bidShop(loser, shop.id, termWeek, 100);
  settleShopTerms(termWeek);

  const wCoin = acct(winner).coin, wFrozen = acct(winner).frozenCoin;
  const lCoin = acct(loser).coin, lFrozen = acct(loser).frozenCoin;
  const sysC = sysCoin();

  settleShopTerms(termWeek); // 第二次

  assert.equal(acct(winner).coin, wCoin);
  assert.equal(acct(winner).frozenCoin, wFrozen);
  assert.equal(acct(loser).coin, lCoin);
  assert.equal(acct(loser).frozenCoin, lFrozen);
  assert.equal(sysCoin(), sysC);
});

test('喇叭费：摊主 −fee、SYSTEM +fee；fee=0 无流水', () => {
  const sid = openSession();
  const user = makeUser(1000);

  db.prepare("INSERT INTO market_configs (key, value, updated_at) VALUES ('broadcast_fee', '10', ?)").run(nowIso());
  const sysBefore = sysCoin();
  broadcast(user, sid, '开摊啦');
  assert.equal(acct(user).coin, 1000 - 10);
  assert.equal(sysCoin(), sysBefore + 10);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM market_ledger WHERE biz_type='broadcast_fee'").get().c, 1);

  db.prepare("UPDATE market_configs SET value='0' WHERE key='broadcast_fee'").run();
  const sysBefore2 = sysCoin();
  broadcast(user, sid, '再喊一次');
  assert.equal(acct(user).coin, 1000 - 10); // 不变
  assert.equal(sysCoin(), sysBefore2); // SYSTEM 不变
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM market_ledger WHERE biz_type='broadcast_fee'").get().c, 1); // 无新增
});

test('喇叭列表：ASC 排序 + 昵称 + fee/limit/myCount；myCount 含 removed、列表不含', () => {
  const sid = openSession();
  const u1 = makeUser(100);
  const u2 = makeUser(100);

  broadcast(u1, sid, '第一条');
  broadcast(u2, sid, '第二条');
  broadcast(u1, sid, '第三条');

  const r = listBroadcasts(sid, u1);
  assert.equal(r.fee, 0);          // 上一测试已把 broadcast_fee 改回 0
  assert.equal(r.limit, 3);
  assert.equal(r.myCount, 2);      // u1 本期两条
  assert.equal(r.broadcasts.length, 3);
  assert.deepEqual(r.broadcasts.map((b) => b.content), ['第一条', '第二条', '第三条']); // 时间正序 ASC
  assert.ok(r.broadcasts[0].nickname); // join users 拿到昵称
  assert.equal(r.broadcasts[0].userId, u1);

  // removed 仍计入 myCount，但不出现在 published 列表
  db.prepare("UPDATE market_broadcasts SET status='removed' WHERE user_id=? AND content='第一条'").run(u1);
  const r2 = listBroadcasts(sid, u1);
  assert.equal(r2.myCount, 2);                       // 用过即计入，不受 status 影响
  assert.deepEqual(r2.broadcasts.map((b) => b.content), ['第二条', '第三条']);
});

test('店铺租金回滚：transfer 后 ledger 冲突，term/frozen/SYSTEM 全回滚', () => {
  const shop = firstShop();
  const termWeek = futureTermWeek(2);
  const winner = makeUser(1000);
  bidShop(winner, shop.id, termWeek, 200);

  db.prepare("INSERT INTO market_ledger (session_id, biz_type, biz_id, op, user_id, counterparty_id, amount, coin_tx_id, idempotency_key, created_at) VALUES (NULL, 'shop_rent_treasury', ?, 'treasury_in', ?, ?, 100, NULL, ?, ?)")
    .run(shop.id, winner, systemAccountId(), `shop_rent_treasury:${shop.id}:${termWeek}:ledger`, nowIso());

  const sysC = sysCoin();
  let threw = false;
  try { settleShopTerms(termWeek); } catch (e) { threw = true; }
  assert.equal(threw, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM market_shop_terms WHERE shop_id=? AND term_week=?').get(shop.id, termWeek).c, 0); // term 未创建
  assert.equal(acct(winner).frozenCoin, 200); // frozen 未变
  assert.equal(sysCoin(), sysC); // SYSTEM 未变
  assert.equal(db.prepare('SELECT status FROM market_shop_bids WHERE shop_id=? AND term_week=? AND user_id=?').get(shop.id, termWeek, winner).status, 'active'); // bid 仍 active
});
