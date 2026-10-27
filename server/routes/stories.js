import { Router, raw } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRole } from '../auth.js';
import { notifyNewProgressAchievements } from '../achievements.js';
import {
  listStories,
  getStoryDetail,
  claimStory,
  checkinNode,
  listMyStories,
  getStoryTimeline,
  importStories,
  listStoryPools,
  importStoryPools,
  drawStory,
} from '../story.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads', 'stories');
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

// GET /api/stories —— 剧情大厅（登录即可浏览，含我的进度）
router.get('/stories', (req, res) => {
  res.json(listStories(req.user.id));
});

// GET /api/stories/mine —— 我的剧情库
router.get('/stories/mine', (req, res) => {
  res.json(listMyStories(req.user.id));
});

// GET /api/stories/timeline —— 时间线故事书（满周年解锁定稿，平时为实时预览）
router.get('/stories/timeline', (req, res) => {
  res.json(getStoryTimeline(req.user.id));
});

// GET /api/stories/pools —— 剧情奖池列表（含我的拥有情况）
router.get('/stories/pools', (req, res) => {
  res.json(listStoryPools(req.user.id));
});

// POST /api/stories/pools/import —— 策划批量导入奖池（仅 admin）
router.post('/stories/pools/import', requireRole('admin'), (req, res) => {
  const result = importStoryPools(req.user.id, req.body);
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  res.status(201).json(result);
});

// POST /api/stories/pools/:id/draw —— 抽一次
router.post('/stories/pools/:id/draw', requireRole('student', 'admin'), (req, res) => {
  const result = drawStory(req.user.id, Number(req.params.id));
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  res.json(result);
});

// POST /api/stories/upload —— 打卡图片上传（raw 图片二进制）
router.post('/stories/upload', raw({ type: ALLOWED, limit: '6mb' }), requireRole('student', 'admin'), (req, res) => {
  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED.includes(ct)) return res.status(415).json({ error: '仅支持 png / jpg / gif / webp 格式' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: '文件为空' });
  if (buf.length > MAX_SIZE) return res.status(413).json({ error: '单张不能超过 5MB' });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT[ct]}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buf);
  res.status(201).json({ url: `/uploads/stories/${filename}` });
});

// POST /api/stories/import —— 策划批量导入剧情（仅 admin，按 code upsert）
router.post('/stories/import', requireRole('admin'), (req, res) => {
  const result = importStories(req.user.id, req.body);
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  res.status(201).json(result);
});

// GET /api/stories/:id —— 章节详情（含节点解锁状态）
router.get('/stories/:id', (req, res) => {
  const result = getStoryDetail(req.user.id, Number(req.params.id));
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  res.json(result);
});

// POST /api/stories/:id/claim —— 直接领取（obtain_mode = claim）
router.post('/stories/:id/claim', requireRole('student', 'admin'), (req, res) => {
  const result = claimStory(req.user.id, Number(req.params.id));
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  res.status(201).json(result);
});

// POST /api/stories/:id/checkin —— 节点打卡（body: { nodeId, proof, choice }）
router.post('/stories/:id/checkin', requireRole('student', 'admin'), (req, res) => {
  const result = checkinNode(req.user.id, Number(req.params.id), Number(req.body?.nodeId), req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  // 打卡/完成可能让 stories_completed / story_checkins 跨过阈值 → 检测并弹窗
  notifyNewProgressAchievements(req.user.id, req.app.get('io'));
  res.json(result);
});

export default router;
