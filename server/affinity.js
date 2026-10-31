// Ala 亲密度（养成）：与知识库助手聊天累积亲密度，分 5 级。
// 每天最多 +30（防刷），每 100 点升一级，封顶「挚友」。

import { db, nowIso } from './db.js';

export const ALA_LEVELS = ['陌生', '认识', '朋友', '好友', '挚友'];
const ALA_DAILY_CAP = 30;
const ALA_LEVEL_STEP = 100;
const ALA_DECAY_PER_DAY = 3; // 每天不联系衰减 3 点

export function alaLevelOf(affinity) {
  return Math.min(Math.floor(affinity / ALA_LEVEL_STEP), ALA_LEVELS.length - 1);
}

export function getAffinity(userId) {
  const row = db.prepare('SELECT affinity FROM ala_affinities WHERE user_id = ?').get(userId);
  const affinity = row ? row.affinity : 0;
  const level = alaLevelOf(affinity);
  return {
    affinity,
    level,
    label: ALA_LEVELS[level],
    nextLevelAt: level >= ALA_LEVELS.length - 1 ? null : (level + 1) * ALA_LEVEL_STEP,
  };
}

// 每次真实问答 +1 亲密度（每日封顶）；几天不联系则时间衰减（可降）。返回最新状态、是否升级、衰减了多少。
export function touchAffinity(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT affinity, daily_count, last_day FROM ala_affinities WHERE user_id = ?').get(userId);
  const prevLevel = alaLevelOf(row ? row.affinity : 0);
  let affinity = row ? row.affinity : 0;
  let dailyCount = row && row.last_day === today ? row.daily_count : 0;

  // 时间衰减：几天没联系，关系会疏远（好感度可减）
  let decayed = 0;
  if (row && row.last_day && row.last_day !== today) {
    const missed = Math.max(0, Math.round((new Date(today + 'T00:00:00Z') - new Date(row.last_day + 'T00:00:00Z')) / 86400000) - 1);
    decayed = Math.min(affinity, missed * ALA_DECAY_PER_DAY);
    affinity = Math.max(0, affinity - decayed);
  }

  if (dailyCount < ALA_DAILY_CAP) {
    affinity += 1;
    dailyCount += 1;
  }
  db.prepare(
    `INSERT INTO ala_affinities (user_id, affinity, daily_count, last_day, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET affinity = excluded.affinity, daily_count = excluded.daily_count, last_day = excluded.last_day, updated_at = excluded.updated_at`
  ).run(userId, affinity, dailyCount, today, nowIso());
  const level = alaLevelOf(affinity);
  return {
    affinity,
    level,
    label: ALA_LEVELS[level],
    nextLevelAt: level >= ALA_LEVELS.length - 1 ? null : (level + 1) * ALA_LEVEL_STEP,
    leveledUp: level > prevLevel,
    decayed,
  };
}
