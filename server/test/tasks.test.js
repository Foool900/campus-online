import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const {
  publishTask,
  listTasks,
  getTaskDetail,
  acceptTask,
  submitTask,
  approveTask,
  rejectTask,
  cancelTask,
  abandonTask,
  toggleTaskDone,
  expireOverdueTasks,
} = await import('../routes/tasks.js');

initDb();

// 世界频道占位（任务系统消息需 channel_id 外键）
function seedWorld() {
  const c = db.prepare("INSERT INTO campuses (name, slug) VALUES ('测试校区', 'test-campus')").run();
  const a = db.prepare("INSERT INTO areas (campus_id, name, slug, hidden) VALUES (?, '世界广场', 'world', 1)").run(c.lastInsertRowid);
  db.prepare("INSERT INTO channels (area_id, name) VALUES (?, '世界频道')").run(a.lastInsertRowid);
}
seedWorld();

let seq = 0;
function makeUser(exp = 0, coin = exp, frozenCoin = 0) {
  seq += 1;
  const info = db
    .prepare(
      "INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机与信息工程学院', '🎓', ?, ?, ?, 'student', ?)"
    )
    .run(`测试用户${seq}`, exp, coin, frozenCoin, nowIso());
  return Number(info.lastInsertRowid);
}

function u(id) {
  const row = db.prepare('SELECT nickname FROM users WHERE id = ?').get(id);
  return { id, nickname: row.nickname, role: 'student' };
}

function acct(id) {
  return db.prepare('SELECT exp, coin, frozen_coin AS frozenCoin FROM users WHERE id = ?').get(id);
}

function pub(publisherId, reward, opts = {}) {
  return publishTask(u(publisherId), {
    type: 'public',
    title: opts.title || '测试公开任务',
    description: opts.description || '',
    tags: opts.tags || [],
    rewardCoin: reward,
    deadlineAt: opts.deadlineAt || null,
  });
}

function allowSubmit(taskId) {
  db.prepare('UPDATE tasks SET min_complete_at = ? WHERE id = ?').run(new Date(Date.now() - 60000).toISOString(), taskId);
}

// ============ 私密备忘 ============

test('private 发布：奖励恒 0，todo ↔ done 可撤销', () => {
  const uid = makeUser(0, 0);
  const r = publishTask(u(uid), { type: 'private', title: '背单词', rewardCoin: 999 });
  assert.equal(r.error, undefined);
  assert.equal(r.task.type, 'private');
  assert.equal(r.task.rewardCoin, 0);
  assert.equal(r.task.status, 'todo');

  const done = toggleTaskDone(u(uid), r.task.id);
  assert.equal(done.task.status, 'done');
  assert.ok(done.task.finishedAt);

  const back = toggleTaskDone(u(uid), r.task.id);
  assert.equal(back.task.status, 'todo');
  assert.equal(back.task.finishedAt, null);
});

test('private 完成发行为经验，且幂等（撤销重打不重复）', () => {
  const uid = makeUser(0, 0);
  const t = publishTask(u(uid), { type: 'private', title: '记笔记' }).task;
  toggleTaskDone(u(uid), t.id);
  assert.equal(acct(uid).exp, config.exp.todoComplete);
  toggleTaskDone(u(uid), t.id); // 撤销
  toggleTaskDone(u(uid), t.id); // 再完成
  assert.equal(acct(uid).exp, config.exp.todoComplete); // 仍只发一次
});

// ============ 发布与冻结 ============

test('public 发布：冻结赏金，coin↓ frozenCoin↑ exp 不变', () => {
  const uid = makeUser(1000, 500, 0);
  const r = pub(uid, 100);
  assert.equal(r.error, undefined);
  assert.equal(r.task.status, 'published');
  assert.equal(r.task.rewardCoin, 100);
  const a = acct(uid);
  assert.equal(a.coin, 400);
  assert.equal(a.frozenCoin, 100);
  assert.equal(a.exp, 1000);
});

test('public 发布：赏金超过单任务上限被拒绝', () => {
  const uid = makeUser(1000, 100, 0); // cap = min(100×20%, 500) = 20
  const r = pub(uid, 30);
  assert.equal(r.code, 'EX_REWARD_OVER_CAP');
  const a = acct(uid);
  assert.equal(a.coin, 100);
  assert.equal(a.frozenCoin, 0);
});

