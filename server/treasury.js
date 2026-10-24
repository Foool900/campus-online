import { db, nowIso } from './db.js';

// @deprecated（Step 5 删除）旧账面奖池。市场/抽奖已迁移到 SYSTEM 真实账户，
// 以下 ensureTreasury / treasuryBalance / addTreasury / spendTreasury 仅保留兼容，无调用方。
// 这里不做事务包装，供调用方在 db.transaction 内组合。

export function ensureTreasury() {
  db.prepare('INSERT OR IGNORE INTO treasury (id, balance_coin) VALUES (1, 0)').run();
}

export function treasuryBalance() {
  ensureTreasury();
  return db.prepare('SELECT balance_coin FROM treasury WHERE id = 1').get().balance_coin;
}

export function addTreasury(amount) {
  ensureTreasury();
  db.prepare('UPDATE treasury SET balance_coin = balance_coin + ? WHERE id = 1').run(amount);
}

export function spendTreasury(amount) {
  ensureTreasury();
  db.prepare('UPDATE treasury SET balance_coin = balance_coin - ? WHERE id = 1').run(amount);
}

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
