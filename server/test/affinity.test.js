import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { db, initDb, nowIso } = await import('../db.js');
const { alaLevelOf, getAffinity, touchAffinity } = await import('../affinity.js');

initDb();

let seq = 0;
function makeUser() {
  seq += 1;
  return Number(db.prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '', '🎓', 0, 0, 0, 'member', ?)").run(`测试用户${seq}`, nowIso()).lastInsertRowid);
}

test('alaLevelOf 等级计算', () => {
  assert.equal(alaLevelOf(0), 0);
  assert.equal(alaLevelOf(99), 0);
  assert.equal(alaLevelOf(100), 1);
  assert.equal(alaLevelOf(400), 4);
  assert.equal(alaLevelOf(9999), 4); // 封顶挚友
});

test('touchAffinity 累积亲密度，每日封顶 30', () => {
  const uid = makeUser();
  assert.equal(getAffinity(uid).affinity, 0);

  const s1 = touchAffinity(uid);
  assert.equal(s1.affinity, 1);
  assert.equal(s1.leveledUp, false);

  for (let i = 0; i < 40; i++) touchAffinity(uid);
  assert.equal(getAffinity(uid).affinity, 30); // 封顶
});

test('touchAffinity 升级提示', () => {
  const uid = makeUser();
  db.prepare("INSERT INTO ala_affinities (user_id, affinity, daily_count, last_day, updated_at) VALUES (?, 99, 0, '', ?)").run(uid, nowIso());
  const s = touchAffinity(uid);
  assert.equal(s.affinity, 100);
  assert.equal(s.level, 1);
  assert.equal(s.label, '认识');
  assert.equal(s.leveledUp, true);
});

test('touchAffinity 时间衰减：几天没联系好感度下降', () => {
  const uid = makeUser();
  const past = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  db.prepare('INSERT INTO ala_affinities (user_id, affinity, daily_count, last_day, updated_at) VALUES (?, 100, 0, ?, ?)').run(uid, past, nowIso());
  const s = touchAffinity(uid);
  // 错过 9 天 → 衰减 27，然后今天 +1
  assert.equal(s.decayed, 27);
  assert.equal(s.affinity, 74);
});

test('touchAffinity 昨天联系过不衰减', () => {
  const uid = makeUser();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  db.prepare('INSERT INTO ala_affinities (user_id, affinity, daily_count, last_day, updated_at) VALUES (?, 50, 0, ?, ?)').run(uid, yesterday, nowIso());
  const s = touchAffinity(uid);
  assert.equal(s.decayed, 0);
  assert.equal(s.affinity, 51);
});
