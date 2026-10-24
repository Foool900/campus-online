import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { onlineCount } from '../presence.js';
import { requireRole } from '../auth.js';
import { notifyNewProgressAchievements } from '../achievements.js';

const router = Router();

const SELECT_POST = `
  SELECT p.id,
         p.channel_id AS channelId,
         p.user_id    AS userId,
         p.title,
         p.content,
         p.category,
         p.status,
         p.created_at AS createdAt,
         u.nickname,
         u.avatar,
         u.college
  FROM posts p
  JOIN users u ON u.id = p.user_id
`;

// 活动状态机
export const POST_STATUS = ['draft', 'open', 'ongoing', 'ended', 'cancelled'];
export const STATUS_LABELS = {
  draft: '草稿',
  open: '报名中',
  ongoing: '进行中',
  ended: '已结束',
  cancelled: '已取消',
};
// 允许的转移（仅管理员可改；ended/cancelled 为终态不可再变）
const TRANSITIONS = {
  draft: ['open', 'cancelled'],
  open: ['ongoing', 'ended', 'cancelled'],
  ongoing: ['ended', 'cancelled'],
  ended: [],
  cancelled: [],
};

// 参与者判断：发起人视为默认参与者（不重复入库）
export function isParticipant(postId, userId) {
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
  if (!post) return false;
  if (post.user_id === userId) return true;
  return !!db
    .prepare('SELECT 1 FROM post_participants WHERE post_id = ? AND user_id = ?')
    .get(postId, userId);
}

// 角色：admin(发起人，不可转让) / participant(已加入) / guest(访客)
export function getRole(postId, userId) {
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
  if (!post) return 'guest';
  if (post.user_id === userId) return 'admin';
  return isParticipant(postId, userId) ? 'participant' : 'guest';
}

function listParticipants(postId) {
  return db
    .prepare(
      `SELECT u.id, u.nickname, u.avatar, u.college
       FROM post_participants pp
       JOIN users u ON u.id = pp.user_id
       WHERE pp.post_id = ?
       ORDER BY pp.created_at ASC, u.id ASC`
    )
    .all(postId);
}

// 系统消息（状态变更等）——直接写 messages，返回完整消息对象
const SELECT_MSG = `
  SELECT m.id,
         m.channel_id AS channelId,
         m.post_id    AS postId,
         m.user_id    AS userId,
         m.type,
         m.content,
         m.created_at AS createdAt,
         u.nickname,
         u.avatar,
         u.college
  FROM messages m
  JOIN users u ON u.id = m.user_id
`;
function insertSystemMessage(postId, operatorId, content) {
  const post = db.prepare('SELECT channel_id FROM posts WHERE id = ?').get(postId);
  const info = db
    .prepare(
      'INSERT INTO messages (channel_id, user_id, post_id, type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(post.channel_id, operatorId, postId, 'system', content, nowIso());
  return db.prepare(`${SELECT_MSG} WHERE m.id = ?`).get(info.lastInsertRowid);
}

function parseJson(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// 活动卡片聚合信息：在线数 / 未读数 / 最近 1~2 条消息摘要 / 是否 @我 或回复我
function cardSummary(postId, userId) {
  const summary = { onlineCount: onlineCount('activity', postId), unreadCount: 0, recentMessages: [], hasMentionMe: false, hasReplyMe: false };

  const recent = db
    .prepare(
      `SELECT m.content, m.type, u.nickname
       FROM messages m JOIN users u ON u.id = m.user_id
       WHERE m.post_id = ? AND m.type NOT IN ('system', 'recalled')
       ORDER BY m.id DESC LIMIT 2`
    )
    .all(postId);
  summary.recentMessages = recent.map((r) => ({
    type: r.type,
    content: r.type === 'sticker' ? '[表情包]' : r.content,
    nickname: r.nickname,
  }));

  if (Number.isInteger(userId) && userId > 0) {
    const unread = db
      .prepare(
        `SELECT COUNT(*) AS c FROM messages m
         WHERE m.post_id = ? AND m.type NOT IN ('system', 'recalled') AND m.user_id != ?
           AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id = ?)`
      )
      .get(postId, userId, userId);
    summary.unreadCount = unread.c;

    const rows = db
      .prepare(
        `SELECT mentions, reply_to FROM messages
         WHERE post_id = ? AND (mentions IS NOT NULL OR reply_to IS NOT NULL)
         ORDER BY id DESC LIMIT 50`
      )
      .all(postId);
    for (const r of rows) {
      if (!summary.hasMentionMe && (parseJson(r.mentions) || []).some((x) => x.userId === userId)) {
        summary.hasMentionMe = true;
      }
      if (!summary.hasReplyMe && parseJson(r.reply_to)?.userId === userId) {
        summary.hasReplyMe = true;
      }
      if (summary.hasMentionMe && summary.hasReplyMe) break;
    }
  }

  return summary;
}

// GET /api/channels/:channelId/posts —— 活动区帖子列表（新帖在前，附卡片聚合）
router.get('/channels/:channelId/posts', (req, res) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) {
    return res.status(400).json({ error: '无效的频道 ID' });
  }
  const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId);
  if (!channel) {
    return res.status(404).json({ error: '频道不存在' });
  }
  const userId = req.user.id;
  const posts = db.prepare(`${SELECT_POST} WHERE p.channel_id = ? ORDER BY p.id DESC`).all(channelId);
  res.json(posts.map((p) => ({ ...p, ...cardSummary(p.id, userId) })));
});

