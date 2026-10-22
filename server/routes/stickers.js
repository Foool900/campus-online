import { Router, raw } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nowIso } from '../db.js';
import { requireRole } from '../auth.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads', 'stickers');
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_COUNT = 50; // 每人上限

// 权限说明：表情包是「个人资产」，按用户隔离、与活动无绑定关系，
// 因此上传/删除仅要求「已登录用户」即可（有 userId），不涉及活动 participant 角色。
// 发送表情包到活动讨论区时，才走 insertPostMessage 的 participant/终态鉴权。

// GET /api/stickers?userId= —— 我的表情包
router.get('/stickers', (req, res) => {
  const userId = req.user.id;
  const stickers = db
    .prepare('SELECT id, user_id AS userId, url, created_at AS createdAt FROM stickers WHERE user_id = ? ORDER BY id DESC')
    .all(userId);
  res.json(stickers);
});

// POST /api/stickers?userId= —— 上传表情包（raw 图片二进制）
router.post('/stickers', raw({ type: ALLOWED, limit: '3mb' }), requireRole('student', 'admin'), (req, res) => {
  const userId = req.user.id;
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED.includes(ct)) {
    return res.status(415).json({ error: '仅支持 png / jpg / gif / webp 格式' });
  }

  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json({ error: '文件为空' });
  }
  if (buf.length > MAX_SIZE) {
    return res.status(413).json({ error: '单张不能超过 2MB' });
  }

  const count = db.prepare('SELECT COUNT(*) AS c FROM stickers WHERE user_id = ?').get(userId).c;
  if (count >= MAX_COUNT) {
    return res.status(429).json({ error: '每人最多 50 张表情包' });
  }

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT[ct]}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buf);

  const url = `/uploads/stickers/${filename}`;
  const info = db.prepare('INSERT INTO stickers (user_id, url, created_at) VALUES (?, ?, ?)').run(userId, url, nowIso());
  res.status(201).json({ id: info.lastInsertRowid, userId, url, createdAt: nowIso() });
});

// DELETE /api/stickers/:id?userId= —— 删除自己的表情包
router.delete('/stickers/:id', requireRole('student', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const userId = req.user.id;
  const sticker = db.prepare('SELECT id, url FROM stickers WHERE id = ? AND user_id = ?').get(id, userId);
  if (!sticker) return res.status(404).json({ error: '表情包不存在' });

  db.prepare('DELETE FROM stickers WHERE id = ?').run(id);
  const filename = sticker.url.split('/').pop();
  try {
    fs.unlinkSync(path.join(uploadsDir, filename));
  } catch {
    /* 文件可能已不存在，忽略 */
  }
  res.json({ ok: true });
});

export default router;
