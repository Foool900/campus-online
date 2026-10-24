import { Router, raw } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';
import { requireRole, requirePermission, isSuperAdmin, getUserPermissions, PERMISSIONS } from '../auth.js';
import { applyCoinRaw } from '../coin.js';
import { ACHIEVEMENT_METRICS } from '../achievements.js';

const router = Router();

// 成就图标上传目录（/uploads 静态托管已覆盖 server/data/uploads）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconUploadsDir = path.join(__dirname, '..', 'data', 'uploads', 'achievements');
fs.mkdirSync(iconUploadsDir, { recursive: true });
const ICON_ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const ICON_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const ICON_MAX = 2 * 1024 * 1024;

// 所有管理端接口均要求 admin 角色（权限再按 requirePermission 细分）
router.use(requireRole('admin'));

// GET /api/admin/users/search?q= —— 按昵称精确搜索用户（含 role / permissions，可搜到自己）
router.get('/admin/users/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const rows = db
    .prepare("SELECT id, nickname, college, avatar, role, permissions FROM users WHERE nickname = ? AND role != 'system' ORDER BY id ASC LIMIT 20")
    .all(q);
  res.json(rows.map((r) => ({ ...r, permissions: getUserPermissions(r) })));
});

// PATCH /api/admin/user/:id/coin —— 发放/扣除金币（mint / sink + 流水）
router.patch('/admin/user/:id/coin', (req, res) => {
  const targetId = Number(req.params.id);
  const amount = Number(req.body?.amount);
  const reason = (req.body?.reason || '').toString().trim();

  if (!Number.isInteger(targetId)) return res.status(400).json({ error: '无效的用户 ID' });
  if (!Number.isInteger(amount) || amount === 0) return res.status(400).json({ error: '金币值必须为非零整数' });

  const isMinus = amount < 0;
  if (!isSuperAdmin(req.user)) {
    const need = isMinus ? 'COIN_MINUS' : 'COIN_ADD';
    if (!getUserPermissions(req.user).includes(need)) return res.status(403).json({ error: '无权限' });
  }

  const target = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: '用户不存在' });

  const abs = Math.abs(amount);
  const result = isMinus
    ? applyCoinRaw({ fromUserId: targetId, amount: abs, type: 'sink', relatedType: 'admin', note: reason || null, idempotencyKey: `admin:${targetId}:${randomUUID()}` })
    : applyCoinRaw({ toUserId: targetId, amount: abs, type: 'mint', relatedType: 'admin', note: reason || null, idempotencyKey: `admin:${targetId}:${randomUUID()}` });

  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true, amount, reason, target: target.nickname, balance: isMinus ? result.from.coin : result.to.coin });
});

// PATCH /api/admin/user/:id/permissions —— 设置角色与权限（仅 SuperAdmin 或持有 ADMIN_GRANT）
router.patch('/admin/user/:id/permissions', requirePermission('ADMIN_GRANT'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(403).json({ error: '不能修改自己的权限' });
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: '用户不存在' });

  const perms = Array.isArray(req.body?.permissions)
    ? req.body.permissions.filter((p) => PERMISSIONS.includes(p))
    : [];
  // 仅设置该管理员的权限分工；是否管理员由 POST/DELETE /api/admin 控制，故 role 恒为 admin
  db.prepare("UPDATE users SET role = 'admin', permissions = ? WHERE id = ?").run(JSON.stringify(perms), id);
  res.json({ ok: true, id, role: 'admin', permissions: perms });
});

// ===== 成就管理（需 ACHIEVEMENT_MANAGE 权限）=====

// 校验成就输入，返回 { error, status } 或 { value }。requireCode 用于创建时校验 code 合法性与唯一性。
function validateAchievement(body, { requireCode = false } = {}) {
  const name = (body?.name ?? '').toString().trim();
  const description = (body?.description ?? '').toString().trim();
  const icon = (body?.icon ?? '🏅').toString().trim() || '🏅';
  const type = (body?.type ?? 'exploration').toString().trim() || 'exploration';
  const kind = body?.kind === 'trigger' ? 'trigger' : 'progress';
  const conditionVisible = [false, 0, '0'].includes(body?.condition_visible) ? 0 : 1;

  if (!name) return { error: '名称不能为空', status: 400 };
  if (!description) return { error: '描述不能为空', status: 400 };

  if (requireCode) {
    const code = (body?.code ?? '').toString().trim();
    if (!/^[A-Za-z0-9_-]+$/.test(code)) return { error: 'code 只能包含字母、数字、下划线和连字符', status: 400 };
    if (db.prepare('SELECT 1 FROM achievements WHERE code = ?').get(code)) return { error: 'code 已存在', status: 409 };
  }

  if (kind === 'progress') {
    const metric = (body?.metric ?? '').toString().trim();
    if (!ACHIEVEMENT_METRICS.includes(metric)) return { error: '无效的成就指标 metric', status: 400 };
    const threshold = Number(body?.threshold);
    if (!Number.isInteger(threshold) || threshold < 0) return { error: 'threshold 需为非负整数', status: 400 };
    const page = (body?.page ?? '').toString().trim();
    if (metric === 'page_opens' && !page) return { error: 'page_opens 指标需要填写界面 page', status: 400 };
    return { value: { name, description, icon, type, kind, metric, threshold, page, conditionVisible } };
  }

  const hint = (body?.hint ?? '').toString().trim();
  return { value: { name, description, icon, type, kind, hint, conditionVisible } };
}

