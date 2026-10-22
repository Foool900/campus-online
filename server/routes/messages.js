import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { isParticipant } from './posts.js';

const router = Router();

/* ============================================================
   统一消息模型：conversation_type = 'activity' | 'chat'
   - activity：conversation_id = 活动 id（post_id）
   - chat：    conversation_id = 频道 id（channel_id；含区域频道与世界频道）
   查询 / 推送 / 互动全部按 (conversation_type, conversation_id) 做会话隔离。
   ============================================================ */
const SELECT_MESSAGE = `
  SELECT m.id,
         m.channel_id          AS channelId,
         m.post_id             AS postId,
         m.conversation_type   AS conversationType,
         m.conversation_id     AS conversationId,
         m.user_id             AS userId,
         m.type,
         m.content,
         m.reply_to,
         m.mentions,
         m.recalled_at,
         m.recalled_by,
         m.created_at          AS createdAt,
         u.nickname,
         u.avatar,
         u.college
  FROM messages m
  JOIN users u ON u.id = m.user_id
`;

function parseJson(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function mapMessage(row) {
  if (!row) return null;
  const recalled = row.type === 'recalled';
  return {
    id: row.id,
    channelId: row.channelId,
    postId: row.postId,
    conversationType: row.conversationType,
    conversationId: row.conversationId,
    userId: row.userId,
    type: row.type,
    content: recalled ? '' : row.content, // 撤回后不下发原文
    replyTo: recalled ? null : parseJson(row.reply_to),
    mentions: recalled ? [] : parseJson(row.mentions) || [],
    createdAt: row.createdAt,
    recalledAt: row.recalled_at,
    recalledBy: row.recalled_by,
    nickname: row.nickname,
    avatar: row.avatar,
    college: row.college,
    reactions: {},
    readBy: [],
  };
}

// 批量附加 reactions / readBy（长列表暂一次性聚合，规模大时再上分页/虚拟滚动）
function withInteractions(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');

  const reactionMap = new Map();
  db.prepare(`SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id IN (${ph})`)
    .all(...ids)
    .forEach((r) => {
      if (!reactionMap.has(r.message_id)) reactionMap.set(r.message_id, {});
      const m = reactionMap.get(r.message_id);
      if (!m[r.emoji]) m[r.emoji] = [];
      m[r.emoji].push(r.user_id);
    });

  const readMap = new Map();
  db.prepare(`SELECT message_id, user_id FROM message_reads WHERE message_id IN (${ph})`)
    .all(...ids)
    .forEach((r) => {
      if (!readMap.has(r.message_id)) readMap.set(r.message_id, []);
      readMap.get(r.message_id).push(r.user_id);
    });

  return rows.map((row) => {
    const m = mapMessage(row);
    m.reactions = reactionMap.get(row.id) || {};
    m.readBy = readMap.get(row.id) || [];
    return m;
  });
}

// 会话内发送消息（统一）：text / sticker，带 replyTo / mentions
export function insertConversationMessage(type, id, userId, payload) {
  const uid = Number(userId);
  if (!Number.isInteger(uid)) return { error: '缺少有效的 userId', status: 400 };

  const p = payload && typeof payload === 'object' ? payload : {};
  const msgType = p.type === 'sticker' ? 'sticker' : 'text';
  const text = typeof p.content === 'string' ? p.content.trim() : '';
  if (!text) return { error: '消息内容不能为空', status: 400 };
  if (text.length > 2000) return { error: '消息内容过长', status: 400 };

  let channelId;
  let postId;
  if (type === 'activity') {
    const post = db.prepare('SELECT id, channel_id, status FROM posts WHERE id = ?').get(id);
    if (!post) return { error: '活动不存在', status: 404 };
    if (post.status === 'ended' || post.status === 'cancelled') {
      return { error: '活动已结束或取消，全员只读', status: 403 };
    }
    if (!isParticipant(id, uid)) return { error: '加入活动后才能发言', status: 403 };
    channelId = post.channel_id;
    postId = id;
  } else if (type === 'chat') {
    const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(id);
    if (!channel) return { error: '频道不存在', status: 404 };
    channelId = id;
    postId = null;
  } else {
    return { error: '无效的会话类型', status: 400 };
  }

  const replyTo = p.replyTo && typeof p.replyTo === 'object' ? p.replyTo : null;
  const replyJson = replyTo
    ? JSON.stringify({
        messageId: Number(replyTo.messageId) || null,
        userId: Number(replyTo.userId) || null,
        userName: String(replyTo.userName || '').slice(0, 20),
        contentPreview: String(replyTo.contentPreview || '').slice(0, 100),
      })
    : null;

  const mentions = (Array.isArray(p.mentions) ? p.mentions : [])
    .filter((m) => m && m.userId)
    .slice(0, 20)
    .map((m) => ({ userId: Number(m.userId), userName: String(m.userName || '').slice(0, 20) }));
  const mentionsJson = mentions.length ? JSON.stringify(mentions) : null;

  const info = db
    .prepare(
      `INSERT INTO messages (channel_id, user_id, post_id, conversation_type, conversation_id, type, content, reply_to, mentions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(channelId, uid, postId, type, id, msgType, text, replyJson, mentionsJson, nowIso());

  const message = withInteractions([db.prepare(`${SELECT_MESSAGE} WHERE m.id = ?`).get(info.lastInsertRowid)])[0];
  return { message };
}

// 兼容旧调用方（Socket.IO 等）：聊天/世界频道
export function insertMessage(channelId, userId, content) {
  return insertConversationMessage('chat', channelId, userId, { content });
}

// 兼容旧调用方（Socket.IO 等）：活动讨论区
export function insertPostMessage(postId, userId, payload) {
  return insertConversationMessage('activity', postId, userId, payload);
}

function listConversationMessages(type, id) {
  const rows = db
    .prepare(`${SELECT_MESSAGE} WHERE m.conversation_type = ? AND m.conversation_id = ? ORDER BY m.id ASC`)
    .all(type, id);
  return withInteractions(rows);
}

function getConversationMessage(type, id, messageId) {
  return db
    .prepare('SELECT * FROM messages WHERE id = ? AND conversation_type = ? AND conversation_id = ?')
    .get(messageId, type, id);
}

// 撤回：activity 管理员可撤任意；自己 2 分钟内可撤（chat 无管理员）
function recallConversationMessage(type, id, messageId, userId) {
  const msg = getConversationMessage(type, id, messageId);
  if (!msg) return { error: '消息不存在', status: 404 };
  if (msg.type === 'recalled') return { error: '消息已撤回', status: 409 };
  if (msg.type === 'system') return { error: '系统消息不可撤回', status: 403 };

  let isAdmin = false;
  if (type === 'activity') {
    const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(id);
    isAdmin = post.user_id === userId;
  }
  const isOwn = msg.user_id === userId;

  if (isAdmin) {
    // 管理员可撤任意消息，不限时
  } else if (isOwn) {
    if (Date.now() - new Date(msg.created_at).getTime() > 2 * 60 * 1000) {
      return { error: '超过 2 分钟，不可撤回', status: 403 };
    }
  } else {
    return { error: '无权撤回他人消息', status: 403 };
  }

  db.prepare("UPDATE messages SET type = 'recalled', recalled_at = ?, recalled_by = ? WHERE id = ?").run(
    nowIso(),
    userId,
    messageId
  );
  return { messageId, recalled: true };
}

// 表情回应：activity 需参与者且非终态；chat 开放
function reactConversationMessage(type, id, messageId, userId, emoji) {
  const msg = getConversationMessage(type, id, messageId);
  if (!msg) return { error: '消息不存在', status: 404 };
  if (msg.type === 'recalled' || msg.type === 'system') return { error: '该消息不可回应', status: 403 };

  if (type === 'activity') {
    const post = db.prepare('SELECT status FROM posts WHERE id = ?').get(id);
    if (post.status === 'ended' || post.status === 'cancelled') {
      return { error: '活动已结束或取消，全员只读', status: 403 };
    }
    if (!isParticipant(id, userId)) return { error: '加入活动后可参与互动', status: 403 };
  }

  const e = typeof emoji === 'string' ? emoji.trim() : '';
  if (!e || e.length > 8) return { error: '无效的表情', status: 400 };

  const existing = db
    .prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND emoji = ? AND user_id = ?')
    .get(messageId, e, userId);
  if (existing) {
    db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND emoji = ? AND user_id = ?').run(messageId, e, userId);
  } else {
    db.prepare('INSERT INTO message_reactions (message_id, emoji, user_id, created_at) VALUES (?, ?, ?, ?)').run(
      messageId,
      e,
      userId,
      nowIso()
    );
  }

  const reactions = {};
  db.prepare('SELECT emoji, user_id FROM message_reactions WHERE message_id = ?')
    .all(messageId)
    .forEach((r) => {
      if (!reactions[r.emoji]) reactions[r.emoji] = [];
      reactions[r.emoji].push(r.user_id);
    });
  return { messageId, reactions };
}

function readConversation(type, id, userId, upTo) {
  if (type === 'activity' && !isParticipant(id, userId)) {
    return { error: '加入活动后可标记已读', status: 403 };
  }
  db.prepare(
    `INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at)
     SELECT id, ?, ? FROM messages WHERE conversation_type = ? AND conversation_id = ? AND id <= ? AND type != 'system'`
  ).run(userId, nowIso(), type, id, upTo);
  return { ok: true };
}

function listReads(type, id, messageId) {
  const msg = getConversationMessage(type, id, messageId);
  if (!msg) return null;
  return db
    .prepare(
      `SELECT u.id, u.nickname, u.avatar
       FROM message_reads mr JOIN users u ON u.id = mr.user_id
       WHERE mr.message_id = ? ORDER BY mr.read_at ASC, u.id ASC`
    )
    .all(messageId);
}

// ===== 路由：频道聊天（chat） =====
router.get('/channels/:channelId/messages', (req, res) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) return res.status(400).json({ error: '无效的频道 ID' });
  if (!db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId)) {
    return res.status(404).json({ error: '频道不存在' });
  }
  res.json(listConversationMessages('chat', channelId));
});

router.post('/channels/:channelId/messages', (req, res) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) return res.status(400).json({ error: '无效的频道 ID' });
  const result = insertConversationMessage('chat', channelId, req.body?.userId, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json(result.message);
});

router.post('/channels/:channelId/messages/:messageId/recall', (req, res) => {
  const result = recallConversationMessage('chat', Number(req.params.channelId), Number(req.params.messageId), Number(req.body?.userId));
  if (result.error) return res.status(result.status).json({ error: result.error });
  const io = req.app.get('io');
  if (io) io.to(`channel:${Number(req.params.channelId)}`).emit('message:recalled', { conversationType: 'chat', conversationId: Number(req.params.channelId), messageId: result.messageId, recalledBy: Number(req.body?.userId) });
  res.json(result);
});

router.post('/channels/:channelId/messages/:messageId/react', (req, res) => {
  const result = reactConversationMessage('chat', Number(req.params.channelId), Number(req.params.messageId), Number(req.body?.userId), req.body?.emoji);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const io = req.app.get('io');
  if (io) io.to(`channel:${Number(req.params.channelId)}`).emit('message:reaction', { conversationType: 'chat', conversationId: Number(req.params.channelId), messageId: result.messageId, reactions: result.reactions });
  res.json(result);
});

router.get('/channels/:channelId/messages/:messageId/reads', (req, res) => {
  const rows = listReads('chat', Number(req.params.channelId), Number(req.params.messageId));
  if (rows === null) return res.status(404).json({ error: '消息不存在' });
  res.json(rows);
});

router.post('/channels/:channelId/read', (req, res) => {
  const result = readConversation('chat', Number(req.params.channelId), Number(req.body?.userId), Number(req.body?.upToMessageId));
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// ===== 路由：活动讨论区（activity） =====
router.get('/posts/:id/messages', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '无效的活动 ID' });
  if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(id)) {
    return res.status(404).json({ error: '活动不存在' });
  }
  res.json(listConversationMessages('activity', id));
});

router.post('/posts/:id/messages', (req, res) => {
  const result = insertConversationMessage('activity', req.params.id, req.body?.userId, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json(result.message);
});

router.post('/posts/:id/messages/:messageId/recall', (req, res) => {
  const id = Number(req.params.id);
  const result = recallConversationMessage('activity', id, Number(req.params.messageId), Number(req.body?.userId));
  if (result.error) return res.status(result.status).json({ error: result.error });
  const io = req.app.get('io');
  if (io) io.to(`post:${id}`).emit('message:recalled', { conversationType: 'activity', conversationId: id, messageId: result.messageId, recalledBy: Number(req.body?.userId) });
  res.json(result);
});

router.post('/posts/:id/messages/:messageId/react', (req, res) => {
  const id = Number(req.params.id);
  const result = reactConversationMessage('activity', id, Number(req.params.messageId), Number(req.body?.userId), req.body?.emoji);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const io = req.app.get('io');
  if (io) io.to(`post:${id}`).emit('message:reaction', { conversationType: 'activity', conversationId: id, messageId: result.messageId, reactions: result.reactions });
  res.json(result);
});

router.get('/posts/:id/messages/:messageId/reads', (req, res) => {
  const rows = listReads('activity', Number(req.params.id), Number(req.params.messageId));
  if (rows === null) return res.status(404).json({ error: '消息不存在' });
  res.json(rows);
});

router.post('/posts/:id/read', (req, res) => {
  const result = readConversation('activity', Number(req.params.id), Number(req.body?.userId), Number(req.body?.upToMessageId));
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

export default router;
