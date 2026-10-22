import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { isParticipant } from './posts.js';

const router = Router();

const SELECT_MESSAGE = `
  SELECT m.id,
         m.channel_id AS channelId,
         m.user_id    AS userId,
         m.content,
         m.created_at AS createdAt,
         u.nickname,
         u.avatar,
         u.college
  FROM messages m
  JOIN users u ON u.id = m.user_id
`;

// REST 与 Socket.IO 共用的发送逻辑：校验并入库，返回 { error, status } 或 { message }
export function insertMessage(channelId, userId, content) {
  const cid = Number(channelId);
  if (!Number.isInteger(cid)) return { error: '无效的频道 ID', status: 400 };
  const uid = Number(userId);
  if (!Number.isInteger(uid)) return { error: '缺少有效的 userId', status: 400 };

  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) return { error: '消息内容不能为空', status: 400 };
  if (text.length > 500) return { error: '消息内容过长（最多 500 字）', status: 400 };

  const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(cid);
  if (!channel) return { error: '频道不存在', status: 404 };
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
  if (!user) return { error: '用户不存在', status: 404 };

  const info = db
    .prepare('INSERT INTO messages (channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?)')
    .run(cid, uid, text, nowIso());

  const message = db.prepare(`${SELECT_MESSAGE} WHERE m.id = ?`).get(info.lastInsertRowid);
  return { message };
}

// GET /api/channels/:channelId/messages —— 频道历史消息
router.get('/channels/:channelId/messages', (req, res) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) {
    return res.status(400).json({ error: '无效的频道 ID' });
  }
  const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId);
  if (!channel) {
    return res.status(404).json({ error: '频道不存在' });
  }

  const messages = db.prepare(`${SELECT_MESSAGE} WHERE m.channel_id = ? ORDER BY m.id ASC`).all(channelId);
  res.json(messages);
});

// POST /api/channels/:channelId/messages —— 发送消息（内容原样入库，前端用 React 文本节点安全渲染）
router.post('/channels/:channelId/messages', (req, res) => {
  const { userId, content } = req.body || {};
  const result = insertMessage(req.params.channelId, userId, content);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.status(201).json(result.message);
});

/* ============================================================
   活动讨论区消息（带回复 / 提及 / 回应 / 已读 / 撤回）
   ============================================================ */
