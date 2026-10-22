import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { isOnlineGlobal } from '../presence.js';
import {
  listConversationMessages,
  insertConversationMessage,
  recallConversationMessage,
  reactConversationMessage,
  readConversation,
  listReads,
  worldChannelId,
} from './messages.js';

const router = Router();

// 是否好友
function isFriend(a, b) {
  return !!db
    .prepare("SELECT 1 FROM friendships WHERE status = 'accepted' AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))")
    .get(a, b, b, a);
}

// 查找已存在的 direct 会话（幂等：同一对用户只有一个）
function findDirectConversation(a, b) {
  const c = db
    .prepare(
      `SELECT c.id FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
       JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
       WHERE c.type = 'direct' LIMIT 1`
    )
    .get(a, b);
  return c ? c.id : null;
}

function createConversation(type, memberIds, ownerId) {
  const info = db
    .prepare('INSERT INTO conversations (type, created_at, last_message_at) VALUES (?, ?, NULL)')
    .run(type, nowIso());
  const convId = Number(info.lastInsertRowid);
  const insertMember = db.prepare(
    'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at) VALUES (?, ?, ?, ?, NULL)'
  );
  for (const uid of memberIds) {
    insertMember.run(convId, uid, uid === ownerId ? 'owner' : 'member', nowIso());
  }
  return convId;
}

// 是否会话成员
function getMemberConversation(convId, userId) {
  const c = db.prepare('SELECT id, type FROM conversations WHERE id = ?').get(convId);
  if (!c) return null;
  const m = db
    .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(convId, userId);
  if (!m) return null;
  return { ...c, role: m.role };
}

// 会话成员列表
function listMembers(convId) {
  return db
    .prepare(
      `SELECT u.id, u.nickname, u.avatar, u.college, cm.role
       FROM conversation_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.conversation_id = ? ORDER BY cm.joined_at ASC`
    )
    .all(convId)
    .map((r) => ({ ...r, online: isOnlineGlobal(r.id) }));
}

// POST /api/conversations/direct —— 创建/获取私信会话（幂等）
router.post('/conversations/direct', (req, res) => {
  const friendId = Number(req.body?.friendId);
  if (!Number.isInteger(friendId)) return res.status(400).json({ error: '缺少有效的 friendId' });
  if (friendId === req.user.id) return res.status(400).json({ error: '不能和自己私信' });
  if (!isFriend(req.user.id, friendId)) return res.status(403).json({ error: '你们还不是好友' });

  const existing = findDirectConversation(req.user.id, friendId);
  if (existing) return res.json({ id: existing, type: 'direct' });

  const convId = createConversation('direct', [req.user.id, friendId]);
  res.status(201).json({ id: convId, type: 'direct' });
});

