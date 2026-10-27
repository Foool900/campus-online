import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const { grantInventoryItem, sellInventoryItem } = await import('../inventory.js');
const { resolveWardrobeItem, listWardrobe, ensureWardrobe } = await import('../wardrobe.js');
const { getCharacter, setCharacterBase, setEquip, getPublicCharacter } = await import('../character.js');

initDb();
ensureWardrobe();

let seq = 0;
function makeUser(coin = 0, exp = 0) {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', ?, ?, 0, 'student', ?)")
    .run(`用户${seq}`, exp, coin, nowIso());
  return Number(info.lastInsertRowid);
}
function itemRow(id) { return db.prepare('SELECT * FROM inventory_items WHERE id=?').get(id); }
function grantOutfit(u) { return grantInventoryItem(u, { wardrobeCode: 'outfit_school', source: 'seed', sourceRefId: u }); }
function grantHat(u) { return grantInventoryItem(u, { wardrobeCode: 'hat_beanie', source: 'seed', sourceRefId: u }); }

test('wardrobe：ensureWardrobe 幂等种子 5 个模板', () => {
  ensureWardrobe();
  assert.equal(listWardrobe().length, 5);
});

test('resolveWardrobeItem：模板 + 配色解析成最终网格', () => {
  const r = resolveWardrobeItem({ wardrobeCode: 'hat_beanie' });
  assert.equal(r.slot, 'hat');
  assert.equal(r.pixelJson.w, 16);
  assert.equal(r.pixelJson.rows.length, 32);
  assert.equal(r.pixelJson.palette.P, '#e74c3c');

  const r2 = resolveWardrobeItem({ wardrobeCode: 'hat_beanie' }, { P: '#0000ff' });
  assert.equal(r2.pixelJson.palette.P, '#0000ff');

  assert.equal(resolveWardrobeItem({ wardrobeCode: '不存在' }).status, 404);
});

test('grantInventoryItem(wardrobeCode)：入库存为 apparel，含像素快照', () => {
  const u = makeUser();
  const r = grantInventoryItem(u, { wardrobeCode: 'outfit_school', source: 'story', sourceRefId: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.item.kind, 'apparel');
  assert.equal(r.item.slot, 'outfit');
  assert.ok(r.item.wardrobeItemId > 0);
  assert.ok(r.item.pixelJson && Array.isArray(r.item.pixelJson.rows));
  assert.equal(r.item.source, 'story');
  assert.equal(itemRow(r.item.id).kind, 'apparel');
});

test('getCharacter：懒建默认行', () => {
  const u = makeUser();
  const c = getCharacter(u);
  assert.deepEqual(c.base, { skinTone: 'fair', body: 'standard', face: 'neutral' });
  assert.equal(c.slots.length, config.character.slots.length);
  assert.equal(c.apparel.length, 0);
  assert.equal(c.equipped.outfit, null);
});

test('setCharacterBase：合法更新 / 非法档位拒绝', () => {
  const u = makeUser();
  assert.equal(setCharacterBase(u, { skinTone: 'deep', face: 'happy' }).ok, true);
  assert.deepEqual(getCharacter(u).base, { skinTone: 'deep', body: 'standard', face: 'happy' });
  assert.equal(setCharacterBase(u, { skinTone: 'neon' }).status, 400);
});

test('setEquip：穿戴 / 部位不匹配 / 非装扮 / 非本人物品 / 卸下', () => {
  const u = makeUser();
  const other = makeUser();
  const outfit = grantOutfit(u).item;
  const hat = grantHat(u).item;

  assert.equal(setEquip(u, 'outfit', outfit.id).ok, true);
  assert.equal(getCharacter(u).equipped.outfit.id, outfit.id);

  // 部位不匹配：hat 塞进 outfit 槽
  assert.equal(setEquip(u, 'outfit', hat.id).status, 400);

  // 非本人物品
  assert.equal(setEquip(u, 'hat', hat.id).ok, true);
  assert.equal(setEquip(other, 'hat', hat.id).status, 403);

  // 非装扮（收藏品）
  const badge = grantInventoryItem(u, { name: '徽章', source: 'seed' }).item;
  assert.equal(setEquip(u, 'accessory', badge.id).status, 400);

  // 卸下
  assert.equal(setEquip(u, 'outfit', null).ok, true);
  assert.equal(getCharacter(u).equipped.outfit, null);
});

test('setEquip：非 held 物品不可穿戴', () => {
  const u = makeUser();
  const outfit = grantOutfit(u).item;
  db.prepare("UPDATE inventory_items SET status='listed' WHERE id=?").run(outfit.id);
  assert.equal(setEquip(u, 'outfit', outfit.id).status, 409);
});

test('sellInventoryItem：正在穿戴的装扮禁止出售', () => {
  const u = makeUser();
  const outfit = grantOutfit(u).item;
  setEquip(u, 'outfit', outfit.id);
  assert.equal(sellInventoryItem(u, outfit.id, 100).status, 409);
});

test('getPublicCharacter：返回公开角色', () => {
  const u = makeUser();
  const r = getPublicCharacter(u);
  assert.equal(r.user.id, u);
  assert.equal(r.base.skinTone, 'fair');
});
