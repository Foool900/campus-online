import { db, nowIso } from './db.js';

// 触发式成就引擎：幂等解锁（同用户同成就只插入一次），返回本次是否新解锁
export function triggerAchievement(userId, code) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return null;
  const ach = db.prepare('SELECT * FROM achievements WHERE code = ?').get(code);
  if (!ach) return null;

  const exists = db
    .prepare('SELECT 1 FROM user_achievements WHERE user_id = ? AND achievement_code = ?')
    .get(uid, code);
  if (exists) return null; // 已解锁，幂等返回

  db.prepare(
    'INSERT INTO user_achievements (user_id, achievement_code, unlocked_at) VALUES (?, ?, ?)'
  ).run(uid, code, nowIso());
  return ach;
}

// 列出全部成就（含解锁状态与时间），type 供前端分组
export function listUserAchievements(userId) {
  const all = db.prepare('SELECT * FROM achievements WHERE metric = ? ORDER BY id ASC').all('trigger');
  const unlockedRows = db
    .prepare('SELECT achievement_code, unlocked_at FROM user_achievements WHERE user_id = ?')
    .all(userId);
  const map = new Map(unlockedRows.map((r) => [r.achievement_code, r.unlocked_at]));

  return all.map((a) => {
    const unlocked = map.has(a.code);
    return {
      code: a.code,
      // 未解锁隐藏真实名称，只返回线索（hint）；已解锁返回真实名称与描述
      name: unlocked ? a.name : '???',
      description: a.description,
      hint: a.hint || '',
      icon: a.icon,
      type: a.type,
      unlocked,
      unlockedAt: map.get(a.code) || null,
    };
  });
}
