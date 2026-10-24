import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { isOnlineGlobal } from '../presence.js';

const router = Router();

// 我与对方的好友关系状态：none | pending(我发出) | incoming(待我处理) | friend | blocked
function friendStatus(meId, otherId) {
  const f = db
    .prepare('SELECT * FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)')
    .get(meId, otherId, otherId, meId);
  if (!f) return 'none';
  if (f.status === 'blocked') return 'blocked';
  if (f.status === 'accepted') return 'friend';
  if (f.status === 'pending') return f.user_id === meId ? 'pending' : 'incoming';
  return 'none';
}

function mapUser(row) {
  if (!row) return row;
  return { id: row.id, nickname: row.nickname, avatar: row.avatar, college: row.college };
}

// GET /api/friends/search?q=&limit= —— 按昵称精确搜索（排除自己，仅公开字段）
router.get('/friends/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const rows = db
    .prepare("SELECT id, nickname, avatar, college FROM users WHERE nickname = ? AND id != ? AND role != 'system' ORDER BY id ASC LIMIT ?")
    .all(q, req.user.id, limit);
  res.json(rows.map((r) => ({ ...mapUser(r), friendStatus: friendStatus(req.user.id, r.id) })));
});

// POST /api/friends/request —— 发送好友申请 { friendId, message }
router.post('/friends/request', (req, res) => {
  const friendId = Number(req.body?.friendId);
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!Number.isInteger(friendId)) return res.status(400).json({ error: '缺少有效的 friendId' });
  if (friendId === req.user.id) return res.status(400).json({ error: '不能添加自己为好友' });
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(friendId);
  if (!target) return res.status(404).json({ error: '用户不存在' });

  const st = friendStatus(req.user.id, friendId);
  if (st === 'friend') return res.status(409).json({ error: '你们已经是好友' });
  if (st === 'pending') return res.status(409).json({ error: '已发送过申请，等待对方处理' });
  if (st === 'incoming') return res.status(409).json({ error: '对方已向你发出申请，请直接处理' });

  const info = db
    .prepare("INSERT INTO friendships (user_id, friend_id, status, message, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?)")
    .run(req.user.id, friendId, message, nowIso(), nowIso());
  res.status(201).json({ id: Number(info.lastInsertRowid), status: 'pending' });
});

// GET /api/friends/requests —— 收到的待处理申请
router.get('/friends/requests', (req, res) => {
  const rows = db
    .prepare(
      `SELECT f.id, f.user_id, f.friend_id, f.message, f.created_at, u.nickname, u.avatar, u.college
       FROM friendships f JOIN users u ON u.id = f.user_id
       WHERE f.friend_id = ? AND f.status = 'pending' ORDER BY f.id DESC`
    )
    .all(req.user.id);
  res.json(
    rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      nickname: r.nickname,
      avatar: r.avatar,
      college: r.college,
      message: r.message,
      createdAt: r.created_at,
    }))
  );
});

// POST /api/friends/requests/:id/accept —— 接受
router.post('/friends/requests/:id/accept', (req, res) => {
  const id = Number(req.params.id);
  const f = db.prepare("SELECT * FROM friendships WHERE id = ? AND friend_id = ? AND status = 'pending'").get(id, req.user.id);
  if (!f) return res.status(404).json({ error: '申请不存在或已处理' });
  db.prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?").run(nowIso(), id);
  res.json({ ok: true });
});

// POST /api/friends/requests/:id/reject —— 拒绝（删除申请，可重新申请）
router.post('/friends/requests/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  const f = db.prepare("SELECT * FROM friendships WHERE id = ? AND friend_id = ? AND status = 'pending'").get(id, req.user.id);
  if (!f) return res.status(404).json({ error: '申请不存在或已处理' });
  db.prepare('DELETE FROM friendships WHERE id = ?').run(id);
  res.json({ ok: true });
});

// GET /api/friends —— 好友列表（含在线状态）
router.get('/friends', (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.nickname, u.avatar, u.college
       FROM friendships f
       JOIN users u ON u.id = (CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END)
       WHERE f.status = 'accepted' AND (f.user_id = ? OR f.friend_id = ?)
       ORDER BY u.nickname ASC`
    )
    .all(req.user.id, req.user.id, req.user.id);
  res.json(rows.map((r) => ({ ...mapUser(r), online: isOnlineGlobal(r.id) })));
});

// DELETE /api/friends/:id —— 删除好友
router.delete('/friends/:id', (req, res) => {
  const friendId = Number(req.params.id);
  if (!Number.isInteger(friendId)) return res.status(400).json({ error: '无效的好友 ID' });
  const del = db
    .prepare("DELETE FROM friendships WHERE status = 'accepted' AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))")
    .run(req.user.id, friendId, friendId, req.user.id);
  if (del.changes === 0) return res.status(404).json({ error: '你们不是好友' });
  res.json({ ok: true });
});

export default router;
