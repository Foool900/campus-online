// 每日校园问答：每人每天一题，答对发经验 + 金币（幂等，重复作答不重复发）。

import { db, nowIso } from './db.js';
import { applyExpRaw } from './exp.js';
import { applyCoinRaw } from './coin.js';

export const QUIZ_EXP = 10;
export const QUIZ_COIN = 5;

export const QUIZZES = [
  { q: '河南大学的校训是什么？', options: ['自强不息，厚德载物', '明德新民，止于至善', '博学笃行，求实创新'], answer: 1, explain: '校训「明德新民，止于至善」取自《大学》。' },
  { q: '河南大学一共有几个校区？', options: ['2 个', '4 个', '3 个'], answer: 2, explain: '明伦、金明、郑州三个校区。' },
  { q: '河南大学的「双一流」建设学科是？', options: ['历史学', '生物学', '计算机科学'], answer: 1, explain: '生物学是双一流建设学科。' },
  { q: '河南大学创建于哪一年？', options: ['1984 年', '1949 年', '1912 年'], answer: 2, explain: '1912 年创办，前身是河南留学欧美预备学校。' },
  { q: '本平台的等级公式是？', options: ['经验 / 100 向下取整再加 1', '经验 / 50', '经验 × 100'], answer: 0, explain: 'level = floor(exp / 100) + 1。' },
  { q: '发布公开任务时，赏金会怎样？', options: ['立即转给接取者', '冻结托管', '直接销毁'], answer: 1, explain: '赏金冻结托管，验收通过后才转给接取者。' },
  { q: '校园夜市流动地摊的摆摊时长是？', options: ['4 小时', '30 分钟', '1 小时'], answer: 1, explain: '流动地摊摆摊 30 分钟。' },
  { q: '经验（exp）这个账户的特点是？', options: ['可花、可托管', '只增不减，决定等级', '和金币一样'], answer: 1, explain: '经验只发不扣，决定等级；金币才是可花的货币。' },
  { q: '本平台的 AI 知识库助手叫什么？', options: ['小荷', 'SYS', 'Ala'], answer: 2, explain: '它叫 Ala，一只软萌的校园小助手。' },
  { q: '河南大学的校庆日是每年哪一天？', options: ['10 月 1 日', '9 月 25 日', '6 月 1 日'], answer: 1, explain: '校庆日为每年 9 月 25 日。' },
];

export function todayQuiz() {
  const days = Math.floor(Date.now() / 86400000);
  return QUIZZES[days % QUIZZES.length];
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function quizStatus(userId) {
  const today = fmtDate(new Date());
  const q = todayQuiz();
  const ans = db.prepare('SELECT * FROM ala_quiz_answers WHERE user_id = ? AND date = ?').get(userId, today);
  return {
    question: q.q,
    options: q.options,
    answered: !!ans,
    correct: ans ? !!ans.correct : null,
    explain: ans ? q.explain : null,
    reward: { exp: QUIZ_EXP, coin: QUIZ_COIN },
  };
}

export function answerQuiz(userId, answerIndex) {
  const today = fmtDate(new Date());
  const q = todayQuiz();
  const existing = db.prepare('SELECT * FROM ala_quiz_answers WHERE user_id = ? AND date = ?').get(userId, today);
  if (existing) return { already: true, correct: !!existing.correct, explain: q.explain };

  const idx = Number(answerIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) {
    return { error: '无效的选项', status: 400 };
  }
  const correct = idx === q.answer;

  const reward = db.transaction(() => {
    db.prepare('INSERT INTO ala_quiz_answers (user_id, date, correct, answered_at) VALUES (?, ?, ?, ?)').run(userId, today, correct ? 1 : 0, nowIso());
    if (!correct) return { exp: 0, coin: 0 };
    const e = applyExpRaw({ toUserId: userId, amount: QUIZ_EXP, source: 'behavior', idempotencyKey: `quiz-exp:${userId}:${today}` });
    if (e.error) throw Object.assign(new Error(e.error), { status: e.status, code: e.code });
    const c = applyCoinRaw({ toUserId: userId, amount: QUIZ_COIN, type: 'mint', relatedType: 'quiz', note: '每日校园问答', idempotencyKey: `quiz-coin:${userId}:${today}` });
    if (c.error) throw Object.assign(new Error(c.error), { status: c.status, code: c.code });
    return { exp: QUIZ_EXP, coin: QUIZ_COIN };
  })();

  return { correct, explain: q.explain, reward };
}