// POST /api/channels/:channelId/posts —— 发布活动帖（body: { userId, title, content, category }）
router.post('/channels/:channelId/posts', requireRole('student', 'admin'), (req, res) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) {
    return res.status(400).json({ error: '无效的频道 ID' });
  }

  const { title, content, category } = req.body || {};
  const uid = req.user.id;

  const t = typeof title === 'string' ? title.trim() : '';
  if (!t) {
    return res.status(400).json({ error: '帖子标题不能为空' });
  }
  if (t.length > 60) {
    return res.status(400).json({ error: '帖子标题过长（最多 60 字）' });
  }
  const body = typeof content === 'string' ? content.trim() : '';
  if (body.length > 2000) {
    return res.status(400).json({ error: '帖子正文过长（最多 2000 字）' });
  }
  const cat = typeof category === 'string' && category.trim() ? category.trim() : '综合';

  const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId);
  if (!channel) {
    return res.status(404).json({ error: '频道不存在' });
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  const info = db
    .prepare('INSERT INTO posts (channel_id, user_id, title, content, category, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(channelId, uid, t, body, cat, 'open', nowIso());

  const post = db.prepare(`${SELECT_POST} WHERE p.id = ?`).get(info.lastInsertRowid);
  // 发布活动帖可能让 posts_created 进度型成就跨过阈值 → 检测并弹窗
  notifyNewProgressAchievements(uid, req.app.get('io'));
  res.status(201).json(post);
});

// GET /api/posts/:id —— 活动详情（含参与者 + 当前用户角色）
router.get('/posts/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: '无效的活动 ID' });
  }
  const post = db.prepare(`${SELECT_POST} WHERE p.id = ?`).get(id);
  if (!post) {
    return res.status(404).json({ error: '活动不存在' });
  }

  const participants = listParticipants(id);
  const userId = req.user.id;
  const role = getRole(id, userId);

  res.json({
    post,
    participants,
    participantCount: participants.length + 1, // 发起人 + 已加入者
    role,
    isJoined: role !== 'guest',
  });
});

// POST /api/posts/:id/join —— 报名/加入活动（幂等；仅「报名中」状态可加入）
router.post('/posts/:id/join', requireRole('student', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: '无效的活动 ID' });
  }
  const uid = req.user.id;
  const post = db.prepare('SELECT id, user_id, status FROM posts WHERE id = ?').get(id);
  if (!post) return res.status(404).json({ error: '活动不存在' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  if (post.status !== 'open') {
    return res.status(403).json({ error: '当前状态不可报名' });
  }

  if (post.user_id !== uid) {
    db.prepare('INSERT OR IGNORE INTO post_participants (post_id, user_id, created_at) VALUES (?, ?, ?)').run(
      id,
      uid,
      nowIso()
    );
  }

  const participants = listParticipants(id);
  res.json({ participantCount: participants.length + 1, role: getRole(id, uid) });
});

