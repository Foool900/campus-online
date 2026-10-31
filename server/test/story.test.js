import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const {
  claimStory,
  checkinNode,
  getStoryTimeline,
  getStoryDetail,
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

// ============ 分支互动扩展（《河大的一天》）============

test('剧情扩展：导入分支互动字段（endings/campusVariants/items/popup/对象 choices/optionalProof）', () => {
  const admin = makeUser('admin');
  const r = importStories(admin, {
    code: 's-branch',
    title: '分支测试',
    obtainMode: 'claim',
    availability: 'permanent',
    endings: [
      { mood: '宁静', code: 'qinxue', title: '勤学', text: '灯火长明' },
      { mood: '热闹', code: 'yanhuo', title: '烟火', text: '西门夜色' },
    ],
    nodes: [
      {
        seq: 1, title: '序章', checkinType: 'text', optionalProof: false,
        choices: [{ value: '明伦', label: '明伦校区', var: 'campus' }, { value: '金明', label: '金明校区', var: 'campus' }],
        items: [{ name: '钥匙牌', icon: '🔑', rarity: 'common' }],
        campusVariants: { 明伦: '老校区', 金明: '新校区' },
        popup: { title: '冷知识', body: '大礼堂 1934' },
      },
    ],
  });
  assert.equal(r.error, undefined);
  const sid = storyIdByCode('s-branch');
  const st = db.prepare("SELECT * FROM stories WHERE code='s-branch'").get();
  assert.equal(JSON.parse(st.endings_json)[0].code, 'qinxue');
  const n = db.prepare('SELECT * FROM story_nodes WHERE story_id=?').get(sid);
  assert.deepEqual(JSON.parse(n.choices_json)[0], { value: '明伦', label: '明伦校区', var: 'campus' });
  assert.equal(JSON.parse(n.items_json)[0].name, '钥匙牌');
  assert.deepEqual(JSON.parse(n.campus_variants_json), { 明伦: '老校区', 金明: '新校区' });
  assert.equal(JSON.parse(n.popup_json).title, '冷知识');
  assert.equal(n.optional_proof, 0);
});

test('剧情扩展：对象选择打卡累加 mood/energy，var 设校区', () => {
  const admin = makeUser('admin');
  const u = makeUser('student');
  importStories(admin, {
    code: 's-state', title: '状态', obtainMode: 'claim', availability: 'permanent',
    nodes: [
      { seq: 1, title: '序章', checkinType: 'none', choices: [{ value: '金明', label: '金明校区', var: 'campus' }] },
      { seq: 2, title: '早餐', checkinType: 'none', choices: [{ value: '咖啡', label: '咖啡', moods: { 自在: 1 }, energy: 8 }] },
    ],
  });
  const sid = storyIdByCode('s-state');
  claimStory(u, sid);
  const nodes = db.prepare('SELECT * FROM story_nodes WHERE story_id=? ORDER BY seq ASC').all(sid);
  checkinNode(u, sid, nodes[0].id, { choice: '金明' });
  let st = JSON.parse(db.prepare('SELECT state_json FROM player_stories WHERE user_id=? AND story_id=?').get(u, sid).state_json);
  assert.equal(st.campus, '金明');
  checkinNode(u, sid, nodes[1].id, { choice: '咖啡' });
  st = JSON.parse(db.prepare('SELECT state_json FROM player_stories WHERE user_id=? AND story_id=?').get(u, sid).state_json);
  assert.equal(st.campus, '金明');
  assert.equal(st.mood['自在'], 1);
  assert.equal(st.energy, 8);
});

test('剧情扩展：逐节点掉落（choice 分支 + proofText 额外 + readPopup 隐藏 + 无条件必掉）', () => {
  const admin = makeUser('admin');
  const u = makeUser('student');
  importStories(admin, {
    code: 's-drops', title: '掉落', obtainMode: 'claim', availability: 'permanent',
    nodes: [
      { seq: 1, title: '序章', checkinType: 'none', choices: [{ value: '明伦', label: '明伦', var: 'campus' }], items: [{ name: '钥匙', icon: '🔑', rarity: 'common' }] },
      {
        seq: 2, title: '早餐', checkinType: 'text', optionalProof: true,
        choices: [{ value: '咖啡', label: '咖啡', moods: { 自在: 1 } }],
        items: [
          { name: '咖啡', icon: '☕', rarity: 'common', when: { choice: '咖啡' } },
          { name: '便签', icon: '📝', rarity: 'rare', slot: 'extra', when: { proofText: true } },
        ],
      },
      { seq: 3, title: '课堂', checkinType: 'none', popup: { title: 'x', body: 'y' }, items: [{ name: '明信片', icon: '💌', rarity: 'legendary', slot: 'extra', when: { readPopup: true } }] },
    ],
  });
  const sid = storyIdByCode('s-drops');
  claimStory(u, sid);
  const nodes = db.prepare('SELECT * FROM story_nodes WHERE story_id=? ORDER BY seq ASC').all(sid);
  checkinNode(u, sid, nodes[0].id, { choice: '明伦' });
  assert.ok(db.prepare("SELECT * FROM inventory_items WHERE owner_id=? AND name='钥匙'").get(u));
  checkinNode(u, sid, nodes[1].id, { choice: '咖啡', proof: { text: '吃了灌饼' } });
  assert.ok(db.prepare("SELECT * FROM inventory_items WHERE owner_id=? AND name='咖啡'").get(u));
  assert.ok(db.prepare("SELECT * FROM inventory_items WHERE owner_id=? AND name='便签'").get(u));
  checkinNode(u, sid, nodes[2].id, { flags: { readPopup: true } });
  assert.ok(db.prepare("SELECT * FROM inventory_items WHERE owner_id=? AND name='明信片'").get(u));
});

test('剧情扩展：optional_proof 允许空凭证，必做仍校验', () => {
  const admin = makeUser('admin');
  const u = makeUser('student');
  importStories(admin, {
    code: 's-optional', title: '可选', obtainMode: 'claim', availability: 'permanent',
    nodes: [
      { seq: 1, title: '必做', checkinType: 'text' },
      { seq: 2, title: '可选', checkinType: 'text', optionalProof: true },
    ],
  });
  const sid = storyIdByCode('s-optional');
  claimStory(u, sid);
  const nodes = db.prepare('SELECT * FROM story_nodes WHERE story_id=? ORDER BY seq ASC').all(sid);
  assert.equal(checkinNode(u, sid, nodes[0].id, {}).code, 'STORY_PROOF_REQUIRED');
  assert.equal(checkinNode(u, sid, nodes[0].id, { proof: { text: 'x' } }).error, undefined);
  assert.equal(checkinNode(u, sid, nodes[1].id, {}).error, undefined);
});

test('剧情扩展：打满整章按主导 mood 结算结局，发纪念册与「镜头里的河大」', () => {
  const admin = makeUser('admin');
  const u = makeUser('student');
  importStories(admin, {
    code: 's-ending', title: '结局', obtainMode: 'claim', availability: 'permanent',
    rewards: { exp: 5, coin: 5, items: [{ name: '纪念册', icon: '📔', rarity: 'legendary' }] },
    endings: [
      { mood: '宁静', code: 'qinxue', title: '勤学', text: '灯火' },
      { mood: '热闹', code: 'yanhuo', title: '烟火', text: '夜色' },
      { mood: '自在', code: 'zizai', title: '自在', text: '晚风' },
    ],
    nodes: [
      { seq: 1, title: '序章', checkinType: 'none', choices: [{ value: '金明', label: '金明', var: 'campus' }] },
      { seq: 2, title: '夜', checkinType: 'none', choices: [{ value: '夜市', label: '夜市', moods: { 热闹: 2 } }] },
      { seq: 3, title: '图', checkinType: 'photo', optionalProof: true, choices: [{ value: 'a', label: 'a', moods: { 宁静: 1 } }] },
    ],
  });
  const sid = storyIdByCode('s-ending');
  claimStory(u, sid);
  const nodes = db.prepare('SELECT * FROM story_nodes WHERE story_id=? ORDER BY seq ASC').all(sid);
  checkinNode(u, sid, nodes[0].id, { choice: '金明' });
  checkinNode(u, sid, nodes[1].id, { choice: '夜市' });
  const c3 = checkinNode(u, sid, nodes[2].id, { choice: 'a', proof: { imageUrl: '/uploads/x.png' } });
  assert.equal(c3.completed, true);
  assert.equal(c3.ending.code, 'yanhuo'); // 热闹 2 > 宁静 1
  assert.equal(db.prepare('SELECT ending_code FROM player_stories WHERE user_id=? AND story_id=?').get(u, sid).ending_code, 'yanhuo');
  assert.ok(db.prepare("SELECT * FROM inventory_items WHERE owner_id=? AND name='纪念册'").get(u));
  assert.ok(db.prepare("SELECT * FROM inventory_items WHERE owner_id=? AND name='镜头里的河大'").get(u)); // 唯一 photo 节点传了图
  const detail = getStoryDetail(u, sid);
  assert.equal(detail.ending.code, 'yanhuo');
  assert.ok(detail.backpack.length >= 2); // 纪念册 + 镜头里的河大
});

test('剧情扩展：mood 并列时按最近一次增量决胜', () => {
  const admin = makeUser('admin');
  const u = makeUser('student');
  importStories(admin, {
    code: 's-tie', title: '并列', obtainMode: 'claim', availability: 'permanent',
    endings: [
      { mood: '宁静', code: 'qinxue', title: '勤学', text: '' },
      { mood: '自在', code: 'zizai', title: '自在', text: '' },
    ],
    nodes: [
      { seq: 1, title: 'a', checkinType: 'none', choices: [{ value: 'x', label: 'x', moods: { 宁静: 1 } }] },
      { seq: 2, title: 'b', checkinType: 'none', choices: [{ value: 'y', label: 'y', moods: { 自在: 1 } }] },
    ],
  });
  const sid = storyIdByCode('s-tie');
  claimStory(u, sid);
  const nodes = db.prepare('SELECT * FROM story_nodes WHERE story_id=? ORDER BY seq ASC').all(sid);
  checkinNode(u, sid, nodes[0].id, { choice: 'x' });
  checkinNode(u, sid, nodes[1].id, { choice: 'y' }); // 宁静=1 自在=1 并列，最近一次是自在
  assert.equal(db.prepare('SELECT ending_code FROM player_stories WHERE user_id=? AND story_id=?').get(u, sid).ending_code, 'zizai');
});

test('剧情扩展：字符串数组 choices 回归（旧数据不受影响）', () => {
  const admin = makeUser('admin');
  const u = makeUser('student');
  importStories(admin, {
    code: 's-legacy', title: '旧选项', obtainMode: 'claim', availability: 'permanent',
    nodes: [
      { seq: 1, title: 'n1', checkinType: 'none', choices: ['图书馆', '操场'] },
      { seq: 2, title: 'n2', checkinType: 'none' },
    ],
  });
  const sid = storyIdByCode('s-legacy');
  claimStory(u, sid);
  const nodes = db.prepare('SELECT * FROM story_nodes WHERE story_id=? ORDER BY seq ASC').all(sid);
  assert.equal(checkinNode(u, sid, nodes[0].id, { choice: '不存在' }).code, 'STORY_INVALID_CHOICE');
  const c = checkinNode(u, sid, nodes[0].id, { choice: '图书馆' });
  assert.equal(c.error, undefined);
  assert.equal(db.prepare('SELECT choice FROM player_story_checkins WHERE user_id=? AND node_id=?').get(u, nodes[0].id).choice, '图书馆');
});
