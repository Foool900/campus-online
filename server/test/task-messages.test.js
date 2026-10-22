import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { insertConversationMessage, listConversationMessages } = await import('../routes/messages.js');
const { publishTask, acceptTask } = await import('../routes/tasks.js');

initDb();

function seedWorld() {
  const c = db.prepare("INSERT INTO campuses (name, slug) VALUES ('测试校区', 'test-campus')").run();
  const a = db.prepare("INSERT INTO areas (campus_id, name, slug, hidden) VALUES (?, '世界广场', 'world', 1)").run(c.lastInsertRowid);
  db.prepare("INSERT INTO channels (area_id, name) VALUES (?, '世界频道')").run(a.lastInsertRowid);
}
seedWorld();

let seq = 0;
function makeUser(exp = 0, avail = exp) {
  seq += 1;
  const info = db
    .prepare(
      "INSERT INTO users (nickname, college, avatar, exp, available_exp, frozen_exp, role, created_at) VALUES (?, '计算机', '🎓', ?, ?, 0, 'student', ?)"
    )
    .run(`测试用户${seq}`, exp, avail, nowIso());
  return Number(info.lastInsertRowid);
}
function u(id) {
  const row = db.prepare('SELECT nickname FROM users WHERE id = ?').get(id);
  return { id, nickname: row.nickname, role: 'student' };
}

test('任务讨论区：发布者/接取者可发言，他人被拒', () => {
  const pubId = makeUser(1000, 500);
  const assigneeId = makeUser(0, 0);
  const otherId = makeUser(0, 0);
  const t = publishTask(u(pubId), { type: 'public', title: 'T', rewardExp: 10 }).task;

  const byPub = insertConversationMessage('task', t.id, pubId, { content: '发布者发言' });
  assert.equal(byPub.error, undefined);

  const byOther = insertConversationMessage('task', t.id, otherId, { content: '路人发言' });
  assert.equal(byOther.status, 403);

  acceptTask(u(assigneeId), t.id);
  const byAssignee = insertConversationMessage('task', t.id, assigneeId, { content: '接取者发言' });
  assert.equal(byAssignee.error, undefined);
});

test('任务讨论区消息严格按任务隔离', () => {
  const pubId = makeUser(10000, 5000);
  const t1 = publishTask(u(pubId), { type: 'public', title: 'T1', rewardExp: 5 }).task;
  const t2 = publishTask(u(pubId), { type: 'public', title: 'T2', rewardExp: 5 }).task;

  insertConversationMessage('task', t1.id, pubId, { content: '属于任务1' });
  insertConversationMessage('task', t2.id, pubId, { content: '属于任务2' });

  const m1 = listConversationMessages('task', t1.id);
  const m2 = listConversationMessages('task', t2.id);
  assert.ok(m1.some((m) => m.content === '属于任务1'));
  assert.ok(!m1.some((m) => m.content === '属于任务2'));
  assert.ok(m2.some((m) => m.content === '属于任务2'));
  assert.ok(!m2.some((m) => m.content === '属于任务1'));
});

test('状态变更系统消息写入任务讨论区', () => {
  const pubId = makeUser(1000, 500);
  const assigneeId = makeUser(0, 0);
  const t = publishTask(u(pubId), { type: 'public', title: 'S', rewardExp: 10 }).task;
  acceptTask(u(assigneeId), t.id);

  const msgs = listConversationMessages('task', t.id);
  assert.ok(msgs.some((m) => m.type === 'system' && m.content.includes('发布了')));
  assert.ok(msgs.some((m) => m.type === 'system' && m.content.includes('接取了')));
});
