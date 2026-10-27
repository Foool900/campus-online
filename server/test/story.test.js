import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const {
  claimStory,
  checkinNode,
  getStoryTimeline,
  importStories,
  importStoryPools,
  drawStory,
  finalizeTimeline,
} = await import('../story.js');
const { metricValue } = await import('../achievements.js');
const { publishTask, acceptTask, submitTask, approveTask } = await import('../routes/tasks.js');
const { seedIfEmpty } = await import('../seed.js');

initDb();
seedIfEmpty(); // 提供校区/世界频道，供任务系统消息写入

let seq = 0;
function makeUser(role = 'student', coin = 0) {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', 0, ?, 0, ?, ?)")
    .run(`用户${seq}`, coin, role, nowIso());
  return Number(info.lastInsertRowid);
}

// 导入一个剧情（code 唯一，避免测试间串数据）
function importStory(adminId, code, extra = {}) {
  return importStories(adminId, {
    code,
    title: '测试剧情',
    obtainMode: 'claim',
    availability: 'permanent',
    rewards: { exp: 10, coin: 20, items: [{ name: '测试徽章', icon: '🎖️', rarity: 'rare' }] },
    nodes: [
      { seq: 1, title: '节点一', description: '做一件事', checkinType: 'none' },
      { seq: 2, title: '节点二', description: '做另一件事', checkinType: 'text' },
    ],
    ...extra,
  });
}

function storyIdByCode(code) {
  return db.prepare('SELECT id FROM stories WHERE code = ?').get(code).id;
}

// ============ 导入 + 直接领取 ============

test('剧情：导入按 code 幂等 upsert', () => {
  const admin = makeUser('admin');
  const r1 = importStory(admin, 's-upsert', { title: '第一版' });
  assert.deepEqual(r1.created, ['s-upsert']);
  const r2 = importStory(admin, 's-upsert', { title: '第二版' });
  assert.deepEqual(r2.updated, ['s-upsert']);
  assert.equal(db.prepare("SELECT title FROM stories WHERE code='s-upsert'").get().title, '第二版');
});

