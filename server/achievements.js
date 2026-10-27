import { db, nowIso } from './db.js';

// 进度型成就可用的指标名（metricValue 与 admin 校验共用）
export const ACHIEVEMENT_METRICS = [
  'user_created',
  'messages_sent',
  'posts_created',
  'todos_completed',
  'exp_total',
  'areas_visited',
  'page_opens',
  'inventory_items',
  'stories_completed',
  'story_checkins',
];

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

// 非隐藏频道总数（areas_visited 的动态目标）
function totalChannels() {
  return db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM channels ch
       JOIN areas a ON a.id = ch.area_id
       WHERE a.hidden = 0`
    )
    .get().c;
}

// 计算某指标当前值
export function metricValue(userId, metric) {
  switch (metric) {
    case 'user_created':
      return 1;
    case 'messages_sent':
      return db.prepare('SELECT COUNT(*) AS c FROM messages WHERE user_id = ?').get(userId).c;
    case 'posts_created':
      return db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?').get(userId).c;
    case 'todos_completed':
      return db
        .prepare("SELECT COUNT(*) AS c FROM tasks WHERE publisher_id = ? AND type = 'private' AND status = 'done'")
        .get(userId).c;
    case 'exp_total':
      return db.prepare('SELECT exp FROM users WHERE id = ?').get(userId)?.exp ?? 0;
    case 'areas_visited':
      return db
        .prepare(
          `SELECT COUNT(DISTINCT m.channel_id) AS c
           FROM messages m
           JOIN channels ch ON ch.id = m.channel_id
           JOIN areas a ON a.id = ch.area_id
           WHERE m.user_id = ? AND a.hidden = 0`
        )
        .get(userId).c;
    case 'inventory_items':
      return db.prepare("SELECT COUNT(*) AS c FROM inventory_items WHERE owner_id = ? AND status != 'sold'").get(userId).c;
    case 'stories_completed':
      return db.prepare("SELECT COUNT(*) AS c FROM player_stories WHERE user_id = ? AND status = 'completed'").get(userId).c;
    case 'story_checkins':
      return db.prepare('SELECT COUNT(*) AS c FROM player_story_checkins WHERE user_id = ?').get(userId).c;
    default:
      return 0;
  }
}

// 某界面累计打开次数（page_opens 指标专用）
export function pageOpenCount(userId, page) {
  if (!page) return 0;
  return db
    .prepare('SELECT count FROM page_opens WHERE user_id = ? AND page = ?')
    .get(userId, page)?.count ?? 0;
}

// 列出全部成就（进度型 + 触发型）的统一视图，kind 区分类型
export function listAllAchievements(userId) {
  const uid = Number(userId);
  const total = totalChannels();
  const all = db.prepare('SELECT * FROM achievements ORDER BY kind ASC, id ASC').all();
  const unlockedRows = db
    .prepare('SELECT achievement_code, unlocked_at FROM user_achievements WHERE user_id = ?')
    .all(uid);
  const unlockedMap = new Map(unlockedRows.map((r) => [r.achievement_code, r.unlocked_at]));

  return all.map((a) => {
    if (a.kind === 'trigger') {
      const unlocked = unlockedMap.has(a.code);
      return {
        code: a.code,
        // 未解锁隐藏真实名称，只返回线索（hint）；已解锁返回真实名称与描述
        name: unlocked ? a.name : '???',
        // 明确条件：若配置为「不可见」，未解锁时隐藏描述（仅保留 hint 线索）
        description: !unlocked && a.condition_visible === 0 ? '' : a.description,
        hint: a.hint || '',
        icon: a.icon,
        type: a.type,
        kind: 'trigger',
        unlocked,
        unlockedAt: unlockedMap.get(a.code) || null,
      };
    }

    const target = a.metric === 'areas_visited' ? total : a.threshold;
    const raw = a.metric === 'page_opens' ? pageOpenCount(uid, a.page) : metricValue(uid, a.metric);
    const current = Math.min(raw, target);
    const unlocked = current >= target;
    return {
      code: a.code,
      name: a.name,
      description: !unlocked && a.condition_visible === 0 ? '' : a.description,
      icon: a.icon,
      type: a.type,
      kind: 'progress',
      metric: a.metric,
      target,
      current,
      unlocked,
      progressPct: target > 0 ? Math.round((current / target) * 100) : 100,
    };
  });
}

// 触发成就并（若新解锁）通过 socket 通知该用户，返回本次新解锁的成就（无则 null）
export function notifyAchievement(userId, code, io) {
  const ach = triggerAchievement(userId, code);
  if (ach && io) {
    io.to(`user:${userId}`).emit('achievement:unlocked', {
      code: ach.code,
      name: ach.name,
      icon: ach.icon,
      description: ach.description,
    });
  }
  return ach;
}

// 检测并通知「进度型成就」的新解锁：跨过阈值时写入 user_achievements（作为已通知标记）并 emit toast。
// 应在任何可能改变进度指标的事件后调用（发消息 / 打开界面 / 完成备忘 / 验收任务 / 发帖 等）。
export function notifyNewProgressAchievements(userId, io) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return [];

  const recorded = new Set(
    db.prepare('SELECT achievement_code FROM user_achievements WHERE user_id = ?').all(uid).map((r) => r.achievement_code)
  );

  const fresh = [];
  for (const a of listAllAchievements(uid)) {
    if (a.kind !== 'progress' || !a.unlocked || recorded.has(a.code)) continue;
    db.prepare('INSERT INTO user_achievements (user_id, achievement_code, unlocked_at) VALUES (?, ?, ?)').run(uid, a.code, nowIso());
    fresh.push(a);
    if (io) {
      io.to(`user:${uid}`).emit('achievement:unlocked', {
        code: a.code,
        name: a.name,
        icon: a.icon,
        description: a.description,
      });
    }
  }
  return fresh;
}
