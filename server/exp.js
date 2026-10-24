import { db, nowIso } from './db.js';

// ============================================================
// 经验（EXP）：只发不扣，决定等级（level = floor(exp/100)+1）。
//
// 所有经验发放必须走本文件，禁止在别处直接 UPDATE users.exp。
// 每个发放带幂等键 idempotencyKey，重复调用不会重复发放。
// source 标记来源：behavior（行为）| story（剧情）| admin（管理员）...
// ============================================================

function txByIdempotency(key) {
  return db.prepare('SELECT * FROM exp_transactions WHERE idempotency_key = ?').get(key);
}

// 底层：校验 + 累加 + 写流水。不做事务包装，供内部/组合调用。
// 成功返回 { ok:true, duplicate:false, txId, ... }；已存在返回 { ok:true, duplicate:true, tx }；
// 校验失败返回 { error, code, status }（不做任何写入）。
function writeExp({ toUserId, amount, source = null, relatedId = null, idempotencyKey }) {
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return { error: '缺少幂等键', code: 'EX_MISSING_IDEMPOTENCY', status: 400 };
  }
  const existing = txByIdempotency(idempotencyKey);
  if (existing) return { ok: true, duplicate: true, tx: existing };

  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) {
    return { error: '经验值必须为正整数', code: 'EX_INVALID_AMOUNT', status: 400 };
  }

  const uid = Number(toUserId);
  const to = Number.isInteger(uid) && uid > 0
    ? db.prepare('SELECT id, exp FROM users WHERE id = ?').get(uid)
    : null;
  if (!to) return { error: '用户不存在', code: 'EX_USER_NOT_FOUND', status: 404 };

  db.prepare('UPDATE users SET exp = exp + ? WHERE id = ?').run(amt, uid);
  const info = db
    .prepare(
      'INSERT INTO exp_transactions (from_user_id, to_user_id, amount, task_id, type, source, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(null, uid, amt, relatedId, 'grant', source, idempotencyKey, nowIso());

  const fresh = db.prepare('SELECT id, exp FROM users WHERE id = ?').get(uid);
  return {
    ok: true,
    duplicate: false,
    txId: Number(info.lastInsertRowid),
    amount: amt,
    source,
    to: fresh,
  };
}

// 对外：事务版（默认入口）。重复幂等键返回 { ok:true, duplicate:true }。
export function applyExpTransaction(opts) {
  return db.transaction(() => writeExp(opts))();
}

// 对外：无事务版，供已在 db.transaction 内的调用方组合（如任务验收）。
export function applyExpRaw(opts) {
  return writeExp(opts);
}

// 便捷封装：发放经验
export const grantExp = (toUserId, amount, opts = {}) =>
  applyExpTransaction({ toUserId, amount, ...opts });
