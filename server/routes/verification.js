import { Router, raw } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nowIso } from '../db.js';
import { requireRole, requirePermission, isSuperAdmin, getUserPermissions } from '../auth.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads', 'verification');
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED = ['image/png', 'image/jpeg'];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg' };
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

function mapApp(row) {
  if (!row) return row;
  let images = [];
  try {
    images = JSON.parse(row.images || '[]');
  } catch {
    images = [];
  }
  return {
    id: row.id,
    userId: row.user_id,
    nickname: row.nickname,
    college: row.college,
    images,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    note: row.note,
  };
}

// POST /api/verification/upload —— 上传一张认证图片（登录即可）
router.post('/verification/upload', raw({ type: ALLOWED, limit: '6mb' }), (req, res) => {
  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED.includes(ct)) {
    return res.status(415).json({ error: '仅支持 png / jpg 格式' });
  }
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json({ error: '文件为空' });
  }
  if (buf.length > MAX_SIZE) {
    return res.status(413).json({ error: '单张不能超过 5MB' });
  }
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT[ct]}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buf);
  res.status(201).json({ url: `/uploads/verification/${filename}` });
});

// GET /api/verification/me —— 我的认证申请（最新一条）
router.get('/verification/me', (req, res) => {
  const app = db.prepare('SELECT * FROM verifications WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  res.json(app ? mapApp(app) : null);
});

// POST /api/verification —— 提交认证申请（需两张图）
router.post('/verification', (req, res) => {
  const { images } = req.body || {};
  if (!Array.isArray(images) || images.length < 2) {
    return res.status(400).json({ error: '请上传「学信网截图」和「今日学院截图」两张图片' });
  }
  const urls = images.slice(0, 2).map((u) => (typeof u === 'string' ? u.trim() : ''));
  if (urls.some((u) => !u.startsWith('/uploads/verification/'))) {
    return res.status(400).json({ error: '图片地址无效' });
  }
  const pending = db
    .prepare("SELECT id FROM verifications WHERE user_id = ? AND status = 'pending'")
    .get(req.user.id);
  if (pending) {
    return res.status(409).json({ error: '你已提交过申请，正在审核中' });
  }

  const info = db
    .prepare("INSERT INTO verifications (user_id, images, status, submitted_at) VALUES (?, ?, 'pending', ?)")
    .run(req.user.id, JSON.stringify(urls), nowIso());
  res.status(201).json(mapApp(db.prepare('SELECT * FROM verifications WHERE id = ?').get(info.lastInsertRowid)));
});

// GET /api/verification/pending —— 待审核列表（管理员）
router.get('/verification/pending', requireRole('admin'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT v.*, u.nickname, u.college
       FROM verifications v JOIN users u ON u.id = v.user_id
       WHERE v.status = 'pending'
       ORDER BY v.id ASC`
    )
    .all();
  res.json(rows.map(mapApp));
});

// POST /api/verification/:id/approve —— 通过（管理员，用户变学员）
router.post('/verification/:id/approve', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '无效的申请 ID' });
  const app = db.prepare('SELECT * FROM verifications WHERE id = ?').get(id);
  if (!app) return res.status(404).json({ error: '申请不存在' });
  if (app.status !== 'pending') return res.status(409).json({ error: '该申请已处理' });

  db.prepare("UPDATE verifications SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(
    req.user.id,
    nowIso(),
    id
  );
  db.prepare("UPDATE users SET role = 'student' WHERE id = ?").run(app.user_id);
  res.json({ ok: true });
});

// POST /api/verification/:id/reject —— 拒绝（管理员）
router.post('/verification/:id/reject', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '无效的申请 ID' });
  const app = db.prepare('SELECT * FROM verifications WHERE id = ?').get(id);
  if (!app) return res.status(404).json({ error: '申请不存在' });
  if (app.status !== 'pending') return res.status(409).json({ error: '该申请已处理' });

  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  db.prepare("UPDATE verifications SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, note = ? WHERE id = ?").run(
    req.user.id,
    nowIso(),
    note,
    id
  );
  res.json({ ok: true });
});

// GET /api/admin —— 管理员列表（管理员；含权限与是否超级管理员，供前端分层展示）
router.get('/admin', requireRole('admin'), (req, res) => {
  const admins = db
    .prepare("SELECT id, nickname, college, avatar, role, permissions FROM users WHERE role = 'admin' ORDER BY id ASC")
    .all();
  res.json(
    admins.map((a) => ({
      id: a.id,
      nickname: a.nickname,
      college: a.college,
      avatar: a.avatar,
      permissions: getUserPermissions(a),
      isSuper: isSuperAdmin(a),
    }))
  );
});

// POST /api/admin —— 添加辅助管理员（仅超级管理员）
router.post('/admin', requirePermission('ADMIN_GRANT'), (req, res) => {
  const { nickname } = req.body || {};
  const name = typeof nickname === 'string' ? nickname.trim() : '';
  if (!name) return res.status(400).json({ error: '请输入要添加的管理员昵称' });
  const user = db.prepare('SELECT * FROM users WHERE nickname = ?').get(name);
  if (!user) return res.status(404).json({ error: '该用户不存在' });
  // 新管理员默认无 RBAC 权限，由超级管理员随后按需分配
  db.prepare("UPDATE users SET role = 'admin', permissions = '[]' WHERE id = ?").run(user.id);
  res.json({ ok: true });
});

// DELETE /api/admin/:id —— 移除管理员（仅超级管理员；不能移除自己）
router.delete('/admin/:id', requirePermission('ADMIN_GRANT'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '无效的用户 ID' });
  if (id === req.user.id) return res.status(403).json({ error: '不能移除自己' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role !== 'admin') return res.status(409).json({ error: '该用户不是管理员' });

  // 移除管理员：若曾是认证学员则降回学员，否则降回会员；同时清空权限
  const wasStudent = db
    .prepare("SELECT 1 FROM verifications WHERE user_id = ? AND status = 'approved'")
    .get(id);
  db.prepare('UPDATE users SET role = ?, permissions = ? WHERE id = ?').run(wasStudent ? 'student' : 'member', '[]', id);
  res.json({ ok: true });
});

export default router;
