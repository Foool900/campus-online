// 演示数据种子脚本（针对全新的 demo-video.db，非破坏性）
//
// 用法（务必指向演示库，勿指向默认 campus.db）：
//   DB_PATH="E:/program/campus-online/server/data/demo-video.db" node scripts/demo-seed.js
//
// 原则：金币/经验必须走 coin.js / exp.js 落账；密码走 auth.hashPassword；
//       夜市走 createSession → grabStall → confirmStall → createItem → listItem；
//       剧情/角色走 story.js / character.js。好友/会话/消息无币值语义，直接 SQL 播种。
// 幂等：可重复运行（账号/好友/会话按 nickname / 唯一键判重，币值发放走幂等键）。

import { db, nowIso } from '../db.js';
import { hashPassword } from '../auth.js';
import { mintCoin } from '../coin.js';
import { grantExp } from '../exp.js';
import { grantStarterPack } from '../inventory.js';
import { createSession, grabStall, confirmStall, createItem, listItem } from '../routes/market.js';
import { publishTask } from '../routes/tasks.js';
import { setEquip } from '../character.js';
import { claimStory, checkinNode } from '../story.js';

const PASSWORD = 'demo1234';
const ADMIN_PASSWORD = 'admin1234';

const byNick = (n) => db.prepare('SELECT * FROM users WHERE nickname = ? COLLATE NOCASE').get(n);
const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

function ensureUser(nickname, college, avatar, role) {
  const existing = byNick(nickname);
  if (existing) {
    if (!existing.password_hash) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(PASSWORD), existing.id);
    db.prepare('UPDATE users SET role = ?, college = ?, avatar = ? WHERE id = ?').run(role, college, avatar, existing.id);
    return existing;
  }
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, role, password_hash, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)")
    .run(nickname, college, avatar, role, hashPassword(PASSWORD), nowIso());
  const id = Number(info.lastInsertRowid);
  grantStarterPack(id); // 新手礼包（含校园制服装扮 + 收藏品）
  return byNick(nickname);
}

function fund(user, exp, coin) {
  if (exp > 0) grantExp(user.id, exp, { source: 'admin', idempotencyKey: `demo_seed:exp:${user.id}` });
  if (coin > 0) mintCoin(user.id, coin, { relatedType: 'demo_seed', note: '演示初始金币', idempotencyKey: `demo_seed:coin:${user.id}` });
}

const log = [];

// ===== 1. 账号（密码 + 角色）=====
const 小荷 = ensureUser('小荷', '计算机与信息工程学院', '🐸', 'student');   // 主账号（seed 已有）
const admin = byNick('FOolish');
if (admin) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(ADMIN_PASSWORD), admin.id);
const 阿哲 = ensureUser('阿哲', '软件学院', '🎮', 'student');
const 小雨 = ensureUser('小雨', '外国语学院', '🎨', 'student');
const 大熊 = ensureUser('大熊', '体育学院', '🏀', 'student');
const 小美 = ensureUser('小美', '文化艺术学院', '🎭', 'student');
log.push(`账号已就绪：小荷(${小荷.id}) 阿哲(${阿哲.id}) 小雨(${小雨.id}) 大熊(${大熊.id}) 小美(${小美.id}) 管理员FOolish(${admin.id})`);

// ===== 2. 经验（排行榜分层）+ 金币 =====
fund(小荷, 120, 800);  // 30+120=150 → Lv2
fund(阿哲, 420, 800);  // Lv5
fund(小雨, 260, 600);  // Lv3
fund(大熊, 130, 500);  // Lv2
fund(小美, 60, 150);   // Lv1
if (admin) mintCoin(admin.id, 5000, { relatedType: 'demo_seed', note: '演示初始金币', idempotencyKey: 'demo_seed:coin:admin' });

