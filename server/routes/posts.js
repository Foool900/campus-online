import { Router } from 'express';
import { db, nowIso } from '../db.js';

const router = Router();

const SELECT_POST = `
  SELECT p.id,
         p.channel_id AS channelId,
         p.user_id    AS userId,
         p.title,
         p.content,
         p.category,
         p.created_at AS createdAt,
         u.nickname,
         u.avatar,
         u.college
  FROM posts p
  JOIN users u ON u.id = p.user_id
`;

// GET /api/channels/:channelId/posts —— 活动区帖子列表（新帖在前）
router.get('/channels/:channelId/posts', (req, res) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) {
    return res.status(400).json({ error: '无效的频道 ID' });
  }
  const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId);
  if (!channel) {
    return res.status(404).json({ error: '频道不存在' });
  }
  const posts = db.prepare(`${SELECT_POST} WHERE p.channel_id = ? ORDER BY p.id DESC`).all(channelId);
  res.json(posts);
});

// POST /api/channels/:channelId/posts —— 发布活动帖（body: { userId, title, content, category }）
router.post('/channels/:channelId/posts', (req, res) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) {
    return res.status(400).json({ error: '无效的频道 ID' });
  }

  const { userId, title, content, category } = req.body || {};
  const uid = Number(userId);
  if (!Number.isInteger(uid)) {
    return res.status(400).json({ error: '缺少有效的 userId' });
  }

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
    .prepare('INSERT INTO posts (channel_id, user_id, title, content, category, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(channelId, uid, t, body, cat, nowIso());

  const post = db.prepare(`${SELECT_POST} WHERE p.id = ?`).get(info.lastInsertRowid);
  res.status(201).json(post);
});

// 参与者判断：发起人视为默认参与者（未在 post_participants 里冗余存一条）
export function isParticipant(postId, userId) {
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
  if (!post) return false;
  if (post.user_id === userId) return true;
  return !!db
    .prepare('SELECT 1 FROM post_participants WHERE post_id = ? AND user_id = ?')
    .get(postId, userId);
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

// GET /api/posts/:id —— 活动详情（含参与者 + 当前用户是否已加入）
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
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const isJoined = Number.isInteger(userId) && isParticipant(id, userId);

  res.json({
    post,
    participants,
    participantCount: participants.length + 1, // 发起人 + 已加入者
    isJoined,
  });
});

// POST /api/posts/:id/join —— 报名/加入活动（幂等；发起人无需再入表）
router.post('/posts/:id/join', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: '无效的活动 ID' });
  }
  const { userId } = req.body || {};
  const uid = Number(userId);
  if (!Number.isInteger(uid)) {
    return res.status(400).json({ error: '缺少有效的 userId' });
  }
  const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(id);
  if (!post) return res.status(404).json({ error: '活动不存在' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  if (post.user_id !== uid) {
    db.prepare('INSERT OR IGNORE INTO post_participants (post_id, user_id, created_at) VALUES (?, ?, ?)').run(
      id,
      uid,
      nowIso()
    );
  }

  const participants = listParticipants(id);
  res.json({ participantCount: participants.length + 1, isJoined: true });
});

export default router;