test('不能接取自己发布的任务', () => {
  const uid = makeUser(1000, 500, 0);
  const t = pub(uid, 50).task;
  const r = acceptTask(u(uid), t.id);
  assert.equal(r.code, 'EX_SELF_ACCEPT');
});

// ============ 全流程 ============

test('发布→接取→提交→通过：金币划转 + 接取者行为经验', () => {
  const pubId = makeUser(1000, 500, 0);
  const assigneeId = makeUser(0, 0, 0);

  const t = pub(pubId, 80).task;
  const accepted = acceptTask(u(assigneeId), t.id);
  assert.equal(accepted.task.status, 'accepted');
  assert.equal(accepted.task.assigneeId, assigneeId);

  allowSubmit(t.id);
  const submitted = submitTask(u(assigneeId), t.id, { text: '完成了', link: 'https://example.com' });
  assert.equal(submitted.task.status, 'submitted');

  const approved = approveTask(u(pubId), t.id, {});
  assert.equal(approved.task.status, 'approved');

  const p = acct(pubId);
  const a = acct(assigneeId);
  assert.equal(p.frozenCoin, 0);
  assert.equal(p.coin, 420);
  assert.equal(p.exp, 1000);
  assert.equal(a.coin, 80);
  assert.equal(a.exp, config.exp.taskComplete);
});

test('最短完成时间内提交被拒绝', () => {
  const pubId = makeUser(1000, 500, 0);
  const assigneeId = makeUser(0, 0, 0);
  const t = pub(pubId, 30).task;
  acceptTask(u(assigneeId), t.id);
  const r = submitTask(u(assigneeId), t.id, { text: '好了' });
  assert.equal(r.code, 'EX_TOO_EARLY');
});

test('提交缺少凭证被拒绝', () => {
  const pubId = makeUser(1000, 500, 0);
  const assigneeId = makeUser(0, 0, 0);
  const t = pub(pubId, 30).task;
  acceptTask(u(assigneeId), t.id);
  allowSubmit(t.id);
  const r = submitTask(u(assigneeId), t.id, {});
  assert.equal(r.code, 'EX_PROOF_REQUIRED');
});

// ============ 驳回 / 终止 ============

test('驳回：非终态回 accepted 可重交，达到上限终止并退赏金', () => {
  const pubId = makeUser(1000, 500, 0);
  const assigneeId = makeUser(0, 0, 0);
  const t = pub(pubId, 50).task;
  acceptTask(u(assigneeId), t.id);
  allowSubmit(t.id);

  submitTask(u(assigneeId), t.id, { text: '第一次' });
  const r1 = rejectTask(u(pubId), t.id, {});
  assert.equal(r1.task.status, 'accepted');
  assert.equal(r1.task.rejectCount, 1);
  assert.equal(acct(pubId).frozenCoin, 50);

  submitTask(u(assigneeId), t.id, { text: '第二次' });
  const r2 = rejectTask(u(pubId), t.id, {});
  assert.equal(r2.task.status, 'accepted');
  assert.equal(r2.task.rejectCount, 2);

  submitTask(u(assigneeId), t.id, { text: '第三次' });
  const r3 = rejectTask(u(pubId), t.id, {});
  assert.equal(r3.task.status, 'terminated');
  assert.equal(r3.task.rejectCount, 3);
  const p = acct(pubId);
  assert.equal(p.frozenCoin, 0);
  assert.equal(p.coin, 500);
});

// ============ 放弃 / 取消 / 过期 ============

test('接取者放弃：accepted → published，冻结不变', () => {
  const pubId = makeUser(1000, 500, 0);
  const assigneeId = makeUser(0, 0, 0);
  const t = pub(pubId, 30).task;
  acceptTask(u(assigneeId), t.id);
  const r = abandonTask(u(assigneeId), t.id);
  assert.equal(r.task.status, 'published');
  assert.equal(r.task.assigneeId, null);
  assert.equal(acct(pubId).frozenCoin, 30);
});

test('发布者取消：退赏金', () => {
  const pubId = makeUser(1000, 500, 0);
  const t = pub(pubId, 60).task;
  const r = cancelTask(u(pubId), t.id);
  assert.equal(r.task.status, 'cancelled');
  const p = acct(pubId);
  assert.equal(p.frozenCoin, 0);
  assert.equal(p.coin, 500);
});

