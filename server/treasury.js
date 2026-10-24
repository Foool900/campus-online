import { db, nowIso } from './db.js';

// 本文件现只保留 SYSTEM 账户接口，旧 treasury 账面函数
// （ensureTreasury / treasuryBalance / addTreasury / spendTreasury）已于 a829e68 后迁移删除。
// 奖池 = SYSTEM 账户的 coin。

// SYSTEM 用户：treasury 的真实金币账户（nickname='SYS', role='system'）。
// 幂等创建；role='system' 使其无法通过 requireRole('student','admin') 鉴权。
export function ensureSystemAccount() {
  const existing = db.prepare("SELECT id FROM users WHERE nickname = 'SYS'").get();
  if (existing) return Number(existing.id);
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES ('SYS', '', '🏦', 0, 0, 0, 'system', ?)")
    .run(nowIso());
  return Number(info.lastInsertRowid);
}

export function systemAccountId() {
  return ensureSystemAccount();
}
