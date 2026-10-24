// 一次性脚本，2026-10-24 执行后 treasury 表已删除。保留仅为记录历史，不要重跑。
import { db } from '../server/db.js';

db.exec('DROP TABLE IF EXISTS treasury;');
console.log('treasury table dropped.');
db.close();
