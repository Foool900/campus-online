import { db, nowIso } from './db.js';
import { levelOf, showcaseSlots, config } from './config.js';
import { resolveWardrobeItem } from './wardrobe.js';

// ============================================================
// 背包（inventory）：可长期持有的物品实例。
//
// 物品来源 source：market 市场成交 | gacha 卡池 | story 剧情 | seed 新手礼包/演示
// 物品状态 status：held 持有 | listed 寄售中 | sold 已卖出（保留历史）
// 橱窗 showcase_slot：NULL 不在橱窗；0..N 占据第 N 个展览位（随等级解锁）
//
// 约定：
//   - 所有物品入库统一走 grantInventoryItem（卡池/剧情/市场/礼包共用入口）。
//   - 本文件不 import market.js（避免循环依赖）；开市判断直接查 market_sessions。
//   - 寄售产生 market_items 行（stock=1、inventory_item_id 回链），买家成交后由
//     market.js 的 confirmOrder 调 transferInventoryItemOnSale 把物品转给买家。
// ============================================================

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

function parseJson(s, fallback = null) {
  if (s == null || s === '') return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function bizError(code, message, status = 400) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

// 最新一期市场（开市判断只看 status，无需复用 market.js 内部函数）
function currentSession() {
  return db.prepare('SELECT * FROM market_sessions ORDER BY open_at DESC, id DESC LIMIT 1').get();
}

export function mapInventoryItem(row) {
  if (!row) return row;
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    icon: row.icon,
    description: row.description,
    rarity: row.rarity,
    source: row.source,
    sourceRefId: row.source_ref_id,
    status: row.status,
    showcaseSlot: row.showcase_slot,
    listPriceCoin: row.list_price_coin,
    listedSessionId: row.listed_session_id,
    listedAt: row.listed_at,
    soldAt: row.sold_at,
    soldPriceCoin: row.sold_price_coin,
    acquiredAt: row.acquired_at,
    // 虚拟角色装扮字段
    kind: row.kind || 'collectible',
    slot: row.slot,
    wardrobeItemId: row.wardrobe_item_id,
    pixelJson: parseJson(row.pixel_json, null),
    // 广场联查字段（listPublicShowcase 时填充）
    ownerName: row.owner_name,
    ownerAvatar: row.owner_avatar,
    ownerLevel: row.owner_level ?? (row.owner_exp != null ? levelOf(row.owner_exp) : undefined),
  };
}