// 会话摘要：最后一条消息 + 未读数
function conversationSummary(convType, convId, meId, lastReadAt) {
  const last = db
    .prepare(
      `SELECT m.type, m.content, m.user_id, u.nickname
       FROM messages m JOIN users u ON u.id = m.user_id
       WHERE m.conversation_type = ? AND m.conversation_id = ?
       ORDER BY m.id DESC LIMIT 1`
    )
    .get(convType, convId);
  const unread = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages
       WHERE conversation_type = ? AND conversation_id = ? AND user_id != ? AND created_at > ?`
    )
    .get(convType, convId, meId, lastReadAt || '1970-01-01T00:00:00.000Z').c;

  let lastMessage = '';
  if (last) {
    if (last.type === 'sticker') lastMessage = '[表情包]';
    else if (last.type === 'system') lastMessage = last.content;
    else lastMessage = `${last.nickname}：${last.content}`;
  }
  return { lastMessage, unread };
}

// GET /api/conversations —— 我的会话列表（direct + group，含摘要/未读）
router.get('/conversations', (req, res) => {
  const me = req.user.id;
  const rows = db
    .prepare(
      `SELECT c.id, c.type, c.last_message_at AS lastMessageAt, cm.last_read_at AS lastReadAt
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE cm.user_id = ?`
    )
    .all(me);

  const list = rows.map((r) => {
    const item = { id: r.id, type: r.type, lastMessageAt: r.lastMessageAt, lastReadAt: r.lastReadAt };
    if (r.type === 'direct') {
      const other = db
        .prepare(
          `SELECT u.id, u.nickname, u.avatar
           FROM conversation_members cm JOIN users u ON u.id = cm.user_id
           WHERE cm.conversation_id = ? AND cm.user_id != ? LIMIT 1`
        )
        .get(r.id, me);
      item.name = other?.nickname || '私信';
      item.avatar = other?.avatar || '🎓';
      item.peerId = other?.id;
      item.online = other ? isOnlineGlobal(other.id) : false;
    } else {
      const g = db.prepare('SELECT name FROM groups WHERE conversation_id = ?').get(r.id);
      item.name = g?.name || '群聊';
      item.avatar = '👥';
    }
    Object.assign(item, conversationSummary(r.type, r.id, me, r.lastReadAt));
    return item;
  });

  list.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));
  res.json(list);
});

// GET /api/conversations/unread —— 总未读数（好友图标红点）
router.get('/conversations/unread', (req, res) => {
  const me = req.user.id;
  const rows = db
    .prepare(
      `SELECT c.type, c.id, cm.last_read_at AS lastReadAt
       FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE cm.user_id = ?`
    )
    .all(me);
  let total = 0;
  for (const r of rows) {
    total += db
      .prepare(
        `SELECT COUNT(*) AS c FROM messages
         WHERE conversation_type = ? AND conversation_id = ? AND user_id != ? AND created_at > ?`
      )
      .get(r.type, r.id, me, r.lastReadAt || '1970-01-01T00:00:00.000Z').c;
  }
  res.json({ total });
});

// GET /api/conversations/:id —— 会话信息 + 成员
router.get('/conversations/:id', (req, res) => {
  const convId = Number(req.params.id);
  const c = getMemberConversation(convId, req.user.id);
  if (!c) return res.status(403).json({ error: '无权访问该会话' });
  let name = null;
  if (c.type === 'group') {
    name = db.prepare('SELECT name FROM groups WHERE conversation_id = ?').get(convId)?.name || null;
  }
  res.json({ id: convId, type: c.type, name, role: c.role, members: listMembers(convId) });
});

// ===== 会话消息（direct / group，复用统一消息函数） =====
router.get('/conversations/:id/messages', (req, res) => {
  const convId = Number(req.params.id);
  const c = getMemberConversation(convId, req.user.id);
  if (!c) return res.status(403).json({ error: '无权访问该会话' });
  res.json(listConversationMessages(c.type, convId));
});

router.post('/conversations/:id/messages', (req, res) => {
  const convId = Number(req.params.id);
  const c = getMemberConversation(convId, req.user.id);
  if (!c) return res.status(403).json({ error: '无权访问该会话' });
  const result = insertConversationMessage(c.type, convId, req.user.id, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  // 更新会话最后消息时间
  db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(nowIso(), convId);
  const io = req.app.get('io');
  if (io) {
    io.to(`${c.type}:${convId}`).emit('message:new', {
      conversationType: c.type,
      conversationId: convId,
      message: result.message,
    });
  }
  res.status(201).json(result.message);
});

router.post('/conversations/:id/messages/:mid/recall', (req, res) => {
  const convId = Number(req.params.id);
  const c = getMemberConversation(convId, req.user.id);
  if (!c) return res.status(403).json({ error: '无权访问该会话' });
  const result = recallConversationMessage(c.type, convId, Number(req.params.mid), req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const io = req.app.get('io');
  if (io) io.to(`${c.type}:${convId}`).emit('message:recalled', { conversationType: c.type, conversationId: convId, messageId: result.messageId, recalledBy: req.user.id });
  res.json(result);
});

router.post('/conversations/:id/messages/:mid/react', (req, res) => {
  const convId = Number(req.params.id);
  const c = getMemberConversation(convId, req.user.id);
  if (!c) return res.status(403).json({ error: '无权访问该会话' });
  const result = reactConversationMessage(c.type, convId, Number(req.params.mid), req.user.id, req.body?.emoji);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const io = req.app.get('io');
  if (io) io.to(`${c.type}:${convId}`).emit('message:reaction', { conversationType: c.type, conversationId: convId, messageId: result.messageId, reactions: result.reactions });
  res.json(result);
});

router.get('/conversations/:id/messages/:mid/reads', (req, res) => {
  const convId = Number(req.params.id);
  const c = getMemberConversation(convId, req.user.id);
  if (!c) return res.status(403).json({ error: '无权访问该会话' });
  const rows = listReads(c.type, convId, Number(req.params.mid));
  if (rows === null) return res.status(404).json({ error: '消息不存在' });
  res.json(rows);
});

router.post('/conversations/:id/read', (req, res) => {
  const convId = Number(req.params.id);
  const c = getMemberConversation(convId, req.user.id);
  if (!c) return res.status(403).json({ error: '无权访问该会话' });
  const result = readConversation(c.type, convId, req.user.id, Number(req.body?.upToMessageId));
  if (result.error) return res.status(result.status).json({ error: result.error });
  db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').run(nowIso(), convId, req.user.id);
  res.json(result);
});

// 插入群聊系统消息
function insertSystemMessage(convType, convId, operatorId, content) {
  const info = db
    .prepare(
      "INSERT INTO messages (channel_id, user_id, post_id, conversation_type, conversation_id, type, content, created_at) VALUES (?, ?, NULL, ?, ?, 'system', ?, ?)"
    )
    .run(worldChannelId(), operatorId, convType, convId, content, nowIso());
  return db
    .prepare(
      `SELECT m.id, m.conversation_type AS conversationType, m.conversation_id AS conversationId, m.user_id AS userId, m.type, m.content, m.created_at AS createdAt, u.nickname, u.avatar
       FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`
    )
    .get(info.lastInsertRowid);
}

function nicknames(ids) {
  if (!ids.length) return '';
  const ph = ids.map(() => '?').join(',');
  return db
    .prepare(`SELECT nickname FROM users WHERE id IN (${ph})`)
    .all(...ids)
    .map((r) => r.nickname)
    .join('、');
}

// POST /api/conversations/group —— 创建群聊
router.post('/conversations/group', (req, res) => {
  const { name, memberIds } = req.body || {};
  const ids = (Array.isArray(memberIds) ? memberIds : []).map(Number).filter((n) => Number.isInteger(n) && n !== req.user.id);
  const unique = [...new Set(ids)];
  if (unique.length === 0) return res.status(400).json({ error: '请至少选择一位好友' });
  for (const fid of unique) {
    if (!isFriend(req.user.id, fid)) return res.status(403).json({ error: '只能邀请好友入群' });
  }

  const convId = createConversation('group', [req.user.id, ...unique], req.user.id);
  const gname = typeof name === 'string' && name.trim()
    ? name.trim()
    : `${[req.user.nickname, ...nicknames(unique).split('、')].slice(0, 3).join('、')}的群聊`;
  db.prepare('INSERT INTO groups (conversation_id, name, owner_id, created_at) VALUES (?, ?, ?, ?)').run(convId, gname, req.user.id, nowIso());

  const sys = insertSystemMessage('group', convId, req.user.id, `${req.user.nickname} 创建了群聊`);
  const io = req.app.get('io');
  if (io) io.to(`group:${convId}`).emit('message:new', { conversationType: 'group', conversationId: convId, message: sys });
  res.status(201).json({ id: convId, type: 'group', name: gname });
});

// POST /api/conversations/:id/members —— 拉人入群（群主）
router.post('/conversations/:id/members', (req, res) => {
  const convId = Number(req.params.id);
  const c = getMemberConversation(convId, req.user.id);
  if (!c || c.type !== 'group') return res.status(403).json({ error: '无权操作' });
  if (c.role !== 'owner') return res.status(403).json({ error: '仅群主可拉人' });
  const ids = (Array.isArray(req.body?.userIds) ? req.body.userIds : []).map(Number).filter((n) => Number.isInteger(n) && n !== req.user.id);
  const unique = [...new Set(ids)];
  if (unique.length === 0) return res.status(400).json({ error: '请选择要拉入的成员' });
  const insertMember = db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at) VALUES (?, ?, ?, ?, NULL)');
  for (const uid of unique) insertMember.run(convId, uid, 'member', nowIso());
  const sys = insertSystemMessage('group', convId, req.user.id, `${req.user.nickname} 邀请了 ${nicknames(unique)} 入群`);
  const io = req.app.get('io');
  if (io) io.to(`group:${convId}`).emit('message:new', { conversationType: 'group', conversationId: convId, message: sys });
  res.json({ ok: true });
});

// DELETE /api/conversations/:id/members/:userId —— 移除成员（群主）
router.delete('/conversations/:id/members/:userId', (req, res) => {
  const convId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const c = getMemberConversation(convId, req.user.id);
  if (!c || c.type !== 'group') return res.status(403).json({ error: '无权操作' });
  if (c.role !== 'owner') return res.status(403).json({ error: '仅群主可移除成员' });
  if (userId === req.user.id) return res.status(400).json({ error: '不能移除自己' });
  const target = db.prepare('SELECT nickname FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(convId, userId);
  const sys = insertSystemMessage('group', convId, req.user.id, `${target.nickname} 被移出群聊`);
  const io = req.app.get('io');
  if (io) io.to(`group:${convId}`).emit('message:new', { conversationType: 'group', conversationId: convId, message: sys });
  res.json({ ok: true });
});

// PATCH /api/conversations/:id/name —— 改群名（群主）
router.patch('/conversations/:id/name', (req, res) => {
  const convId = Number(req.params.id);
  const c = getMemberConversation(convId, req.user.id);
  if (!c || c.type !== 'group') return res.status(403).json({ error: '无权操作' });
  if (c.role !== 'owner') return res.status(403).json({ error: '仅群主可改群名' });
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 30) return res.status(400).json({ error: '群名需为 1-30 字' });
  db.prepare('UPDATE groups SET name = ? WHERE conversation_id = ?').run(name, convId);
  const sys = insertSystemMessage('group', convId, req.user.id, `${req.user.nickname} 将群名改为「${name}」`);
  const io = req.app.get('io');
  if (io) io.to(`group:${convId}`).emit('message:new', { conversationType: 'group', conversationId: convId, message: sys });
  res.json({ ok: true, name });
});

// DELETE /api/conversations/:id —— 解散群聊（群主）
router.delete('/conversations/:id', (req, res) => {
  const convId = Number(req.params.id);
  const c = getMemberConversation(convId, req.user.id);
  if (!c || c.type !== 'group') return res.status(403).json({ error: '无权操作' });
  if (c.role !== 'owner') return res.status(403).json({ error: '仅群主可解散群聊' });
  db.prepare("DELETE FROM messages WHERE conversation_type = 'group' AND conversation_id = ?").run(convId);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(convId);
  res.json({ ok: true });
});

export default router;
