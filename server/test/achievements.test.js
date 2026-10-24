import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { ensureAchievements } = await import('../seed.js');
const { listAllAchievements, triggerAchievement, metricValue, ACHIEVEMENT_METRICS, notifyNewProgressAchievements } = await import('../achievements.js');

initDb();
ensureAchievements();

let seq = 0;
function makeUser(exp = 0) {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, role, created_at) VALUES (?, '计算机', '🎓', ?, 'student', ?)")
    .run(`用户${seq}`, exp, nowIso());
  return Number(info.lastInsertRowid);
}

test('ensureAchievements 同时播种进度型与触发型，且不覆盖已有改动', () => {
  const counts = db.prepare('SELECT kind, COUNT(*) AS c FROM achievements GROUP BY kind').all();
  const byKind = Object.fromEntries(counts.map((r) => [r.kind, r.c]));
  assert.ok(byKind.progress >= 10, '进度型成就已播种');
  assert.ok(byKind.trigger >= 15, '触发型成就已播种');

  // 管理员改动后再次 ensureAchievements 不应覆盖（insert-only 语义）
  db.prepare("UPDATE achievements SET name = '管理员改过的名字' WHERE code = 'EXP_001'").run();
  ensureAchievements();
  const row = db.prepare("SELECT name FROM achievements WHERE code = 'EXP_001'").get();
  assert.equal(row.name, '管理员改过的名字');
});

test('listAllAchievements 返回统一视图：进度型含进度，触发型隐藏未解锁名称', () => {
  const uid = makeUser(150);
  const list = listAllAchievements(uid);
  const progress = list.filter((a) => a.kind === 'progress');
  const trigger = list.filter((a) => a.kind === 'trigger');

  assert.ok(progress.length >= 10);
  assert.ok(trigger.length >= 15);

  // 进度型：user_created 恒为 1，立即解锁
  const created = progress.find((a) => a.code === 'hero-arrives');
  assert.equal(created.metric, 'user_created');
  assert.equal(created.current, 1);
  assert.equal(created.unlocked, true);

  // 进度型：经验达到阈值（current 展示时封顶到 target）
  const exp100 = progress.find((a) => a.code === 'exp-100');
  assert.equal(exp100.current, 100);
  assert.equal(exp100.target, 100);
  assert.equal(exp100.unlocked, true);
  assert.equal(exp100.progressPct, 100);

  // 触发型：未解锁时隐藏名称，只给线索
  const t = trigger.find((a) => a.code === 'EXP_002');
  assert.equal(t.unlocked, false);
  assert.equal(t.name, '???');
  assert.ok(t.hint);
});

test('triggerAchievement 幂等：同用户同成就只解锁一次', () => {
  const uid = makeUser(0);
  const first = triggerAchievement(uid, 'EXP_002');
  assert.ok(first);
  assert.equal(triggerAchievement(uid, 'EXP_002'), null);

  const row = db
    .prepare('SELECT COUNT(*) AS c FROM user_achievements WHERE user_id = ? AND achievement_code = ?')
    .get(uid, 'EXP_002');
  assert.equal(row.c, 1);

  // 解锁后 listAllAchievements 显示真实名称
  const t = listAllAchievements(uid).find((a) => a.code === 'EXP_002');
  assert.equal(t.unlocked, true);
  assert.equal(t.name, first.name);
});

test('metricValue 覆盖常用指标', () => {
  const uid = makeUser(0);
  assert.equal(metricValue(uid, 'user_created'), 1);
  assert.equal(metricValue(uid, 'messages_sent'), 0);
  assert.ok(ACHIEVEMENT_METRICS.includes('areas_visited'));
});

