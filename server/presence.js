import { db } from './db.js';

// 在线成员（内存集合，不落库）：postId -> Map<userId, 连接数>
// 同一用户开多个标签页算一次（按连接数去重）。
export const onlineByPost = new Map();

export function bumpPresence(postId, userId, delta) {
  if (!Number.isInteger(postId) || !Number.isInteger(userId)) return;
  let m = onlineByPost.get(postId);
  if (!m) {
    m = new Map();
    onlineByPost.set(postId, m);
  }
  const next = (m.get(userId) || 0) + delta;
  if (next <= 0) m.delete(userId);
  else m.set(userId, next);
}

// 某活动当前在线成员（含昵称/头像/是否管理员）
export function presenceList(postId) {
  const m = onlineByPost.get(postId);
  if (!m || m.size === 0) return [];
  const ids = [...m.keys()];
  const ph = ids.map(() => '?').join(',');
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
  const rows = db.prepare(`SELECT id, nickname, avatar FROM users WHERE id IN (${ph})`).all(...ids);
  return rows.map((r) => ({
    userId: r.id,
    userName: r.nickname,
    avatar: r.avatar,
    isAdmin: !!post && post.user_id === r.id,
  }));
}

// 某活动当前在线人数（用于活动卡片）
export function onlineCount(postId) {
  const m = onlineByPost.get(postId);
  return m ? m.size : 0;
}
