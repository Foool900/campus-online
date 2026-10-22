import { db, nowIso } from './db.js';

// ============================================================
// 经验账户（唯一写入入口）
//
// 账户三字段（都在 users 表）：
//   exp           累计经验 totalExp，只增不减，决定等级
//   available_exp 可用经验，可被托管、可支配
//   frozen_exp    冻结经验，托管中
//
// 流转类型 type：
//   freeze   发布公开任务：available → frozen（发布者）
//   transfer 验收通过：     frozen(发布者) → available + total(接取者)
//   refund   取消/过期/终止：frozen → available（发布者）
//   grant    直接发放（旧待办完成等）：available + total（接收者）
//
// 约束：
//   - 所有加减经验必须走本文件的方法，禁止在别处直接 UPDATE users 的经验字段。
//   - 每个流转带幂等键 idempotencyKey，重复调用不会重复划转（exp_transactions 唯一约束兜底）。
//   - 托管（freeze/refund）不改变 totalExp（exp）。
// ============================================================

const VALID_TYPES = ['freeze', 'transfer', 'refund', 'grant'];

function accountOf(userId) {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return db
    .prepare('SELECT id, exp AS totalExp, available_exp AS availableExp, frozen_exp AS frozenExp FROM users WHERE id = ?')
    .get(userId);
}

function txByIdempotency(key) {
  return db.prepare('SELECT * FROM exp_transactions WHERE idempotency_key = ?').get(key);
}

// 底层：校验 + 余额变更 + 写流水。不做事务包装，供内部/组合调用。
// 成功返回 { ok:true, duplicate:false, txId, ... }；已存在返回 { ok:true, duplicate:true, tx }；
// 校验失败返回 { error, code, status }（不做任何写入）。
function writeExp({ fromUserId = null, toUserId = null, amount, taskId = null, type, idempotencyKey }) {
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return { error: '缺少幂等键', code: 'EX_MISSING_IDEMPOTENCY', status: 400 };
  }
  const existing = txByIdempotency(idempotencyKey);
  if (existing) return { ok: true, duplicate: true, tx: existing };

  if (!VALID_TYPES.includes(type)) {
    return { error: '无效的经验流转类型', code: 'EX_INVALID_TYPE', status: 400 };
  }
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) {
    return { error: '经验值必须为正整数', code: 'EX_INVALID_AMOUNT', status: 400 };
  }

  const from = fromUserId != null ? accountOf(fromUserId) : null;
  const to = toUserId != null ? accountOf(toUserId) : null;

  if (type === 'freeze') {
    if (!from) return { error: '发布者不存在', code: 'EX_USER_NOT_FOUND', status: 404 };
    if (from.availableExp < amt) return { error: '可用经验不足', code: 'EX_INSUFFICIENT_AVAILABLE', status: 400 };
    db.prepare('UPDATE users SET available_exp = available_exp - ?, frozen_exp = frozen_exp + ? WHERE id = ?').run(amt, amt, fromUserId);
  } else if (type === 'refund') {
    if (!from) return { error: '发布者不存在', code: 'EX_USER_NOT_FOUND', status: 404 };
    if (from.frozenExp < amt) return { error: '冻结经验不足', code: 'EX_INSUFFICIENT_FROZEN', status: 400 };
    db.prepare('UPDATE users SET frozen_exp = frozen_exp - ?, available_exp = available_exp + ? WHERE id = ?').run(amt, amt, fromUserId);
  } else if (type === 'transfer') {
    if (!from) return { error: '发布者不存在', code: 'EX_USER_NOT_FOUND', status: 404 };
    if (!to) return { error: '接取者不存在', code: 'EX_USER_NOT_FOUND', status: 404 };
    if (from.frozenExp < amt) return { error: '冻结经验不足', code: 'EX_INSUFFICIENT_FROZEN', status: 400 };
    db.prepare('UPDATE users SET frozen_exp = frozen_exp - ? WHERE id = ?').run(amt, fromUserId);
    db.prepare('UPDATE users SET exp = exp + ?, available_exp = available_exp + ? WHERE id = ?').run(amt, amt, toUserId);
  } else if (type === 'grant') {
    if (!to) return { error: '接收者不存在', code: 'EX_USER_NOT_FOUND', status: 404 };
    db.prepare('UPDATE users SET exp = exp + ?, available_exp = available_exp + ? WHERE id = ?').run(amt, amt, toUserId);
  }

  const info = db
    .prepare(
      'INSERT INTO exp_transactions (from_user_id, to_user_id, amount, task_id, type, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(fromUserId, toUserId, amt, taskId, type, idempotencyKey, nowIso());

  const freshFrom = from ? accountOf(fromUserId) : null;
  const freshTo = to ? accountOf(toUserId) : null;
  return {
    ok: true,
    duplicate: false,
    txId: Number(info.lastInsertRowid),
    amount: amt,
    type,
    from: freshFrom,
    to: freshTo,
  };
}

// 对外：事务版（默认入口）。重复幂等键返回 { ok:true, duplicate:true }。
export function applyExpTransaction(opts) {
  return db.transaction(() => writeExp(opts))();
}

// 对外：无事务版，供已在 db.transaction 内的调用方组合（如 todos 完成）。
// 校验失败返回 { error, code, status }（不写任何东西）；调用方据此决定是否继续。
export function applyExpRaw(opts) {
  return writeExp(opts);
}

// —— 语义化便捷封装（step 3 任务流程使用）——
export const freezeExp = (fromUserId, amount, { taskId = null, idempotencyKey }) =>
  applyExpTransaction({ fromUserId, amount, taskId, type: 'freeze', idempotencyKey });

export const transferExp = (fromUserId, toUserId, amount, { taskId = null, idempotencyKey }) =>
  applyExpTransaction({ fromUserId, toUserId, amount, taskId, type: 'transfer', idempotencyKey });

export const refundExp = (fromUserId, amount, { taskId = null, idempotencyKey }) =>
  applyExpTransaction({ fromUserId, amount, taskId, type: 'refund', idempotencyKey });

export const grantExp = (toUserId, amount, { taskId = null, idempotencyKey }) =>
  applyExpTransaction({ toUserId, amount, taskId, type: 'grant', idempotencyKey });
