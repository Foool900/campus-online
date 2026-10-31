import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { db, initDb, nowIso } = await import('../db.js');
const { todayQuiz, answerQuiz } = await import('../quiz.js');

initDb();

let seq = 0;
function makeUser() {
  seq += 1;
  return Number(db.prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '', '🎓', 0, 0, 0, 'member', ?)").run(`测试用户${seq}`, nowIso()).lastInsertRowid);
}

test('todayQuiz 每天一题且答案合法', () => {
  const q = todayQuiz();
  assert.ok(q.q);
  assert.ok(q.options.length >= 2);
  assert.ok(Number.isInteger(q.answer));
  assert.ok(q.answer >= 0 && q.answer < q.options.length);
});

test('answerQuiz 答对发经验金币，重复作答幂等', () => {
  const uid = makeUser();
  const q = todayQuiz();
  const r1 = answerQuiz(uid, q.answer);
  assert.equal(r1.correct, true);
  assert.equal(r1.reward.exp, 10);
  assert.equal(r1.reward.coin, 5);
  let u = db.prepare('SELECT exp, coin FROM users WHERE id = ?').get(uid);
  assert.equal(u.exp, 10);
  assert.equal(u.coin, 5);

  const r2 = answerQuiz(uid, q.answer);
  assert.equal(r2.already, true);
  u = db.prepare('SELECT exp, coin FROM users WHERE id = ?').get(uid);
  assert.equal(u.exp, 10); // 不重复发
  assert.equal(u.coin, 5);
});

test('answerQuiz 答错不发奖励', () => {
  const uid = makeUser();
  const q = todayQuiz();
  const wrong = (q.answer + 1) % q.options.length;
  const r = answerQuiz(uid, wrong);
  assert.equal(r.correct, false);
  assert.equal(r.reward.exp, 0);
  const u = db.prepare('SELECT exp, coin FROM users WHERE id = ?').get(uid);
  assert.equal(u.exp, 0);
  assert.equal(u.coin, 0);
});