const SELECT_POST_MESSAGE = `
  SELECT m.id,
         m.channel_id  AS channelId,
         m.post_id     AS postId,
         m.user_id     AS userId,
         m.type,
         m.content,
         m.reply_to,
         m.mentions,
         m.recalled_at,
         m.recalled_by,
         m.created_at  AS createdAt,
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
    userId: row.userId,
    type: row.type,
    // 撤回后不下发原文
    content: recalled ? '' : row.content,
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

// 活动讨论区：发送消息（text / sticker；仅参与者可发；终态只读）
// payload: { type, content, replyTo, mentions }
export function insertPostMessage(postId, userId, payload) {
  const pid = Number(postId);
  if (!Number.isInteger(pid)) return { error: '无效的活动 ID', status: 400 };
  const uid = Number(userId);
  if (!Number.isInteger(uid)) return { error: '缺少有效的 userId', status: 400 };

  const p = payload && typeof payload === 'object' ? payload : {};
  const type = p.type === 'sticker' ? 'sticker' : 'text';
  const text = typeof p.content === 'string' ? p.content.trim() : '';
  if (!text) return { error: '消息内容不能为空', status: 400 };
  if (text.length > 2000) return { error: '消息内容过长', status: 400 };

  const post = db.prepare('SELECT id, channel_id, status FROM posts WHERE id = ?').get(pid);
  if (!post) return { error: '活动不存在', status: 404 };
  if (post.status === 'ended' || post.status === 'cancelled') {
    return { error: '活动已结束或取消，全员只读', status: 403 };
  }
  if (!isParticipant(pid, uid)) return { error: '加入活动后才能发言', status: 403 };

  // 序列化回复引用（做基础清洗）
  const replyTo = p.replyTo && typeof p.replyTo === 'object' ? p.replyTo : null;
  const replyJson = replyTo
    ? JSON.stringify({
        messageId: Number(replyTo.messageId) || null,
        userId: Number(replyTo.userId) || null,
        userName: String(replyTo.userName || '').slice(0, 20),
        contentPreview: String(replyTo.contentPreview || '').slice(0, 100),
      })
    : null;

  // 序列化提及列表
  const mentions = (Array.isArray(p.mentions) ? p.mentions : [])
    .filter((m) => m && m.userId)
    .slice(0, 20)
    .map((m) => ({ userId: Number(m.userId), userName: String(m.userName || '').slice(0, 20) }));
  const mentionsJson = mentions.length ? JSON.stringify(mentions) : null;

  const info = db
    .prepare(
      'INSERT INTO messages (channel_id, user_id, post_id, type, content, reply_to, mentions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(post.channel_id, uid, pid, type, text, replyJson, mentionsJson, nowIso());

  const message = withInteractions([db.prepare(`${SELECT_POST_MESSAGE} WHERE m.id = ?`).get(info.lastInsertRowid)])[0];
  return { message };
}

// GET /api/posts/:id/messages —— 活动讨论区历史消息（旧在上、新在下）
router.get('/posts/:id/messages', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: '无效的活动 ID' });
  }
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(id);
  if (!post) {
    return res.status(404).json({ error: '活动不存在' });
  }
  const rows = db.prepare(`${SELECT_POST_MESSAGE} WHERE m.post_id = ? ORDER BY m.id ASC`).all(id);
  res.json(withInteractions(rows));
});

// POST /api/posts/:id/messages —— 发送讨论区消息
router.post('/posts/:id/messages', (req, res) => {
  const result = insertPostMessage(req.params.id, req.body?.userId, req.body || {});
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.status(201).json(result.message);
});

// POST /api/posts/:id/messages/:messageId/recall —— 撤回
router.post('/posts/:id/messages/:messageId/recall', (req, res) => {
  const postId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  const { userId } = req.body || {};
  const uid = Number(userId);
  if (!Number.isInteger(postId) || !Number.isInteger(messageId)) {
    return res.status(400).json({ error: '无效的 ID' });
  }
  if (!Number.isInteger(uid)) {
    return res.status(400).json({ error: '缺少有效的 userId' });
  }
  const msg = db.prepare('SELECT id, user_id, type, created_at FROM messages WHERE id = ? AND post_id = ?').get(messageId, postId);
  if (!msg) return res.status(404).json({ error: '消息不存在' });
  if (msg.type === 'recalled') return res.status(409).json({ error: '消息已撤回' });
  if (msg.type === 'system') return res.status(403).json({ error: '系统消息不可撤回' });

  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
  const isAdmin = post.user_id === uid;
  const isOwn = msg.user_id === uid;

  if (isAdmin) {
    // 管理员可撤任意消息，不限时
  } else if (isOwn) {
    const age = Date.now() - new Date(msg.created_at).getTime();
    if (age > 2 * 60 * 1000) return res.status(403).json({ error: '超过 2 分钟，不可撤回' });
  } else {
    return res.status(403).json({ error: '无权撤回他人消息' });
  }

  db.prepare("UPDATE messages SET type = 'recalled', recalled_at = ?, recalled_by = ? WHERE id = ?").run(
    nowIso(),
    uid,
    messageId
  );

  const io = req.app.get('io');
  if (io) io.to(`post:${postId}`).emit('message:recalled', { postId, messageId, recalledBy: uid });

  res.json({ messageId, recalled: true });
});

// POST /api/posts/:id/messages/:messageId/react —— 表情回应（toggle）
router.post('/posts/:id/messages/:messageId/react', (req, res) => {
  const postId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  const { userId, emoji } = req.body || {};
  const uid = Number(userId);
  if (!Number.isInteger(postId) || !Number.isInteger(messageId)) {
    return res.status(400).json({ error: '无效的 ID' });
  }
  if (!Number.isInteger(uid)) {
    return res.status(400).json({ error: '缺少有效的 userId' });
  }
  const msg = db.prepare('SELECT id, type FROM messages WHERE id = ? AND post_id = ?').get(messageId, postId);
  if (!msg) return res.status(404).json({ error: '消息不存在' });
  if (msg.type === 'recalled' || msg.type === 'system') return res.status(403).json({ error: '该消息不可回应' });

  const post = db.prepare('SELECT status FROM posts WHERE id = ?').get(postId);
  if (post.status === 'ended' || post.status === 'cancelled') {
    return res.status(403).json({ error: '活动已结束或取消，全员只读' });
  }
  if (!isParticipant(postId, uid)) return res.status(403).json({ error: '加入活动后可参与互动' });

  const e = typeof emoji === 'string' ? emoji.trim() : '';
  if (!e || e.length > 8) return res.status(400).json({ error: '无效的表情' });

  const existing = db
    .prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND emoji = ? AND user_id = ?')
    .get(messageId, e, uid);
  if (existing) {
    db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND emoji = ? AND user_id = ?').run(messageId, e, uid);
  } else {
    db.prepare('INSERT INTO message_reactions (message_id, emoji, user_id, created_at) VALUES (?, ?, ?, ?)').run(
      messageId,
      e,
      uid,
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

  const io = req.app.get('io');
  if (io) io.to(`post:${postId}`).emit('message:reaction', { postId, messageId, reactions });

  res.json({ messageId, reactions });
});

// GET /api/posts/:id/messages/:messageId/reads —— 已读名单（懒加载）
router.get('/posts/:id/messages/:messageId/reads', (req, res) => {
  const postId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  if (!Number.isInteger(postId) || !Number.isInteger(messageId)) {
    return res.status(400).json({ error: '无效的 ID' });
  }
  const msg = db.prepare('SELECT id FROM messages WHERE id = ? AND post_id = ?').get(messageId, postId);
  if (!msg) return res.status(404).json({ error: '消息不存在' });

  const rows = db
    .prepare(
      `SELECT u.id, u.nickname, u.avatar
       FROM message_reads mr JOIN users u ON u.id = mr.user_id
       WHERE mr.message_id = ? ORDER BY mr.read_at ASC, u.id ASC`
    )
    .all(messageId);
  res.json(rows);
});

// POST /api/posts/:id/read —— 标记已读（upToMessageId 及之前的消息）
router.post('/posts/:id/read', (req, res) => {
  const postId = Number(req.params.id);
  const { userId, upToMessageId } = req.body || {};
  const uid = Number(userId);
  const upTo = Number(upToMessageId);
  if (!Number.isInteger(postId)) return res.status(400).json({ error: '无效的活动 ID' });
  if (!Number.isInteger(uid)) return res.status(400).json({ error: '缺少有效的 userId' });
  if (!Number.isInteger(upTo)) return res.status(400).json({ error: '缺少有效的 upToMessageId' });
  if (!isParticipant(postId, uid)) return res.status(403).json({ error: '加入活动后可标记已读' });

  db.prepare(
    `INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at)
     SELECT id, ?, ? FROM messages WHERE post_id = ? AND id <= ? AND type != 'system'`
  ).run(uid, nowIso(), postId, upTo);

  res.json({ ok: true });
});

export default router;
