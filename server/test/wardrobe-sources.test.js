import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { ensureWardrobe } = await import('../wardrobe.js');
const { createSession, createItem, listItem, buyItem, confirmOrder, grabStall, confirmStall } = await import('../routes/market.js');
const { publishTask, acceptTask, submitTask, approveTask } = await import('../routes/tasks.js');

initDb();
ensureWardrobe();

// 世界频道占位（任务系统消息需 channel_id 外键）
function seedWorld() {
  const c = db.prepare("INSERT INTO campuses (name, slug) VALUES ('测试校区', 'test-campus')").run();
  const a = db.prepare("INSERT INTO areas (campus_id, name, slug, hidden) VALUES (?, '世界广场', 'world', 1)").run(c.lastInsertRowid);
  db.prepare("INSERT INTO channels (area_id, name) VALUES (?, '世界频道')").run(a.lastInsertRowid);
}
seedWorld();

let seq = 0;
function makeUser(role = 'student', coin = 0) {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', 0, ?, 0, ?, ?)")
    .run(`用户${seq}`, coin, role, nowIso());
  return { id: Number(info.lastInsertRowid), role, nickname: `用户${seq}` };
}
function openSession() {
  const r = createSession(new Date(Date.now() + 3600000).toISOString());
  const sid = r.session.id;
  db.prepare("UPDATE market_sessions SET status='open' WHERE id=?").run(sid);
  return sid;
}

test('M3 市场自营商品带装扮：成交后买家获得对应装扮', () => {
  const sid = openSession();
  const seller = makeUser('student', 1000);
  const buyer = makeUser('student', 1000);
  const stallId = grabStall(seller.id, sid).stallId;
  confirmStall(seller.id, stallId);

  const c = createItem(seller.id, { sessionId: sid, title: '限定针织帽', priceCoin: 100, wardrobeCode: 'hat_beanie' });
  assert.equal(c.error, undefined);

  const row = db.prepare('SELECT * FROM market_items WHERE id=?').get(c.itemId);
  assert.ok(row.wardrobe_item_id > 0);

  assert.equal(listItem(seller.id, c.itemId, { stallId }).error, undefined);
  const b = buyItem(buyer.id, c.itemId);
  assert.equal(b.error, undefined);
  assert.equal(confirmOrder(buyer.id, b.orderId).error, undefined);

  const got = db.prepare("SELECT * FROM inventory_items WHERE owner_id=? AND source='market'").get(buyer.id);
  assert.equal(got.kind, 'apparel');
  assert.equal(got.wardrobe_item_id, row.wardrobe_item_id);
  assert.equal(got.name, '针织帽');
});

test('M4 任务装扮奖励：验收后接取者获得装扮', () => {
  const admin = makeUser('admin', 1000);
  const assignee = makeUser('student', 0);

  const p = publishTask(admin, { type: 'public', title: '跑腿送装扮', rewardCoin: 10, rewardWardrobeCode: 'outfit_school' });
  assert.equal(p.error, undefined);
  const taskId = p.task.id;

  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
  assert.ok(task.reward_wardrobe_item_id > 0);

  db.prepare('UPDATE tasks SET min_complete_at=NULL WHERE id=?').run(taskId);

  assert.equal(acceptTask(assignee, taskId).error, undefined);
  assert.equal(submitTask(assignee, taskId, { text: '已完成' }).error, undefined);
  assert.equal(approveTask(admin, taskId).error, undefined);

  const got = db.prepare("SELECT * FROM inventory_items WHERE owner_id=? AND source='task'").get(assignee.id);
  assert.equal(got.kind, 'apparel');
  assert.equal(got.wardrobe_item_id, task.reward_wardrobe_item_id);
  assert.equal(got.name, '校园制服');
});

test('M4 非管理员不可设置任务装扮奖励', () => {
  const u = makeUser('student', 1000);
  const p = publishTask(u, { type: 'public', title: '普通任务', rewardCoin: 10, rewardWardrobeCode: 'hat_beanie' });
  assert.equal(p.code, 'EX_WARDROBE_ADMIN_ONLY');
});