// PATCH /api/posts/:id/status —— 管理员改状态（写系统消息 + 操作日志）
router.patch('/posts/:id/status', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: '无效的活动 ID' });
  }
  const { status } = req.body || {};
  const uid = req.user.id;
  const post = db.prepare('SELECT id, user_id, status FROM posts WHERE id = ?').get(id);
  if (!post) return res.status(404).json({ error: '活动不存在' });
  if (post.user_id !== uid) {
    return res.status(403).json({ error: '仅活动发起人可修改状态' });
  }
  if (!POST_STATUS.includes(status)) {
    return res.status(400).json({ error: '无效的状态值' });
  }
  if (status === post.status) {
    return res.status(409).json({ error: '状态未变化' });
  }
  if (!TRANSITIONS[post.status].includes(status)) {
    return res.status(409).json({ error: `当前状态不允许变更为「${STATUS_LABELS[status]}」` });
  }

  db.prepare('UPDATE posts SET status = ? WHERE id = ?').run(status, id);
  db.prepare(
    'INSERT INTO post_operation_logs (post_id, operator_id, action, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, uid, 'status_change', post.status, status, nowIso());

  const systemMessage = insertSystemMessage(id, uid, `管理员将活动状态改为「${STATUS_LABELS[status]}」`);
  const io = req.app.get('io');
  if (io) {
    io.to(`post:${id}`).emit('message:new', { postId: id, message: systemMessage });
    io.to(`post:${id}`).emit('post:status', { postId: id, status });
  }

  res.json({ post: db.prepare(`${SELECT_POST} WHERE p.id = ?`).get(id), systemMessage });
});

function mapNote(row) {
  if (!row) return row;
  return {
    id: row.id,
    content: row.content,
    createdBy: row.created_by,
    creatorName: row.nickname,
    creatorAvatar: row.avatar,
    createdAt: row.created_at,
    visibleToParticipants: !!row.visible_to_participants,
  };
}

const SELECT_NOTE = `
  SELECT n.id, n.content, n.created_by, n.created_at, n.visible_to_participants,
         u.nickname, u.avatar
  FROM post_notes n
  JOIN users u ON u.id = n.created_by
`;

// GET /api/posts/:id/notes —— 备注（admin 看全部；participant 看对参与者可见的；guest 看不到）
router.get('/posts/:id/notes', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: '无效的活动 ID' });
  }
  const userId = req.user.id;
  const role = getRole(id, userId);

  let rows = [];
  if (role === 'admin') {
    rows = db.prepare(`${SELECT_NOTE} WHERE n.post_id = ? ORDER BY n.id DESC`).all(id);
  } else if (role === 'participant') {
    rows = db
      .prepare(`${SELECT_NOTE} WHERE n.post_id = ? AND n.visible_to_participants = 1 ORDER BY n.id DESC`)
      .all(id);
  }
  res.json(rows.map(mapNote));
});

// POST /api/posts/:id/notes —— 管理员加备注
router.post('/posts/:id/notes', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: '无效的活动 ID' });
  }
  const { content, visibleToParticipants } = req.body || {};
  const uid = req.user.id;
  const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(id);
  if (!post) return res.status(404).json({ error: '活动不存在' });
  if (post.user_id !== uid) {
    return res.status(403).json({ error: '仅活动发起人可添加备注' });
  }
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) {
    return res.status(400).json({ error: '备注内容不能为空' });
  }
  if (text.length > 500) {
    return res.status(400).json({ error: '备注内容过长（最多 500 字）' });
  }

  const info = db
    .prepare('INSERT INTO post_notes (post_id, content, created_by, created_at, visible_to_participants) VALUES (?, ?, ?, ?, ?)')
    .run(id, text, uid, nowIso(), visibleToParticipants ? 1 : 0);
  db.prepare(
    'INSERT INTO post_operation_logs (post_id, operator_id, action, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, uid, 'note_add', null, null, nowIso());

  const note = mapNote(db.prepare(`${SELECT_NOTE} WHERE n.id = ?`).get(info.lastInsertRowid));
  res.status(201).json(note);
});

export default router;