test('到期未接：expired + 退赏金', () => {
  const pubId = makeUser(1000, 500, 0);
  const t = pub(pubId, 70, { deadlineAt: new Date(Date.now() - 60000).toISOString() }).task;
  const handled = expireOverdueTasks(null);
  assert.ok(handled >= 1);
  assert.equal(getTaskDetail(pubId, t.id).task.status, 'expired');
  const p = acct(pubId);
  assert.equal(p.frozenCoin, 0);
  assert.equal(p.coin, 500);
});

// ============ 每日上限 ============

test('同一对用户每日往来次数超限被拒绝', () => {
  const prev = config.coin.dailyPairTransfer;
  config.coin.dailyPairTransfer = 1;
  try {
    const pubId = makeUser(10000, 5000, 0);
    const assigneeId = makeUser(0, 0, 0);

    const t1 = pub(pubId, 50).task;
    acceptTask(u(assigneeId), t1.id);
    allowSubmit(t1.id);
    submitTask(u(assigneeId), t1.id, { text: 'ok' });
    assert.equal(approveTask(u(pubId), t1.id, {}).task.status, 'approved');

    const t2 = pub(pubId, 50).task;
    acceptTask(u(assigneeId), t2.id);
    allowSubmit(t2.id);
    submitTask(u(assigneeId), t2.id, { text: 'ok' });
    const r2 = approveTask(u(pubId), t2.id, {});
    assert.equal(r2.code, 'EX_DAILY_PAIR');
  } finally {
    config.coin.dailyPairTransfer = prev;
  }
});

test('接取者每日获得金币超限被拒绝', () => {
  const prevAccept = config.coin.dailyAccept;
  const prevPair = config.coin.dailyPairTransfer;
  config.coin.dailyAccept = 40;
  config.coin.dailyPairTransfer = 100;
  try {
    const pubId = makeUser(10000, 5000, 0);
    const assigneeId = makeUser(0, 0, 0);
    const t = pub(pubId, 50).task; // 50 > 40
    acceptTask(u(assigneeId), t.id);
    allowSubmit(t.id);
    submitTask(u(assigneeId), t.id, { text: 'ok' });
    const r = approveTask(u(pubId), t.id, {});
    assert.equal(r.code, 'EX_DAILY_ACCEPT');
    assert.equal(acct(assigneeId).coin, 0);
    assert.equal(acct(assigneeId).exp, 0);
    assert.equal(acct(pubId).frozenCoin, 50);
  } finally {
    config.coin.dailyAccept = prevAccept;
    config.coin.dailyPairTransfer = prevPair;
  }
});

// ============ 列表 / 详情 / 隔离 ============

test('列表筛选：private 仅本人可见，public 全员可见', () => {
  const a = makeUser(1000, 500, 0);
  const b = makeUser(1000, 500, 0);
  publishTask(u(a), { type: 'private', title: 'A的私密' });
  publishTask(u(b), { type: 'private', title: 'B的私密' });
  const pubA = pub(a, 10).task;

  // 私密：各自只见自己的
  assert.equal(listTasks(a, { filter: 'private' }).length, 1);
  assert.equal(listTasks(a, { filter: 'private' })[0].title, 'A的私密');
  assert.equal(listTasks(b, { filter: 'private' }).length, 1);
  assert.equal(listTasks(b, { filter: 'private' })[0].title, 'B的私密');

  // 公开：任何人可见 A 的公开任务，且不含任何私密任务
  const bPublic = listTasks(b, { filter: 'public' });
  assert.ok(bPublic.some((t) => t.id === pubA.id));
  assert.ok(bPublic.every((t) => t.type === 'public'));
});

test('私密任务详情：他人访问被拒绝，本人可见 role=publisher', () => {
  const a = makeUser(0, 0);
  const b = makeUser(0, 0);
  const t = publishTask(u(a), { type: 'private', title: '我的备忘' }).task;
  assert.equal(getTaskDetail(b, t.id).code, 'EX_FORBIDDEN');
  assert.equal(getTaskDetail(a, t.id).task.role, 'publisher');
});