test('condition_visible=0 时，未解锁成就的描述被隐藏，解锁后恢复', () => {
  const uid = makeUser(0);
  db.prepare("UPDATE achievements SET condition_visible = 0 WHERE code = 'EXP_003'").run();

  const locked = listAllAchievements(uid).find((a) => a.code === 'EXP_003');
  assert.equal(locked.unlocked, false);
  assert.equal(locked.description, '');

  triggerAchievement(uid, 'EXP_003');
  const unlocked = listAllAchievements(uid).find((a) => a.code === 'EXP_003');
  assert.equal(unlocked.unlocked, true);
  assert.equal(unlocked.description, '连续点击特定节点5次');
});

test('管理员新增的进度型成就：指标达标后自动解锁（无需代码埋点）', () => {
  const uid = makeUser(150);
  db.prepare(
    "INSERT INTO achievements (code, name, description, icon, metric, threshold, kind) VALUES ('ADMIN_EXP', '管理员经验成就', '经验达到100', '⭐', 'exp_total', 100, 'progress')"
  ).run();

  const a = listAllAchievements(uid).find((x) => x.code === 'ADMIN_EXP');
  assert.ok(a);
  assert.equal(a.kind, 'progress');
  assert.equal(a.unlocked, true);
  assert.equal(a.progressPct, 100);
});

test('管理员新增的触发型成就：需代码埋点 triggerAchievement 才会解锁', () => {
  const uid = makeUser(0);
  db.prepare(
    "INSERT INTO achievements (code, name, description, icon, metric, threshold, kind, hint) VALUES ('ADMIN_TRIG', '管理员触发成就', '自定义触发条件', '🎯', 'trigger', 1, 'trigger', '自定义线索')"
  ).run();

  // 未触发前：不解锁，隐藏名称
  let a = listAllAchievements(uid).find((x) => x.code === 'ADMIN_TRIG');
  assert.equal(a.unlocked, false);
  assert.equal(a.name, '???');

  // 相当于在某处代码埋点调用 triggerAchievement 后：解锁
  assert.ok(triggerAchievement(uid, 'ADMIN_TRIG'));
  a = listAllAchievements(uid).find((x) => x.code === 'ADMIN_TRIG');
  assert.equal(a.unlocked, true);
  assert.equal(a.name, '管理员触发成就');
});

test('page_opens 进度型成就：打开界面次数达标后自动解锁', () => {
  const uid = makeUser(0);
  db.prepare(
    "INSERT INTO achievements (code, name, description, icon, metric, threshold, kind, page) VALUES ('OPEN_MARKET_5', '老顾客', '打开市场页5次', '🛒', 'page_opens', 5, 'progress', '/market')"
  ).run();

  // 初始 0 次：未解锁
  let a = listAllAchievements(uid).find((x) => x.code === 'OPEN_MARKET_5');
  assert.equal(a.unlocked, false);
  assert.equal(a.current, 0);

  // 记录 5 次打开 /market
  const inc = db.prepare(
    'INSERT INTO page_opens (user_id, page, count) VALUES (?, ?, 1) ON CONFLICT(user_id, page) DO UPDATE SET count = count + 1'
  );
  for (let i = 0; i < 5; i++) inc.run(uid, '/market');

  a = listAllAchievements(uid).find((x) => x.code === 'OPEN_MARKET_5');
  assert.equal(a.unlocked, true);
  assert.equal(a.current, 5);
  assert.equal(a.target, 5);
});

test('notifyNewProgressAchievements: 进度型成就跨阈值时通知一次（幂等）', () => {
  const uid = makeUser(150); // exp=150
  db.prepare(
    "INSERT INTO achievements (code, name, description, icon, metric, threshold, kind) VALUES ('PROG_EXP_100', '进度经验', '经验100', '⭐', 'exp_total', 100, 'progress')"
  ).run();

  // 第一次：应通知（含新插入的进度型成就）
  const first = notifyNewProgressAchievements(uid, null);
  assert.ok(first.some((a) => a.code === 'PROG_EXP_100'));

  // 第二次：已记录，不再重复通知
  const second = notifyNewProgressAchievements(uid, null);
  assert.equal(second.length, 0);
});
