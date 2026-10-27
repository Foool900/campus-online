import { db, nowIso } from './db.js';
import { config } from './config.js';
import { mapInventoryItem } from './inventory.js';

// ============================================================
// 角色外观（character）：底模（肤色/体型/表情）+ 各部位穿戴的装扮。
// 底模是免费档位（存在 user_characters）；穿戴引用 inventory_items 里
// kind='apparel' 的物品。依赖：import inventory.js 的 mapInventoryItem
// （单向 —— inventory.js 不反向 import 本文件）。
// ============================================================

const SLOTS = config.character.slots;
const SKIN_TONES = config.character.skinTones;
const BODIES = config.character.bodies;
const FACES = config.character.faces;

function parseJson(s, fallback = null) {
  if (s == null || s === '') return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function ensureRow(uid) {
  db.prepare('INSERT OR IGNORE INTO user_characters (user_id, updated_at) VALUES (?, ?)').run(uid, nowIso());
}

function rowOf(uid) {
  return db.prepare('SELECT * FROM user_characters WHERE user_id = ?').get(uid);
}

function itemView(item) {
  return item ? mapInventoryItem(item) : null;
}

// 读取我的角色（懒建默认行）：底模 + 已穿戴（按槽位）+ 可穿戴装扮列表
export function getCharacter(userId) {
  const uid = Number(userId);
  ensureRow(uid);
  const row = rowOf(uid);
  const equippedIds = parseJson(row.equipped_json, {});
  const equipped = {};
  let dirty = false;

  for (const slot of SLOTS) {
    const itemId = equippedIds[slot] != null ? Number(equippedIds[slot]) : null;
    const item = itemId != null
      ? db.prepare('SELECT * FROM inventory_items WHERE id = ? AND owner_id = ?').get(itemId, uid)
      : null;
    if (item && item.status === 'held' && item.kind === 'apparel' && item.slot === slot) {
      equipped[slot] = itemView(item);
    } else {
      if (itemId != null) { delete equippedIds[slot]; dirty = true; }
      equipped[slot] = null;
    }
  }
  if (dirty) {
    db.prepare('UPDATE user_characters SET equipped_json = ?, updated_at = ? WHERE user_id = ?').run(JSON.stringify(equippedIds), nowIso(), uid);
  }

  const apparel = db
    .prepare("SELECT * FROM inventory_items WHERE owner_id = ? AND status = 'held' AND kind = 'apparel' ORDER BY id DESC")
    .all(uid)
    .map(itemView);

  return {
    base: { skinTone: row.skin_tone, body: row.body, face: row.face },
    slots: SLOTS,
    baseOptions: { skinTones: SKIN_TONES, bodies: BODIES, faces: FACES },
    equipped,
    apparel,
  };
}

// 设置底模（肤色/体型/表情，可部分更新）
export function setCharacterBase(userId, payload = {}) {
  const uid = Number(userId);
  ensureRow(uid);
  const row = rowOf(uid);
  const next = {
    skinTone: payload.skinTone != null ? payload.skinTone : row.skin_tone,
    body: payload.body != null ? payload.body : row.body,
    face: payload.face != null ? payload.face : row.face,
  };
  if (!SKIN_TONES.includes(next.skinTone)) return { error: '肤色档位无效', status: 400 };
  if (!BODIES.includes(next.body)) return { error: '体型档位无效', status: 400 };
  if (!FACES.includes(next.face)) return { error: '表情档位无效', status: 400 };
  db.prepare('UPDATE user_characters SET skin_tone = ?, body = ?, face = ?, updated_at = ? WHERE user_id = ?')
    .run(next.skinTone, next.body, next.face, nowIso(), uid);
  return { ok: true, base: next };
}

// 穿戴 / 卸下（inventoryItemId 传 null 表示卸下该槽位）
export function setEquip(userId, slot, inventoryItemId) {
  const uid = Number(userId);
  if (!SLOTS.includes(slot)) return { error: '装扮部位无效', status: 400 };
  ensureRow(uid);
  const row = rowOf(uid);
  const equipped = parseJson(row.equipped_json, {});

  if (inventoryItemId == null) {
    delete equipped[slot];
    db.prepare('UPDATE user_characters SET equipped_json = ?, updated_at = ? WHERE user_id = ?').run(JSON.stringify(equipped), nowIso(), uid);
    return { ok: true };
  }

  const itemId = Number(inventoryItemId);
  if (!Number.isInteger(itemId) || itemId <= 0) return { error: '物品不存在', status: 404 };
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId);
  if (!item) return { error: '物品不存在', status: 404 };
  if (item.owner_id !== uid) return { error: '不是你的物品', status: 403 };
  if (item.status !== 'held') return { error: '物品当前不可穿戴', status: 409 };
  if (item.kind !== 'apparel') return { error: '该物品不是装扮', status: 400 };
  if (item.slot !== slot) return { error: '该装扮与所选部位不匹配', status: 400 };

  equipped[slot] = itemId;
  db.prepare('UPDATE user_characters SET equipped_json = ?, updated_at = ? WHERE user_id = ?').run(JSON.stringify(equipped), nowIso(), uid);
  return { ok: true };
}

// 公开角色（个人主页 / 看别人）：底模 + 已穿戴（不含背包）
export function getPublicCharacter(userId) {
  const uid = Number(userId);
  const user = db.prepare("SELECT id, nickname, avatar FROM users WHERE id = ? AND role != 'system'").get(uid);
  if (!user) return { error: '用户不存在', status: 404 };
  const row = rowOf(uid);
  const equippedIds = parseJson(row ? row.equipped_json : null, {});
  const equipped = {};
  for (const slot of SLOTS) {
    const itemId = equippedIds[slot] != null ? Number(equippedIds[slot]) : null;
    const item = itemId != null
      ? db.prepare('SELECT * FROM inventory_items WHERE id = ? AND owner_id = ?').get(itemId, uid)
      : null;
    equipped[slot] = item && item.status === 'held' ? itemView(item) : null;
  }
  return {
    user: { id: user.id, nickname: user.nickname, avatar: user.avatar },
    base: row ? { skinTone: row.skin_tone, body: row.body, face: row.face } : { skinTone: 'fair', body: 'standard', face: 'neutral' },
    equipped,
  };
}