// ===== 3. 世界频道内容（底部世界聊天不空）=====
const wc = db.prepare("SELECT c.id FROM channels c JOIN areas a ON a.id = c.area_id WHERE a.slug = 'world' LIMIT 1").get();
const wcId = Number(wc?.id);
function chatMsg(channelId, userId, content, at) {
  db.prepare('INSERT INTO messages (channel_id, user_id, conversation_type, conversation_id, type, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(channelId, userId, 'chat', channelId, 'text', content, at);
}
if (wcId) {
  chatMsg(wcId, 阿哲.id, '有明伦校区的同学吗？今晚一起跑步 🏃', minsAgo(40));
  chatMsg(wcId, 小雨.id, '求一份高数期末笔记，有偿～', minsAgo(25));
  chatMsg(wcId, 大熊.id, '今天操场风不错，来打球 🏀', minsAgo(12));
  chatMsg(wcId, 小美.id, '大家好呀，刚入学求带 🙋', minsAgo(6));
}

// ===== 4. 夜市：开一期待次 + 摊位 + 商品 =====
let sessionId = null;
const existingSession = db.prepare('SELECT id FROM market_sessions ORDER BY id DESC LIMIT 1').get();
if (existingSession) {
  sessionId = existingSession.id;
} else {
  const r = createSession(minsAgo(5)); // 开市时间 5 分钟前 → 立即处于可开市状态
  if (r.error) throw new Error(`创建夜市期次失败: ${r.error}`);
  sessionId = r.session.id;
  db.prepare("UPDATE market_sessions SET status = 'open' WHERE id = ?").run(sessionId);
}
log.push(`夜市期次 id=${sessionId}（已开市）`);

function listGoods(seller, goods) {
  const g = grabStall(seller.id, sessionId);
  if (g.error) { log.push(`  ${seller.nickname} 抢摊失败: ${g.error}`); return; }
  const c = confirmStall(seller.id, g.stallId);
  if (c.error) { log.push(`  ${seller.nickname} 确认摊位失败: ${c.error}`); return; }
  for (const item of goods) {
    const r = createItem(seller.id, { sessionId, ...item });
    if (r.error) { log.push(`  ${seller.nickname} 建商品「${item.title}」失败: ${r.error}`); continue; }
    const l = listItem(seller.id, r.itemId, { stallId: g.stallId });
    if (l.error) log.push(`  ${seller.nickname} 上架「${item.title}」失败: ${l.error}`);
  }
}
listGoods(阿哲, [
  { title: '二手《线性代数》教材', description: '八成新，重点都划好了', priceCoin: 30, type: 'normal', icon: '📚', rarity: 'common' },
  { title: '神秘盲盒', description: '可能开出校园限定周边', priceCoin: 60, type: 'blindbox', icon: '🎁', rarity: 'rare', contentJson: { text: '里面藏着校园限定周边，可能是徽章、贴纸或小挂件' } },
]);
listGoods(小雨, [
  { title: '手绘明信片套装（6张）', description: '手绘校园风景，自留送人都可', priceCoin: 25, type: 'normal', icon: '🖼️', rarity: 'uncommon' },
  { title: '手工编织挂件', description: '独一无二的小挂件', priceCoin: 18, type: 'normal', icon: '🧶', rarity: 'common' },
]);
listGoods(大熊, [
  { title: '二手篮球', description: '打过几次，气足', priceCoin: 45, type: 'normal', icon: '🏀', rarity: 'common' },
  { title: '羽毛球拍（成对）', description: '成色良好', priceCoin: 35, type: 'normal', icon: '🏸', rarity: 'common' },
]);

// ===== 5. 好友关系 =====
function friend(a, b, status = 'accepted', message = '') {
  const A = byNick(a).id, B = byNick(b).id;
  db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id, status, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(A, B, status, message, nowIso(), nowIso());
}
friend('小荷', '阿哲'); friend('阿哲', '小荷');
friend('小荷', '小雨'); friend('小雨', '小荷');
friend('小荷', '大熊'); friend('大熊', '小荷');
friend('阿哲', '小雨'); friend('小雨', '阿哲');
friend('小美', '小荷', 'pending', '你好呀，我是小美，认识一下～'); // 一条待处理好友申请

// ===== 6. 私聊 + 群聊 =====
function convMsg(convType, convId, userId, content, at) {
  db.prepare('INSERT INTO messages (channel_id, user_id, conversation_type, conversation_id, type, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(wcId, userId, convType, convId, 'text', content, at);
}
// 私聊：小荷 ↔ 阿哲
const dconv = db.prepare("INSERT INTO conversations (type, created_at, last_message_at) VALUES ('direct', ?, ?)").run(nowIso(), minsAgo(5));
const dId = Number(dconv.lastInsertRowid);
db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(dId, 小荷.id, 'member', nowIso());
db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(dId, 阿哲.id, 'member', nowIso());
convMsg('direct', dId, 阿哲.id, '小荷，晚上的自习你去吗？', minsAgo(30));
convMsg('direct', dId, 小荷.id, '去呀，四楼靠窗那排老位置', minsAgo(28));
convMsg('direct', dId, 阿哲.id, '好，帮我占个位 🙏', minsAgo(5));
// 群聊：考研自习组（阿哲 owner，小荷/小雨）
const gconv = db.prepare("INSERT INTO conversations (type, created_at, last_message_at) VALUES ('group', ?, ?)").run(nowIso(), minsAgo(8));
const gId = Number(gconv.lastInsertRowid);
db.prepare('INSERT OR IGNORE INTO groups (conversation_id, name, owner_id, created_at) VALUES (?, ?, ?, ?)').run(gId, '考研自习组', 阿哲.id, nowIso());
for (const [u, role] of [[阿哲, 'owner'], [小荷, 'member'], [小雨, 'member']]) {
  db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(gId, u.id, role, nowIso());
}
convMsg('group', gId, 阿哲.id, '建个群，一起约自习打卡', minsAgo(60));
convMsg('group', gId, 小雨.id, '已加入！周末图书馆吗', minsAgo(20));
convMsg('group', gId, 小荷.id, '我周日下午有空', minsAgo(8));

// ===== 7. 任务（公开赏金 + 私密备忘）=====
const 小荷U = { id: 小荷.id, nickname: 小荷.nickname, role: 'student' };
const 阿哲U = { id: 阿哲.id, nickname: 阿哲.nickname, role: 'student' };
const pub = publishTask(小荷U, { type: 'public', title: '帮我取快递', description: '南门菜鸟驿站取一个快递送到学一公寓楼下，谢谢！', tags: ['跑腿', '快递'], rewardCoin: 30, deadlineAt: new Date(Date.now() + 3 * 86400000).toISOString() });
if (pub.error) log.push(`公开任务失败: ${pub.error}`);
const priv = publishTask(小荷U, { type: 'private', title: '复习高数第三章', description: '重点看定积分与不定积分', tags: ['学习'] });
if (priv.error) log.push(`私密任务失败: ${priv.error}`);
const pub2 = publishTask(阿哲U, { type: 'public', title: '图书馆占座互助', description: '明伦图书馆四楼靠窗，帮忙占个位置', tags: ['互助'], rewardCoin: 20, deadlineAt: new Date(Date.now() + 2 * 86400000).toISOString() });
if (pub2.error) log.push(`阿哲公开任务失败: ${pub2.error}`);

// ===== 8. 角色装扮：给小荷穿上校园制服 =====
const outfit = db.prepare("SELECT id FROM inventory_items WHERE owner_id = ? AND kind = 'apparel' AND slot = 'outfit' LIMIT 1").get(小荷.id);
if (outfit) setEquip(小荷.id, 'outfit', outfit.id);

// ===== 9. 剧情进度：小荷领取「新生周打卡」并完成第一节点 =====
const story = db.prepare("SELECT id FROM stories WHERE code = 'freshman-week'").get();
if (story) {
  const run = claimStory(小荷.id, story.id);
  if (!run.error && !run.duplicate) {
    const node1 = db.prepare('SELECT id FROM story_nodes WHERE story_id = ? AND seq = 1').get(story.id);
    if (node1) checkinNode(小荷.id, story.id, node1.id, { proof: { text: '打卡校园大门牌坊 📸' } });
  }
}

// ===== 10. 签到：预置前两天连击（今天现场签到即为连击 3）=====
function dayStr(offset) {
  const d = new Date(Date.now() - offset * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
db.prepare('INSERT OR IGNORE INTO sign_ins (user_id, date, streak, reward_coin, created_at) VALUES (?, ?, ?, ?, ?)')
  .run(小荷.id, dayStr(2), 1, 5, minsAgo(2 * 1440));
db.prepare('INSERT OR IGNORE INTO sign_ins (user_id, date, streak, reward_coin, created_at) VALUES (?, ?, ?, ?, ?)')
  .run(小荷.id, dayStr(1), 2, 8, minsAgo(1 * 1440));

// ===== 汇总 =====
console.log('\n===== 演示数据播种完成 =====');
for (const line of log) console.log(line);
console.log('\n登录账号（密码）：');
console.log(`  小荷 / ${PASSWORD}   （主账号，student，Lv2，金币 800）`);
console.log(`  FOolish / ${ADMIN_PASSWORD}   （管理员 admin）`);
console.log(`  阿哲 / ${PASSWORD}   （student，Lv5）`);
console.log(`  小雨 / ${PASSWORD}   （student，Lv3）`);
console.log(`  大熊 / ${PASSWORD}   （student，Lv2）`);
console.log(`  小美 / ${PASSWORD}   （student，Lv1，有条待处理好友申请）`);
console.log('\n注意：公开任务有 minCompleteMinutes 最短完成时长，录制时若要现场走「接取→提交→验收」，可改签私密备忘（无此限制）。');
