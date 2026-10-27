import { randomInt, randomUUID } from 'node:crypto';
import { db, nowIso } from './db.js';
import { applyCoinRaw } from './coin.js';
import { grantInventoryItem } from './inventory.js';

// ============================================================
// 装扮奖池（卡池「装扮祈愿」）：结构对齐 story_pools，抽取「装扮模板」→ 落背包。
// 金币通过 applyCoinRaw(type='sink') 销毁；物品通过 grantInventoryItem(source='gacha')。
// 排除已拥有（背包里已持有的模板），集齐后不可再抽。
// ============================================================

function bizErr(code, message, status = 400) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

function runTx(fn) {
  try {
    return { value: db.transaction(fn)() };
  } catch (e) {
    if (e && e.code) return { error: e.message, code: e.code, status: e.status || 400 };
    throw e;
  }
}

function toIsoOrThrow(v, label) {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw bizErr('WARDROBE_POOL_INVALID', `${label} 时间格式无效`, 400);
  return d.toISOString();
}

function ownedWardrobeIds(userId) {
  return new Set(
    db
      .prepare("SELECT DISTINCT wardrobe_item_id FROM inventory_items WHERE owner_id = ? AND wardrobe_item_id IS NOT NULL AND status != 'sold'")
      .all(Number(userId))
      .map((r) => r.wardrobe_item_id)
  );
}

function mapPool(p, owned) {
  const entries = db
    .prepare(
      'SELECT e.*, w.name, w.icon, w.rarity, w.slot FROM wardrobe_pool_entries e JOIN wardrobe_items w ON w.id = e.wardrobe_item_id WHERE e.pool_id = ? ORDER BY e.id ASC'
    )
    .all(p.id);
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    icon: p.icon,
    drawCostCoin: p.draw_cost_coin,
    startAt: p.start_at,
    endAt: p.end_at,
    status: p.status,
    entryCount: entries.length,
    ownedCount: entries.filter((e) => owned.has(e.wardrobe_item_id)).length,
    entries: entries.map((e) => ({
      wardrobeItemId: e.wardrobe_item_id,
      name: e.name,
      icon: e.icon,
      rarity: e.rarity,
      slot: e.slot,
      weight: e.weight,
      owned: owned.has(e.wardrobe_item_id),
    })),
  };
}

export function listWardrobePools(userId) {
  const uid = Number(userId);
  const pools = db.prepare("SELECT * FROM wardrobe_pools WHERE status = 'active' ORDER BY id ASC").all();
  const owned = ownedWardrobeIds(uid);
  return pools.map((p) => mapPool(p, owned));
}

