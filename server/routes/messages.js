import { Router } from 'express';
import { db, nowIso } from '../db.js';

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

export default router;