// 统一入库入口（不包装事务，供已在外层 db.transaction 内的调用方组合）。
// 两类物品：
//   - 收藏品（默认）：直接给定 name/icon/... 存库，kind='collectible'。
//   - 装扮（传 wardrobeCode 或 wardrobeItemId）：从图鉴模板解析出名称/图标/
//     稀有度/部位/像素快照，kind='apparel'。colorway 为可选配色覆盖（换色）。
export function grantInventoryItem(ownerId, {
  name,
  icon = '📦',
  description = '',
  rarity = 'common',
  source = 'seed',
  sourceRefId = null,
  wardrobeCode = null,
  wardrobeItemId = null,
  colorway = null,
  kind = 'collectible',
  slot = null,
  pixelJson = null,
}) {
  const uid = Number(ownerId);
  if (!Number.isInteger(uid) || uid <= 0) return { error: '用户不存在', status: 404 };

  let finalName = name;
  let finalIcon = icon;
  let finalDesc = description;
  let finalRarity = rarity;
  let finalKind = kind;
  let finalSlot = slot;
  let finalPixel = pixelJson;
  let finalWardrobeId = wardrobeItemId != null ? Number(wardrobeItemId) : null;

  if (wardrobeCode != null || wardrobeItemId != null) {
    const resolved = resolveWardrobeItem({ wardrobeItemId: wardrobeItemId, wardrobeCode: wardrobeCode }, colorway);
    if (resolved.error) return resolved;
    finalName = resolved.name;
    finalIcon = resolved.icon;
    finalDesc = resolved.description || description;
    finalRarity = resolved.rarity;
    finalKind = 'apparel';
    finalSlot = resolved.slot;
    finalPixel = resolved.pixelJson;
    finalWardrobeId = resolved.id;
  }

  finalName = (finalName || '').toString().trim();
  if (!finalName) return { error: '物品名称不能为空', status: 400 };
  finalRarity = typeof finalRarity === 'string' && RARITIES.includes(finalRarity) ? finalRarity : 'common';
  const pixelStr = finalPixel == null ? null : (typeof finalPixel === 'string' ? finalPixel : JSON.stringify(finalPixel));

  const info = db
    .prepare(
      'INSERT INTO inventory_items (owner_id, name, icon, description, rarity, source, source_ref_id, status, acquired_at, kind, slot, wardrobe_item_id, pixel_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(uid, finalName, finalIcon, (finalDesc || '').toString().trim(), finalRarity, source, sourceRefId, 'held', nowIso(), finalKind, finalSlot, finalWardrobeId, pixelStr);
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(Number(info.lastInsertRowid));
  return { ok: true, item: mapInventoryItem(item) };
}

// 新手礼包：注册即得（幂等，source_ref_id = 用户 id；只发一次）
const STARTER_ITEMS = [
  { name: '开学纪念徽章', icon: '🎖️', rarity: 'rare', description: '新生入学纪念，见证你踏入校园的第一天。' },
  { name: '明伦星图', icon: '🗺️', rarity: 'epic', description: '明伦校区的手绘星图，据说藏着隐藏区域。' },
  { name: '校园卡', icon: '🪪', rarity: 'common', description: '一张普通但不可或缺的校园卡。' },
];

export function grantStarterPack(userId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return { error: '用户不存在', status: 404 };
  const existing = db
    .prepare("SELECT COUNT(*) AS c FROM inventory_items WHERE owner_id = ? AND source = 'seed' AND source_ref_id = ?")
    .get(uid, uid).c;
  if (existing > 0) return { ok: true, duplicate: true };
  db.transaction(() => {
    for (const it of STARTER_ITEMS) {
      grantInventoryItem(uid, { ...it, source: 'seed', sourceRefId: uid });
    }
    // 新手装扮：一件基础校服（kind=apparel，可在形象页穿戴）
    grantInventoryItem(uid, { wardrobeCode: 'outfit_school', source: 'seed', sourceRefId: uid });
  })();
  return { ok: true };
}

// 我的背包 + 我的橱窗 + 展览位上限（服务端唯一来源）
export function listMyInventory(userId) {
  const uid = Number(userId);
  const u = db.prepare('SELECT exp FROM users WHERE id = ?').get(uid);
  if (!u) return { error: '用户不存在', status: 404 };
  const level = levelOf(u.exp);
  const items = db
    .prepare("SELECT * FROM inventory_items WHERE owner_id = ? AND status != 'sold' ORDER BY id DESC")
    .all(uid)
    .map(mapInventoryItem);
  const showcase = db
    .prepare('SELECT * FROM inventory_items WHERE owner_id = ? AND showcase_slot IS NOT NULL ORDER BY showcase_slot ASC')
    .all(uid)
    .map(mapInventoryItem);
  const soldCount = db.prepare("SELECT COUNT(*) AS c FROM inventory_items WHERE owner_id = ? AND status = 'sold'").get(uid).c;
  return { level, maxShowcaseSlots: showcaseSlots(level), showcaseConfig: config.showcase, items, showcase, soldCount };
}

// 放入橱窗（占用位若已有物品则先清空再落位；同物品换位自动腾出原位）
export function setShowcaseItem(userId, itemId, slot) {
  const uid = Number(userId);
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(Number(itemId));
  if (!item) return { error: '物品不存在', status: 404 };
  if (item.owner_id !== uid) return { error: '不是你的物品', status: 403 };
  if (item.status !== 'held') return { error: '物品当前不可展示', status: 409 };

  const exp = db.prepare('SELECT exp FROM users WHERE id = ?').get(uid)?.exp ?? 0;
  const max = showcaseSlots(levelOf(exp));
  const slotNum = Number(slot);
  if (!Number.isInteger(slotNum) || slotNum < 0 || slotNum >= max) {
    return { error: `展览位无效（当前最多 ${max} 位）`, status: 400 };
  }

  try {
    db.transaction(() => {
      db.prepare('UPDATE inventory_items SET showcase_slot = NULL WHERE owner_id = ? AND showcase_slot = ?').run(uid, slotNum);
      db.prepare('UPDATE inventory_items SET showcase_slot = ? WHERE id = ? AND owner_id = ?').run(slotNum, itemId, uid);
    })();
    return { ok: true };
  } catch {
    return { error: '展示失败', status: 500 };
  }
}

// 移出橱窗
export function removeShowcaseItem(userId, itemId) {
  const uid = Number(userId);
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(Number(itemId));
  if (!item) return { error: '物品不存在', status: 404 };
  if (item.owner_id !== uid) return { error: '不是你的物品', status: 403 };
  db.prepare('UPDATE inventory_items SET showcase_slot = NULL WHERE id = ? AND owner_id = ?').run(Number(itemId), uid);
  return { ok: true };
}

// 开市时寄售：把背包物品挂到当前期次成为市场商品（无需摊位/店铺）
export function sellInventoryItem(userId, itemId, priceCoin) {
  const uid = Number(userId);
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(Number(itemId));
  if (!item) return { error: '物品不存在', status: 404 };
  if (item.owner_id !== uid) return { error: '不是你的物品', status: 403 };
  if (item.status !== 'held') return { error: '物品当前不可出售', status: 409 };

  // 正在穿戴的装扮禁止出售（避免卖出后角色装备引用悬挂）
  const equippedRow = db.prepare('SELECT equipped_json FROM user_characters WHERE user_id = ?').get(uid);
  if (equippedRow) {
    const eq = parseJson(equippedRow.equipped_json, {});
    if (Object.values(eq).some((id) => Number(id) === Number(itemId))) {
      return { error: '该装扮正在穿戴，请先在形象页卸下', status: 409 };
    }
  }

  const session = currentSession();
  if (!session || session.status !== 'open') return { error: '市场未开市，无法出售', code: 'MARKET_CLOSED', status: 409 };

  const price = Number(priceCoin);
  if (!Number.isInteger(price) || price <= 0) return { error: '价格必须为正整数金币', status: 400 };

  try {
    const r = db.transaction(() => {
      const dup = db.prepare('SELECT id FROM market_items WHERE inventory_item_id = ? AND session_id = ?').get(itemId, session.id);
      if (dup) return { duplicate: true, listingId: dup.id };

      // 上架前先从橱窗撤下
      db.prepare('UPDATE inventory_items SET showcase_slot = NULL WHERE id = ?').run(itemId);

      const key = `inv_sell:${itemId}:${session.id}`;
      const info = db
        .prepare(
          "INSERT INTO market_items (session_id, seller_id, type, title, description, price_coin, stock, status, icon, rarity, inventory_item_id, idempotency_key, created_at) VALUES (?, ?, 'normal', ?, ?, ?, 1, 'active', ?, ?, ?, ?, ?)"
        )
        .run(session.id, uid, item.name, item.description, price, item.icon, item.rarity, itemId, key, nowIso());

      db.prepare("UPDATE inventory_items SET status='listed', list_price_coin=?, listed_session_id=?, listed_at=? WHERE id=?").run(price, session.id, nowIso(), itemId);
      return { duplicate: false, listingId: Number(info.lastInsertRowid) };
    })();
    return { ok: true, duplicate: r.duplicate, listingId: r.listingId };
  } catch (e) {
    if (e && e.code) return { error: e.message, code: e.code, status: e.status };
    throw e;
  }
}

// 下架寄售（未成交时）：删除市场商品行（无订单引用），物品回 held
export function unlistInventoryItem(userId, itemId) {
  const uid = Number(userId);
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(Number(itemId));
  if (!item) return { error: '物品不存在', status: 404 };
  if (item.owner_id !== uid) return { error: '不是你的物品', status: 403 };
  if (item.status !== 'listed') return { error: '物品未在寄售中', status: 409 };

  try {
    db.transaction(() => {
      const listing = db.prepare('SELECT * FROM market_items WHERE inventory_item_id = ? AND session_id = ?').get(itemId, item.listed_session_id);
      if (listing) {
        if (!['active', 'draft'].includes(listing.status)) {
          throw bizError('ITEM_BAD_STATE', '商品已有买家，无法下架', 409);
        }
        db.prepare("DELETE FROM market_items WHERE id = ? AND status IN ('active','draft')").run(listing.id);
      }
      db.prepare("UPDATE inventory_items SET status='held', list_price_coin=NULL, listed_session_id=NULL, listed_at=NULL WHERE id=?").run(itemId);
    })();
    return { ok: true };
  } catch (e) {
    if (e && e.code) return { error: e.message, code: e.code, status: e.status };
    throw e;
  }
}

// 期次结算：把该期次挂牌未成交的背包物品退回 held（在 settleSession 事务内调用，无事务包装）
export function expireListedInventory(sessionId) {
  db.prepare("UPDATE inventory_items SET status='held', list_price_coin=NULL, listed_session_id=NULL, listed_at=NULL WHERE status='listed' AND listed_session_id=?").run(sessionId);
}

// 寄售成交：把物品所有权转给买家（在 confirmOrder 事务内调用，无事务包装）
export function transferInventoryItemOnSale(inventoryItemId, buyerId, orderId, priceCoin) {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(Number(inventoryItemId));
  if (!item) return { ok: false, error: '物品不存在' };
  db
    .prepare(
      "UPDATE inventory_items SET owner_id=?, status='held', showcase_slot=NULL, list_price_coin=NULL, listed_session_id=NULL, listed_at=NULL, sold_at=?, sold_price_coin=?, source='market', source_ref_id=?, acquired_at=? WHERE id=?"
    )
    .run(Number(buyerId), nowIso(), priceCoin, Number(orderId), nowIso(), Number(inventoryItemId));
  return { ok: true };
}

// 橱窗广场：全服所有正在展览的物品（含主人信息，前端按用户分组）
export function listPublicShowcase() {
  const rows = db
    .prepare(
      `SELECT i.*, u.nickname AS owner_name, u.avatar AS owner_avatar, u.exp AS owner_exp
       FROM inventory_items i
       JOIN users u ON u.id = i.owner_id
       WHERE i.showcase_slot IS NOT NULL AND u.role != 'system'
       ORDER BY u.id ASC, i.showcase_slot ASC`
    )
    .all();
  return rows.map(mapInventoryItem);
}

// 某用户的公开橱窗
export function listUserShowcase(userId) {
  const uid = Number(userId);
  const user = db.prepare("SELECT id, nickname, avatar, exp FROM users WHERE id = ? AND role != 'system'").get(uid);
  if (!user) return { error: '用户不存在', status: 404 };
  const items = db
    .prepare('SELECT * FROM inventory_items WHERE owner_id = ? AND showcase_slot IS NOT NULL ORDER BY showcase_slot ASC')
    .all(uid)
    .map(mapInventoryItem);
  return {
    user: { id: user.id, nickname: user.nickname, avatar: user.avatar, level: levelOf(user.exp) },
    items,
  };
}
