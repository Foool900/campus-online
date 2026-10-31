// Ala 的世界频道身份：合成账号 + 定时问候

import { db, nowIso } from './db.js';
import { insertConversationMessage, worldChannelId } from './routes/messages.js';

let cachedAlaId = null;

// 确保 Ala 系统账号存在（role=system，不会被误登录）
export function ensureAlaAccount() {
  let row = db.prepare("SELECT id FROM users WHERE role = 'system' AND nickname = 'Ala'").get();
  if (row) {
    cachedAlaId = row.id;
    return row.id;
  }
  try {
    const info = db
      .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES ('Ala', '校园AI', '🤖', 0, 0, 0, 'system', ?)")
      .run(nowIso());
    cachedAlaId = Number(info.lastInsertRowid);
  } catch {
    const fallback = db.prepare("SELECT id FROM users WHERE nickname = 'Ala'").get();
    cachedAlaId = fallback ? fallback.id : null;
  }
  return cachedAlaId;
}

export function alaUserId() {
  if (cachedAlaId) return cachedAlaId;
  return ensureAlaAccount();
}

const GREETINGS = [
  '早安呀，同学们！新的一天也要元气满满哦 ☀️',
  '小知识：河南大学的校训是「明德新民，止于至善」～',
  '冷知识：河南大学创建于 1912 年，前身是河南留学欧美预备学校。',
  '今天的每日校园问答你答了吗？答对送经验金币哦 🎯',
  '晚安啦，早点休息，明天见 🌙',
  '想我了就来世界频道 @我，随叫随到～',
];

// 发一条问候到世界频道，返回插入结果（{ message } 或 { error }）
export function alaGreet() {
  const uid = alaUserId();
  const channelId = worldChannelId();
  const content = GREETINGS[Math.floor(Date.now() / 3600000) % GREETINGS.length];
  return insertConversationMessage('chat', channelId, uid, { content });
}
