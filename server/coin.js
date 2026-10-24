import { db, nowIso } from './db.js';

// ============================================================
// 金币（COIN）：可消费、可托管、可转移的货币。唯一写入入口。
//
// 账户字段（users 表）：coin（余额）/ frozen_coin（托管中）。
// 流转类型 type：
//   mint     造币：系统发放（签到/剧情/赏金/成就/管理员）→ to.coin
//   freeze   托管：coin → frozen_coin（发布赏金）
//   transfer 转移：frozen_coin(发布者) → coin(接取者)
//   refund   退回：frozen_coin → coin
//   sink     回收：coin 销毁（手续费/租金/发布费）
//
// 约束：
//   - 所有金币增减必须走本文件，禁止在别处直接 UPDATE users 的金币字段。
//   - 每个流转带幂等键 idempotencyKey，重复调用不会重复划转（coin_transactions 唯一约束兜底）。
// ============================================================

const VALID_TYPES = ['mint', 'freeze', 'transfer', 'refund', 'sink'];

function accountOf(userId) {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return db
    .prepare('SELECT id, coin, frozen_coin AS frozenCoin FROM users WHERE id = ?')
    .get(userId);
}

function txByIdempotency(key) {
  return db.prepare('SELECT * FROM coin_transactions WHERE idempotency_key = ?').get(key);
}

// 底层：校验 + 余额变更 + 写流水。不做事务包装。
function writeCoin({
  fromUserId = null,
  toUserId = null,
  amount,
  type,
  relatedType = null,
  relatedId = null,
  note = null,
  idempotencyKey,
}) {
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return { error: '缺少幂等键', code: 'COIN_MISSING_IDEMPOTENCY', status: 400 };
  }
  const existing = txByIdempotency(idempotencyKey);
  if (existing) return { ok: true, duplicate: true, tx: existing };

  if (!VALID_TYPES.includes(type)) {
    return { error: '无效的金币流转类型', code: 'COIN_INVALID_TYPE', status: 400 };
  }
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) {
    return { error: '金币必须为正整数', code: 'COIN_INVALID_AMOUNT', status: 400 };
  }

  const from = fromUserId != null ? accountOf(fromUserId) : null;
  const to = toUserId != null ? accountOf(toUserId) : null;

  if (type === 'mint') {
    if (!to) return { error: '接收者不存在', code: 'COIN_USER_NOT_FOUND', status: 404 };
    db.prepare('UPDATE users SET coin = coin + ? WHERE id = ?').run(amt, toUserId);
  } else if (type === 'sink') {
    if (!from) return { error: '用户不存在', code: 'COIN_USER_NOT_FOUND', status: 404 };
    if (from.coin < amt) return { error: '金币不足', code: 'COIN_INSUFFICIENT', status: 400 };
    db.prepare('UPDATE users SET coin = coin - ? WHERE id = ?').run(amt, fromUserId);
  } else if (type === 'freeze') {
    if (!from) return { error: '发布者不存在', code: 'COIN_USER_NOT_FOUND', status: 404 };
    if (from.coin < amt) return { error: '金币不足', code: 'COIN_INSUFFICIENT', status: 400 };
    db.prepare('UPDATE users SET coin = coin - ?, frozen_coin = frozen_coin + ? WHERE id = ?').run(amt, amt, fromUserId);
  } else if (type === 'refund') {
    if (!from) return { error: '发布者不存在', code: 'COIN_USER_NOT_FOUND', status: 404 };
    if (from.frozenCoin < amt) return { error: '冻结金币不足', code: 'COIN_INSUFFICIENT_FROZEN', status: 400 };
    db.prepare('UPDATE users SET frozen_coin = frozen_coin - ?, coin = coin + ? WHERE id = ?').run(amt, amt, fromUserId);
  } else if (type === 'transfer') {
    if (!from) return { error: '发布者不存在', code: 'COIN_USER_NOT_FOUND', status: 404 };
    if (!to) return { error: '接取者不存在', code: 'COIN_USER_NOT_FOUND', status: 404 };
    if (from.frozenCoin < amt) return { error: '冻结金币不足', code: 'COIN_INSUFFICIENT_FROZEN', status: 400 };
    db.prepare('UPDATE users SET frozen_coin = frozen_coin - ? WHERE id = ?').run(amt, fromUserId);
    db.prepare('UPDATE users SET coin = coin + ? WHERE id = ?').run(amt, toUserId);
  }

  const info = db
    .prepare(
      'INSERT INTO coin_transactions (from_user_id, to_user_id, amount, type, related_type, related_id, note, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(fromUserId, toUserId, amt, type, relatedType, relatedId, note, idempotencyKey, nowIso());

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
export function applyCoinTransaction(opts) {
  return db.transaction(() => writeCoin(opts))();
}

// 对外：无事务版，供已在 db.transaction 内的调用方组合（如任务验收）。
export function applyCoinRaw(opts) {
  return writeCoin(opts);
}

// —— 语义化便捷封装 ——
export const mintCoin = (toUserId, amount, opts = {}) =>
  applyCoinTransaction({ toUserId, amount, type: 'mint', ...opts });

export const sinkCoin = (fromUserId, amount, opts = {}) =>
  applyCoinTransaction({ fromUserId, amount, type: 'sink', ...opts });

export const freezeCoin = (fromUserId, amount, opts = {}) =>
  applyCoinTransaction({ fromUserId, amount, type: 'freeze', ...opts });

export const refundCoin = (fromUserId, amount, opts = {}) =>
  applyCoinTransaction({ fromUserId, amount, type: 'refund', ...opts });

export const transferCoin = (fromUserId, toUserId, amount, opts = {}) =>
  applyCoinTransaction({ fromUserId, toUserId, amount, type: 'transfer', ...opts });
