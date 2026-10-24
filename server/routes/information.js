import { Router } from 'express';
import { db } from '../db.js';
import { STATUS_LABELS } from './posts.js';

// 「信息大厅」：全局活动聚合 + 关键词搜索 + 最新资讯（占位数据层，未来切校园新闻）
const router = Router();

// 活动帖 + 区域/频道信息（信息大厅专用，排除隐藏区域，保证与地图口径一致）
const SELECT_POST = `
  SELECT p.id,
         p.channel_id  AS channelId,
         p.user_id     AS userId,
         p.title,
         p.content,
         p.category,
         p.status,
         p.created_at  AS createdAt,
         u.nickname,
         u.avatar,
         u.college,
         c.name        AS channelName,
         a.id          AS areaId,
         a.name        AS areaName,
         a.emoji       AS areaEmoji,
         a.color       AS areaColor
  FROM posts p
  JOIN users u    ON u.id = p.user_id
  JOIN channels c ON c.id = p.channel_id
  JOIN areas a    ON a.id = c.area_id
  WHERE a.hidden = 0
`;

function parseJson(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function withStatusLabel(rows) {
  return rows.map((r) => ({ ...r, statusLabel: STATUS_LABELS[r.status] || r.status }));
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// 请求参数整数化（非法/缺失回退默认值）
function intParam(v, fallback, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// Echo 回响：关键词搜索（活动帖 + 公开任务）
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = intParam(req.query.limit, 20, 1, 50);
  if (!q) return res.json({ posts: [], tasks: [] });

  const like = `%${q}%`;

  const posts = db
    .prepare(
      `${SELECT_POST}
       AND (p.title LIKE ? OR p.content LIKE ? OR p.category LIKE ?)
       ORDER BY p.id DESC LIMIT ?`
    )
    .all(like, like, like, limit);

  const tasks = db
    .prepare(
      `SELECT t.id,
              t.publisher_id AS publisherId,
              t.assignee_id  AS assigneeId,
              t.type,
              t.title,
              t.description,
              t.tags,
              t.reward_coin  AS rewardCoin,
              t.status,
              t.deadline_at  AS deadlineAt,
              t.created_at   AS createdAt,
              pu.nickname    AS publisherName,
              pu.avatar      AS publisherAvatar,
              au.nickname    AS assigneeName,
              au.avatar      AS assigneeAvatar
       FROM tasks t
       JOIN users pu ON pu.id = t.publisher_id
       LEFT JOIN users au ON au.id = t.assignee_id
       WHERE t.type = 'public'
         AND (t.title LIKE ? OR t.description LIKE ? OR t.tags LIKE ?)
       ORDER BY t.id DESC LIMIT ?`
    )
    .all(like, like, like, limit);

  res.json({
    posts: withStatusLabel(posts),
    tasks: tasks.map((t) => ({ ...t, tags: parseJson(t.tags) || [] })),
  });
});

// 全局活动列表（Discovery / Radar / Lens 共用的数据源），支持分类/状态/区域过滤
router.get('/posts', (req, res) => {
  const { category, status, areaId } = req.query;
  const limit = intParam(req.query.limit, 50, 1, 200);

  const where = [];
  const params = [];
  if (category) {
    where.push('p.category = ?');
    params.push(category);
  }
  if (status) {
    where.push('p.status = ?');
    params.push(status);
  }
  if (areaId && Number.isInteger(Number(areaId))) {
    where.push('a.id = ?');
    params.push(Number(areaId));
  }

  const sql = `${SELECT_POST}${where.length ? ' AND ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT ?`;
  params.push(limit);

  res.json(withStatusLabel(db.prepare(sql).all(...params)));
});

// 最新资讯（占位）：最新活动 + 全服喇叭，归一化结构，未来切 announcements 表（前端零改动）
router.get('/news', (req, res) => {
  const postRows = db
    .prepare(
      `SELECT p.id, p.title, p.content, p.created_at AS createdAt, u.nickname
       FROM posts p
       JOIN users u    ON u.id = p.user_id
       JOIN channels c ON c.id = p.channel_id
       JOIN areas a    ON a.id = c.area_id
       WHERE a.hidden = 0
       ORDER BY p.created_at DESC LIMIT 8`
    )
    .all();

  const broadcastRows = db
    .prepare(
      `SELECT b.id, b.content, b.created_at AS createdAt, u.nickname
       FROM market_broadcasts b
       JOIN users u ON u.id = b.user_id
       WHERE b.status = 'published'
       ORDER BY b.created_at DESC LIMIT 5`
    )
    .all();

  const items = [
    ...postRows.map((r) => ({
      title: r.title,
      summary: truncate(r.content, 80),
      time: r.createdAt,
      source: '活动',
      link: `/activity/${r.id}`,
    })),
    ...broadcastRows.map((r) => ({
      title: `喇叭 · ${r.nickname}`,
      summary: truncate(r.content, 80),
      time: r.createdAt,
      source: '广播',
      link: '/market',
    })),
  ]
    .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0))
    .slice(0, 10);

  res.json({ items });
});

export default router;
