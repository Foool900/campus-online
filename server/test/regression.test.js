import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { insertConversationMessage, listConversationMessages, recallConversationMessage } = await import('../routes/messages.js');

initDb();

let seq = 0;
function makeUser() {
  seq += 1;
  const info = db
    .prepare(
      "INSERT INTO users (nickname, college, avatar, exp, available_exp, frozen_exp, role, created_at) VALUES (?, '计算机', '🎓', 0, 0, 0, 'student', ?)"
    )
    .run(`回归用户${seq}`, nowIso());
  return Number(info.lastInsertRowid);
}
function makeCampus() {
  return Number(db.prepare("INSERT INTO campuses (name, slug) VALUES ('回归校区', 'reg-campus')").run().lastInsertRowid);
}
function makeArea(campusId, name, slug, hidden = 0) {
  return Number(db.prepare('INSERT INTO areas (campus_id, name, slug, hidden) VALUES (?, ?, ?, ?)').run(campusId, name, slug, hidden).lastInsertRowid);
}
function makeChannel(areaId, name) {
  return Number(db.prepare('INSERT INTO channels (area_id, name) VALUES (?, ?)').run(areaId, name).lastInsertRowid);
}

// 一次性搭建旧功能所需的全部夹具
const campusId = makeCampus();
const worldCh = makeChannel(makeArea(campusId, '世界广场', 'world', 1), '世界频道');
const channel = makeChannel(makeArea(campusId, '图书馆', 'lib'), '图书馆频道');
const user1 = makeUser();
const user2 = makeUser();

const postId = Number(
  db.prepare("INSERT INTO posts (channel_id, user_id, title, content, category, status, created_at) VALUES (?, ?, '活动', '', '综合', 'open', ?)").run(channel, user1, nowIso()).lastInsertRowid
);

const convId = Number(db.prepare("INSERT INTO conversations (type, created_at) VALUES ('direct', ?)").run(nowIso()).lastInsertRowid);
db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(convId, user1, nowIso());
db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(convId, user2, nowIso());

const gconvId = Number(db.prepare("INSERT INTO conversations (type, created_at) VALUES ('group', ?)").run(nowIso()).lastInsertRowid);
db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(gconvId, user1, nowIso());
db.prepare("INSERT INTO groups (conversation_id, name, owner_id, created_at) VALUES (?, '回归群', ?, ?)").run(gconvId, user1, nowIso());

test('回归：chat（频道）消息仍可发', () => {
  const r = insertConversationMessage('chat', channel, user1, { content: 'chat 消息' });
  assert.equal(r.error, undefined);
  assert.equal(r.message.conversationType, 'chat');
  assert.equal(r.message.conversationId, channel);
});

test('回归：activity（活动）消息仍可发（发布者即参与者）', () => {
  const r = insertConversationMessage('activity', postId, user1, { content: 'activity 消息' });
  assert.equal(r.error, undefined);
  assert.equal(r.message.conversationType, 'activity');
  assert.equal(r.message.conversationId, postId);
});

test('回归：direct（私信）消息仍可发', () => {
  const r = insertConversationMessage('direct', convId, user1, { content: 'direct 消息' });
  assert.equal(r.error, undefined);
  assert.equal(r.message.conversationType, 'direct');
});

test('回归：group（群聊）消息仍可发', () => {
  const r = insertConversationMessage('group', gconvId, user1, { content: 'group 消息' });
  assert.equal(r.error, undefined);
  assert.equal(r.message.conversationType, 'group');
});

test('回归：chat 撤回仍可用（自己 2 分钟内）', () => {
  const sent = insertConversationMessage('chat', channel, user1, { content: '待撤回' });
  const r = recallConversationMessage('chat', channel, sent.message.id, user1);
  assert.equal(r.error, undefined);
  assert.equal(r.recalled, true);
});

test('回归：各会话类型消息互不串（conversation_type 隔离）', () => {
  const chatMsgs = listConversationMessages('chat', channel);
  const activityMsgs = listConversationMessages('activity', postId);
  assert.ok(chatMsgs.every((m) => m.conversationType === 'chat' && m.conversationId === channel));
  assert.ok(activityMsgs.every((m) => m.conversationType === 'activity' && m.conversationId === postId));
  assert.ok(!chatMsgs.some((m) => m.content === 'activity 消息'));
  assert.ok(!activityMsgs.some((m) => m.content === 'chat 消息'));
});
