// 一次性内容清理脚本：清空「聊天内容」+「活动」，不改变任何用户信息。
//
// 用法（在服务器上，项目根目录）：
//   node server/scripts/cleanup-content.js
//
// 行为：
//   1. 先自动备份数据库到 server/data/backups/（better-sqlite3 的 backup 会正确处理 WAL，产出单文件快照）；
//   2. 清空 messages（区域/世界/活动/私聊/群聊/任务讨论全部消息）和 posts（活动帖）；
//   3. 外键级联自动清掉 message_reactions / message_reads / post_participants / post_notes / post_operation_logs；
//   4. 不触碰 users / sessions / exp / coin / achievements / inventory / 角色 / 好友 / 任务 / 夜市 等任何用户或业务数据。
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'campus.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const count = (sql) => db.prepare(sql).get().c;

const before = {
  users: count('SELECT COUNT(*) c FROM users'),
  messages: count('SELECT COUNT(*) c FROM messages'),
  posts: count('SELECT COUNT(*) c FROM posts'),
};

if (before.messages === 0 && before.posts === 0) {
  console.log('无需清理：messages 和 posts 已都是空表，未做任何改动。');
  db.close();
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = path.join(dataDir, 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, 'campus.db.' + stamp + '.bak');
await db.backup(backupPath);
console.log('已备份数据库 →', backupPath);

const wipe = db.transaction(() => {
  db.prepare('DELETE FROM messages').run();
  db.prepare('DELETE FROM posts').run();
});
wipe();

const after = {
  users: count('SELECT COUNT(*) c FROM users'),
  messages: count('SELECT COUNT(*) c FROM messages'),
  posts: count('SELECT COUNT(*) c FROM posts'),
};

console.log('清理完成：');
console.log('  聊天消息：', before.messages, '→', after.messages);
console.log('  活动帖子：', before.posts, '→', after.posts);
console.log('  用户数：', before.users, '→', after.users, '（保持不变：' + (before.users === after.users) + '）');
db.close();