// GET /api/admin/achievements —— 成就定义列表（管理视图，含未做隐藏处理的字段）
router.get('/admin/achievements', requirePermission('ACHIEVEMENT_MANAGE'), (req, res) => {
  res.json(db.prepare('SELECT * FROM achievements ORDER BY kind ASC, id ASC').all());
});

// POST /api/admin/achievements —— 新增成就
router.post('/admin/achievements', requirePermission('ACHIEVEMENT_MANAGE'), (req, res) => {
  const { error, status, value } = validateAchievement(req.body, { requireCode: true });
  if (error) return res.status(status).json({ error });
  const code = (req.body?.code ?? '').toString().trim();

  if (value.kind === 'progress') {
    db.prepare(
      'INSERT INTO achievements (code, name, description, icon, metric, threshold, kind, type, condition_visible, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(code, value.name, value.description, value.icon, value.metric, value.threshold, 'progress', value.type, value.conditionVisible, value.page || '');
  } else {
    db.prepare(
      "INSERT INTO achievements (code, name, description, icon, metric, threshold, kind, type, hint, condition_visible) VALUES (?, ?, ?, ?, 'trigger', 1, 'trigger', ?, ?, ?)"
    ).run(code, value.name, value.description, value.icon, value.type, value.hint, value.conditionVisible);
  }
  res.status(201).json({ ok: true, code });
});

// PATCH /api/admin/achievements/:code —— 编辑成就（code 为标识，不可改）
router.patch('/admin/achievements/:code', requirePermission('ACHIEVEMENT_MANAGE'), (req, res) => {
  const code = (req.params.code || '').toString().trim();
  if (!db.prepare('SELECT 1 FROM achievements WHERE code = ?').get(code)) return res.status(404).json({ error: '成就不存在' });

  const { error, status, value } = validateAchievement(req.body);
  if (error) return res.status(status).json({ error });

  if (value.kind === 'progress') {
    db.prepare(
      "UPDATE achievements SET name = ?, description = ?, icon = ?, metric = ?, threshold = ?, kind = 'progress', type = ?, hint = '', condition_visible = ?, page = ? WHERE code = ?"
    ).run(value.name, value.description, value.icon, value.metric, value.threshold, value.type, value.conditionVisible, value.page || '', code);
  } else {
    db.prepare(
      "UPDATE achievements SET name = ?, description = ?, icon = ?, metric = 'trigger', threshold = 1, kind = 'trigger', type = ?, hint = ?, condition_visible = ?, page = '' WHERE code = ?"
    ).run(value.name, value.description, value.icon, value.type, value.hint, value.conditionVisible, code);
  }
  res.json({ ok: true, code });
});

// DELETE /api/admin/achievements/:code —— 删除成就定义，并顺带清掉对应解锁记录
router.delete('/admin/achievements/:code', requirePermission('ACHIEVEMENT_MANAGE'), (req, res) => {
  const code = (req.params.code || '').toString().trim();
  if (!db.prepare('SELECT 1 FROM achievements WHERE code = ?').get(code)) return res.status(404).json({ error: '成就不存在' });
  db.prepare('DELETE FROM user_achievements WHERE achievement_code = ?').run(code);
  db.prepare('DELETE FROM achievements WHERE code = ?').run(code);
  res.json({ ok: true, code });
});

// POST /api/admin/achievements/icon —— 上传成就图标（raw 图片二进制），返回可用的 url
router.post('/admin/achievements/icon', requirePermission('ACHIEVEMENT_MANAGE'), raw({ type: ICON_ALLOWED, limit: '3mb' }), (req, res) => {
  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!ICON_ALLOWED.includes(ct)) return res.status(415).json({ error: '仅支持 png / jpg / gif / webp 格式' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: '文件为空' });
  if (buf.length > ICON_MAX) return res.status(413).json({ error: '图标不能超过 2MB' });

  const filename = `ach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ICON_EXT[ct]}`;
  fs.writeFileSync(path.join(iconUploadsDir, filename), buf);
  res.status(201).json({ url: `/uploads/achievements/${filename}` });
});

export default router;
