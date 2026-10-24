import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const { signinStatus, claimSignin, rewardFor } = await import('../routes/signin.js');

initDb();

function dateStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let seq = 0;
function makeUser() {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', 0, 0, 0, 'member', ?)")
    .run(`签到用户${seq}`, nowIso());
  return Number(info.lastInsertRowid);
}
function coinOf(id) {
  return db.prepare('SELECT coin FROM users WHERE id = ?').get(id).coin;
}

test('rewardFor：基础 + 连击递增，封顶', () => {
  const { base, streakBonus, streakMaxBonus } = config.signin;
  assert.equal(rewardFor(1), base);
  assert.equal(rewardFor(2), base + streakBonus);
  assert.equal(rewardFor(100), base + streakMaxBonus);
});

test('首次签到：streak=1，发基础金币', () => {
  const uid = makeUser();
  const r = claimSignin(uid);
  assert.equal(r.already, false);
  assert.equal(r.streak, 1);
  assert.equal(r.reward, config.signin.base);
  assert.equal(r.coin, config.signin.base);
  assert.equal(coinOf(uid), config.signin.base);
});

test('重复签到：幂等，不重复发金币', () => {
  const uid = makeUser();
  claimSignin(uid);
  const r2 = claimSignin(uid);
  assert.equal(r2.already, true);
  assert.equal(coinOf(uid), config.signin.base);
});

test('连续签到：streak 递增，奖励递增', () => {
  const uid = makeUser();
  db.prepare('INSERT INTO sign_ins (user_id, date, streak, reward_coin, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uid, dateStr(-1), 3, 0, nowIso());
  const r = claimSignin(uid);
  assert.equal(r.streak, 4);
  assert.equal(r.reward, rewardFor(4));
});

test('断签：昨天的记录缺失时重置为 1', () => {
  const uid = makeUser();
  db.prepare('INSERT INTO sign_ins (user_id, date, streak, reward_coin, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uid, dateStr(-2), 5, 0, nowIso());
  const r = claimSignin(uid);
  assert.equal(r.streak, 1);
});

test('signinStatus：未签到时给出即将获得的连击与奖励', () => {
  const uid = makeUser();
  db.prepare('INSERT INTO sign_ins (user_id, date, streak, reward_coin, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uid, dateStr(-1), 2, 0, nowIso());
  const s = signinStatus(uid);
  assert.equal(s.signedToday, false);
  assert.equal(s.streak, 2);
  assert.equal(s.reward, rewardFor(3));
});
