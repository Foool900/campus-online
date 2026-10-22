import { db } from './db.js';

// 在线成员（内存集合，不落库）：'activity:{id}' / 'chat:{id}' -> Map<userId, 连接数>
// 同一用户开多个标签页算一次（按连接数去重）。
const onlineByRoom = new Map();

export function bumpPresence(type, id, userId, delta) {
  if ((type !== 'activity' && type !== 'chat') || !Number.isInteger(id) || !Number.isInteger(userId)) return;
  const key = `${type}:${id}`;
  let m = onlineByRoom.get(key);
  if (!m) {
    m = new Map();
    onlineByRoom.set(key, m);
  }
  const next = (m.get(userId) || 0) + delta;
  if (next <= 0) m.delete(userId);
  else m.set(userId, next);
}

// 某会话当前在线成员（含昵称/头像/是否管理员）
export function presenceList(type, id) {
  const m = onlineByRoom.get(`${type}:${id}`);
  if (!m || m.size === 0) return [];
  const ids = [...m.keys()];
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, nickname, avatar FROM users WHERE id IN (${ph})`).all(...ids);

  let adminId = null;
  if (type === 'activity') {
    adminId = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(id)?.user_id ?? null;
  }
  return rows.map((r) => ({
    userId: r.id,
    userName: r.nickname,
    avatar: r.avatar,
    isAdmin: r.id === adminId,
  }));
}

// 某会话当前在线人数（用于活动卡片 / 频道）
export function onlineCount(type, id) {
  const m = onlineByRoom.get(`${type}:${id}`);
  return m ? m.size : 0;
}