test('剧情：直接领取 + 幂等，首次设置 1 周年锚点', () => {
  const admin = makeUser('admin');
  const u = makeUser('student');
  importStory(admin, 's-claim');
  const sid = storyIdByCode('s-claim');

  const c1 = claimStory(u, sid);
  assert.equal(c1.error, undefined);
  assert.equal(c1.duplicate, false);
  assert.equal(c1.run.status, 'in_progress');
  assert.ok(db.prepare('SELECT first_story_at FROM player_story_meta WHERE user_id = ?').get(u).first_story_at);

  const c2 = claimStory(u, sid);
  assert.equal(c2.duplicate, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM player_stories WHERE user_id = ?').get(u).c, 1);
});

test('剧情：任务 / 奖池获取方式的章节不可直接领取', () => {
  const admin = makeUser('admin');
  const u = makeUser('student');
  importStory(admin, 's-task', { obtainMode: 'task' });
  const c = claimStory(u, storyIdByCode('s-task'));
  assert.equal(c.code, 'STORY_NOT_CLAIMABLE');
});

// ============ 打卡 / 完成 / 奖励幂等 ============

test('剧情：顺序打卡 + 凭证校验 + 完成发奖且幂等', () => {
  const admin = makeUser('admin');
  const u = makeUser('student');
  importStory(admin, 's-flow');
  const sid = storyIdByCode('s-flow');
  claimStory(u, sid);
  const nodes = db.prepare('SELECT * FROM story_nodes WHERE story_id = ? ORDER BY seq ASC').all(sid);

  // 未完成前一节点，直接打卡节点二 → 拒绝
  assert.equal(checkinNode(u, sid, nodes[1].id, { proof: { text: 'hi' } }).code, 'STORY_NODE_LOCKED');

  // 节点一（none）打卡成功
  const c1 = checkinNode(u, sid, nodes[0].id, {});
  assert.equal(c1.error, undefined);
  assert.equal(c1.completed, false);

  // 节点二需要文字凭证，缺 → 拒绝
  assert.equal(checkinNode(u, sid, nodes[1].id, {}).code, 'STORY_PROOF_REQUIRED');

  // 节点二正确打卡 → 完成 + 一次性发奖
  const before = db.prepare('SELECT exp, coin FROM users WHERE id = ?').get(u);
  const c2 = checkinNode(u, sid, nodes[1].id, { proof: { text: '写下一句感受' } });
  assert.equal(c2.error, undefined);
  assert.equal(c2.completed, true);
  assert.equal(c2.run.status, 'completed');

  const after = db.prepare('SELECT exp, coin FROM users WHERE id = ?').get(u);
  assert.equal(after.exp, before.exp + 10);
  assert.equal(after.coin, before.coin + 20);
  const item = db.prepare("SELECT * FROM inventory_items WHERE owner_id = ? AND source = 'story'").get(u);
  assert.equal(item.name, '测试徽章');
  assert.equal(item.source_ref_id, c2.run.id); // source_ref_id 用进度实例 id

  // 重复打卡 → 已完成拒绝，不重复发奖
  assert.equal(checkinNode(u, sid, nodes[1].id, { proof: { text: 'x' } }).code, 'STORY_COMPLETED');
  const after2 = db.prepare('SELECT exp, coin FROM users WHERE id = ?').get(u);
  assert.equal(after2.exp, after.exp);
  assert.equal(after2.coin, after.coin);
});

// ============ 节日限时 ============

test('剧情：节日限时章节过期后不可领取 / 打卡', () => {
  const admin = makeUser('admin');
  const u = makeUser('student');
  const past = new Date(Date.now() - 1000).toISOString();
  importStory(admin, 's-fest', {
    availability: 'festival',
    timeboxed: true,
    windowStartAt: new Date(Date.now() - 200000).toISOString(),
    windowEndAt: past,
  });
  const sid = storyIdByCode('s-fest');

  assert.equal(claimStory(u, sid).code, 'STORY_WINDOW_CLOSED');

  // 直接塞一条进度，再打卡 → 过期，且过期状态落库
  db.prepare("INSERT INTO player_stories (user_id, story_id, status, obtained_via, obtained_at) VALUES (?, ?, 'in_progress', 'claim', ?)").run(u, sid, nowIso());
  const node = db.prepare('SELECT * FROM story_nodes WHERE story_id = ? AND seq = 1').get(sid);
  assert.equal(checkinNode(u, sid, node.id, {}).code, 'STORY_EXPIRED');
  assert.equal(db.prepare('SELECT status FROM player_stories WHERE user_id = ? AND story_id = ?').get(u, sid).status, 'expired');
});

// ============ 任务解锁 ============

test('剧情：完成任务自动解锁关联剧情', () => {
  const admin = makeUser('admin');
  const assignee = makeUser('student');
  importStory(admin, 's-taskreward', { obtainMode: 'task' });
  const sid = storyIdByCode('s-taskreward');

  const adminUser = { id: admin, role: 'admin', nickname: '管理员' };
  const assigneeUser = { id: assignee, role: 'student', nickname: '接取者' };

  const p = publishTask(adminUser, { type: 'public', title: '解锁剧情任务', rewardCoin: 0, storyId: sid });
  assert.equal(p.error, undefined);
  const taskId = p.task.id;

  assert.equal(acceptTask(assigneeUser, taskId).error, undefined);
  db.prepare('UPDATE tasks SET min_complete_at = ? WHERE id = ?').run(new Date(0).toISOString(), taskId);
  assert.equal(submitTask(assigneeUser, taskId, { text: '完成' }).error, undefined);
  assert.equal(approveTask(adminUser, taskId).error, undefined);

  const run = db.prepare('SELECT * FROM player_stories WHERE user_id = ? AND story_id = ?').get(assignee, sid);
  assert.ok(run);
  assert.equal(run.obtained_via, 'task');
});

test('剧情：非管理员不可为任务关联剧情', () => {
  const u = makeUser('student');
  const r = publishTask({ id: u, role: 'student', nickname: '普通用户' }, { type: 'public', title: 'x', rewardCoin: 0, storyId: 1 });
  assert.equal(r.code, 'EX_STORY_ADMIN_ONLY');
});

// ============ 时间线故事书 ============

test('剧情：时间线故事书聚合剧情与全站足迹', () => {
  const admin = makeUser('admin');
  const u = makeUser('student');
  importStory(admin, 's-timeline');
  const sid = storyIdByCode('s-timeline');
  claimStory(u, sid);
  const nodes = db.prepare('SELECT * FROM story_nodes WHERE story_id = ? ORDER BY seq ASC').all(sid);
  checkinNode(u, sid, nodes[0].id, {});
  checkinNode(u, sid, nodes[1].id, { proof: { text: 'x' } });

  const tl = getStoryTimeline(u);
  assert.equal(tl.story.completedCount, 1);
  assert.equal(tl.story.checkinCount, 2);
  assert.equal(tl.story.completedStories.length, 1);
  assert.equal(tl.story.items.length, 1);
  assert.equal(tl.isAnniversary, false);
  assert.equal(tl.finalized, false);
  assert.ok(tl.anniversaryAt);
  assert.equal(typeof tl.footprint.messages, 'number');
});

// ============ 剧情奖池 ============

test('剧情奖池：导入 + 加权抽取扣费 + 发放剧情 + 排除已拥有', () => {
  const admin = makeUser('admin');
  const u = makeUser('student', 1000);
  importStory(admin, 'gacha-a');
  importStory(admin, 'gacha-b');
  importStoryPools(admin, {
    code: 'pool-1',
    name: '测试奖池',
    drawCostCoin: 50,
    entries: [{ storyCode: 'gacha-a', weight: 1 }, { storyCode: 'gacha-b', weight: 1 }],
  });
  const pool = db.prepare("SELECT * FROM story_pools WHERE code='pool-1'").get();

  const before = db.prepare('SELECT coin FROM users WHERE id=?').get(u).coin;
  const r = drawStory(u, pool.id);
  assert.equal(r.error, undefined);
  assert.equal(r.duplicate, false);
  assert.ok(r.story);
  assert.equal(db.prepare('SELECT coin FROM users WHERE id=?').get(u).coin, before - 50);
  const run = db.prepare('SELECT * FROM player_stories WHERE user_id=? AND story_id=?').get(u, r.storyId);
  assert.equal(run.obtained_via, 'gacha');

  // 第二次抽到另一个（排除已拥有）；抽完后再抽 → 空
  const r2 = drawStory(u, pool.id);
  assert.equal(r2.error, undefined);
  assert.notEqual(r2.storyId, r.storyId);
  assert.equal(drawStory(u, pool.id).code, 'STORY_POOL_EMPTY');
});

// ============ 时间线定稿 ============

test('时间线定稿：满周年快照 + 发纪念物品 + 幂等', () => {
  const u = makeUser('student');
  const past = new Date(Date.now() - 400 * 86400000).toISOString();
  db.prepare('INSERT INTO player_story_meta (user_id, first_story_at, completed_count, checkin_count) VALUES (?, ?, 0, 0)').run(u, past);

  const r1 = finalizeTimeline(u);
  assert.equal(r1.due, true);
  assert.equal(r1.finalized, true);
  assert.equal(r1.duplicate, false);
  assert.ok(r1.timelineId);
  assert.ok(db.prepare('SELECT * FROM story_timelines WHERE user_id=?').get(u));
  assert.ok(db.prepare("SELECT * FROM inventory_items WHERE owner_id=? AND name='时间线故事书'").get(u));

  const r2 = finalizeTimeline(u);
  assert.equal(r2.duplicate, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM story_timelines WHERE user_id=?').get(u).c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM inventory_items WHERE owner_id=? AND name='时间线故事书'").get(u).c, 1);
});

test('时间线定稿：未满周年不定稿', () => {
  const u = makeUser('student');
  const recent = new Date(Date.now() - 10 * 86400000).toISOString();
  db.prepare('INSERT INTO player_story_meta (user_id, first_story_at, completed_count, checkin_count) VALUES (?, ?, 0, 0)').run(u, recent);
  assert.equal(finalizeTimeline(u).due, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM story_timelines WHERE user_id=?').get(u).c, 0);
});

// ============ 剧情成就指标 ============

test('剧情成就指标：stories_completed / story_checkins 正确计数', () => {
  const admin = makeUser('admin');
  const u = makeUser('student');
  importStory(admin, 's-metric');
  const sid = storyIdByCode('s-metric');
  claimStory(u, sid);
  const nodes = db.prepare('SELECT * FROM story_nodes WHERE story_id=? ORDER BY seq ASC').all(sid);
  checkinNode(u, sid, nodes[0].id, {});
  assert.equal(metricValue(u, 'story_checkins'), 1);
  assert.equal(metricValue(u, 'stories_completed'), 0);
  checkinNode(u, sid, nodes[1].id, { proof: { text: 'x' } });
  assert.equal(metricValue(u, 'story_checkins'), 2);
  assert.equal(metricValue(u, 'stories_completed'), 1);
});
