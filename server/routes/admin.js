import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { requireRole, requirePermission, isSuperAdmin, getUserPermissions, PERMISSIONS } from '../auth.js';
import { applyCoinRaw } from '../coin.js';

const router = Router();

// 所有管理端接口均要求 admin 角色（权限再按 requirePermission 细分）
router.use(requireRole('admin'));

// GET /api/admin/users/search?q= —— 搜索用户（含 role / permissions）
router.get('/users/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const rows = db
    .prepare('SELECT id, nickname, college, avatar, role, permissions FROM users WHERE nickname LIKE ? AND id != ? ORDER BY id ASC LIMIT 20')
    .all(`%${q}%`, req.user.id);
  res.json(rows.map((r) => ({ ...r, permissions: getUserPermissions(r) })));
});

// PATCH /api/admin/user/:id/coin —— 发放/扣除金币（mint / sink + 流水）
router.patch('/user/:id/coin', (req, res) => {
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
router.patch('/user/:id/permissions', requirePermission('ADMIN_GRANT'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(403).json({ error: '不能修改自己的权限' });
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: '用户不存在' });

  const perms = Array.isArray(req.body?.permissions)
    ? req.body.permissions.filter((p) => PERMISSIONS.includes(p))
    : [];
  const role = perms.length ? 'admin' : 'member';
  db.prepare('UPDATE users SET role = ?, permissions = ? WHERE id = ?').run(role, JSON.stringify(perms), id);
  res.json({ ok: true, id, role, permissions: perms });
});

export default router;