// 策划批量导入奖池（仅 admin；按 code upsert，条目整池替换，装扮用 code 解析）
export function importWardrobePools(adminUserId, payload) {
  const list = Array.isArray(payload) ? payload : payload ? [payload] : [];
  if (!list.length) return { error: '导入内容不能为空', code: 'WARDROBE_POOL_EMPTY', status: 400 };

  const created = [];
  const updated = [];
  const r = runTx(() => {
    for (const item of list) {
      const code = (item.code || '').toString().trim();
      const name = (item.name || '').toString().trim();
      if (!code) throw bizErr('WARDROBE_POOL_INVALID', '奖池 code 不能为空', 400);
      if (!name) throw bizErr('WARDROBE_POOL_INVALID', '奖池名称不能为空', 400);
      const entries = Array.isArray(item.entries) ? item.entries : [];
      const startAt = toIsoOrThrow(item.startAt, 'startAt');
      const endAt = toIsoOrThrow(item.endAt, 'endAt');
      const cost = Number.isInteger(Number(item.drawCostCoin)) && Number(item.drawCostCoin) >= 0 ? Number(item.drawCostCoin) : 50;
      const status = ['active', 'closed'].includes(item.status) ? item.status : 'active';
      const now = nowIso();

      const existing = db.prepare('SELECT id FROM wardrobe_pools WHERE code = ?').get(code);
      let poolId;
      if (existing) {
        poolId = existing.id;
        db.prepare('UPDATE wardrobe_pools SET name=?, icon=?, draw_cost_coin=?, start_at=?, end_at=?, status=? WHERE id=?')
          .run(name, item.icon || '🧥', cost, startAt, endAt, status, poolId);
        updated.push(code);
      } else {
        const info = db
          .prepare('INSERT INTO wardrobe_pools (code, name, icon, draw_cost_coin, start_at, end_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(code, name, item.icon || '🧥', cost, startAt, endAt, status, now);
        poolId = Number(info.lastInsertRowid);
        created.push(code);
      }

      db.prepare('DELETE FROM wardrobe_pool_entries WHERE pool_id = ?').run(poolId);
      const ins = db.prepare('INSERT INTO wardrobe_pool_entries (pool_id, wardrobe_item_id, weight) VALUES (?, ?, ?)');
      for (const en of entries) {
        const wCode = (en.wardrobeCode || en.code || '').toString().trim();
        if (!wCode) continue;
        const w = db.prepare('SELECT id FROM wardrobe_items WHERE code = ?').get(wCode);
        if (!w) throw bizErr('WARDROBE_POOL_INVALID', `奖池「${code}」引用了不存在的装扮「${wCode}」`, 400);
        ins.run(poolId, w.id, Number.isInteger(Number(en.weight)) && Number(en.weight) > 0 ? Number(en.weight) : 1);
      }
    }
  });
  if (r.error) return r;
  return { ok: true, created, updated };
}

// 抽一次：扣费 + 加权抽取（排除已拥有）+ 发放装扮到背包
export function drawWardrobe(userId, poolId) {
  const uid = Number(userId);
  const pid = Number(poolId);
  const pool = db.prepare('SELECT * FROM wardrobe_pools WHERE id = ?').get(pid);
  if (!pool) return { error: '奖池不存在', code: 'WARDROBE_POOL_NOT_FOUND', status: 404 };
  if (pool.status !== 'active') return { error: '奖池未开放', code: 'WARDROBE_POOL_CLOSED', status: 409 };
  const now = nowIso();
  if (pool.start_at && now < pool.start_at) return { error: '奖池未开放', code: 'WARDROBE_POOL_CLOSED', status: 409 };
  if (pool.end_at && now > pool.end_at) return { error: '奖池已结束', code: 'WARDROBE_POOL_CLOSED', status: 409 };

  const entries = db.prepare('SELECT * FROM wardrobe_pool_entries WHERE pool_id = ?').all(pid);
  const owned = ownedWardrobeIds(uid);
  const poolEntries = entries.filter((e) => !owned.has(e.wardrobe_item_id));
  if (poolEntries.length === 0) return { error: '奖池内装扮均已拥有', code: 'WARDROBE_POOL_EMPTY', status: 409 };

  const totalWeight = poolEntries.reduce((s, e) => s + Math.max(1, e.weight), 0);
  let roll = randomInt(0, totalWeight);
  let picked = null;
  for (const e of poolEntries) {
    const w = Math.max(1, e.weight);
    if (roll < w) { picked = e; break; }
    roll -= w;
  }
  if (!picked) picked = poolEntries[poolEntries.length - 1];

  const result = runTx(() => {
    const cost = pool.draw_cost_coin || 0;
    if (cost > 0) {
      const c = applyCoinRaw({
        fromUserId: uid,
        amount: cost,
        type: 'sink',
        relatedType: 'wardrobe_gacha',
        relatedId: pid,
        idempotencyKey: `wardrobe:gacha:${pid}:${uid}:${randomUUID()}`,
      });
      if (c.error) throw bizErr(c.code, c.error, c.status);
    }
    const drawInfo = db
      .prepare('INSERT INTO wardrobe_gacha_draws (user_id, pool_id, wardrobe_item_id, cost_coin, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(uid, pid, picked.wardrobe_item_id, cost, nowIso());
    const drawId = Number(drawInfo.lastInsertRowid);
    const granted = grantInventoryItem(uid, { wardrobeItemId: picked.wardrobe_item_id, source: 'gacha', sourceRefId: drawId });
    if (granted.error) throw bizErr(granted.code || 'WARDROBE_GRANT_FAILED', granted.error, granted.status || 500);
    db.prepare('UPDATE wardrobe_gacha_draws SET inventory_item_id = ? WHERE id = ?').run(granted.item.id, drawId);
    return { wardrobeItemId: picked.wardrobe_item_id, cost, drawId, item: granted.item };
  });
  if (result.error) return result;
  return { ok: true, ...result.value };
}

// ============================================================
// 演示奖池（确保存在；正式内容走 POST /api/wardrobe/pools/import）
// ============================================================
const DEMO_POOL = {
  code: 'default-wardrobe',
  name: '常驻装扮祈愿',
  icon: '🧥',
  drawCostCoin: 50,
  entries: [
    { wardrobeCode: 'hair_short', weight: 20 },
    { wardrobeCode: 'hat_beanie', weight: 20 },
    { wardrobeCode: 'outfit_school', weight: 15 },
    { wardrobeCode: 'shoes_sneakers', weight: 25 },
    { wardrobeCode: 'accessory_glasses', weight: 20 },
  ],
};

// 幂等：确保演示装扮奖池存在（按 code 判重）
export function ensureWardrobePools() {
  if (db.prepare("SELECT id FROM wardrobe_pools WHERE code = 'default-wardrobe'").get()) return;
  const now = nowIso();
  const info = db
    .prepare('INSERT INTO wardrobe_pools (code, name, icon, draw_cost_coin, start_at, end_at, status, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)')
    .run(DEMO_POOL.code, DEMO_POOL.name, DEMO_POOL.icon, DEMO_POOL.drawCostCoin, 'active', now);
  const poolId = Number(info.lastInsertRowid);
  const ins = db.prepare('INSERT INTO wardrobe_pool_entries (pool_id, wardrobe_item_id, weight) VALUES (?, ?, ?)');
  for (const en of DEMO_POOL.entries) {
    const w = db.prepare('SELECT id FROM wardrobe_items WHERE code = ?').get(en.wardrobeCode);
    if (w) ins.run(poolId, w.id, en.weight);
  }
}
