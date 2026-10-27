import { randomInt, randomUUID } from 'node:crypto';
import { db, nowIso } from './db.js';
import { config } from './config.js';
import { applyExpRaw } from './exp.js';
import { applyCoinRaw } from './coin.js';
import { grantInventoryItem } from './inventory.js';
import { containsSensitiveWord } from './utils/sensitive-words.js';

// ============================================================
// 剧情（story）：策划导入章节模板，玩家以「打卡节点」推进完成。
//
// 章节模板 stories / 节点 story_nodes 与玩家进度 player_stories /
// player_story_checkins 彻底分离。获取方式 obtain_mode：
//   claim 直接领取 | task 完成任务解锁 | gacha 奖池抽取（后续）
// 限定时段 availability：permanent 常驻 | festival 节日限定（窗口）
//
// 完成奖励复用现有三套账本：exp_transactions(source='story')、
// coin_transactions(related_type='story')、inventory_items(source='story')。
// 幂等：一人一章一份进度；完成态迁移是单次 UPDATE，奖励幂等键带 run id。
// ============================================================

const OBTAIN_MODES = ['claim', 'task', 'gacha'];
const AVAILABILITIES = ['permanent', 'festival'];
const CHECKIN_TYPES = ['none', 'text', 'photo', 'link'];
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

function parseJson(s, fallback = null) {
  if (s == null || s === '') return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function bizErr(code, message, status = 400) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

function runTx(fn) {
  try {
    return { value: db.transaction(fn)() };
  } catch (e) {
    if (e && e.code) return { error: e.message, code: e.code, status: e.status || 400 };
    throw e;
  }
}

function toIsoOrThrow(v, label) {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw bizErr('STORY_INVALID', `${label} 时间格式无效`, 400);
  return d.toISOString();
}

function mapStory(row) {
  if (!row) return row;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    subtitle: row.subtitle,
    cover: row.cover,
    category: row.category,
    obtainMode: row.obtain_mode,
    availability: row.availability,
    windowStartAt: row.window_start_at,
    windowEndAt: row.window_end_at,
    festivalCode: row.festival_code,
    unlockTaskId: row.unlock_task_id,
    gachaPoolId: row.gacha_pool_id,
    sequential: !!row.sequential,
    timeboxed: !!row.timeboxed,
    rewards: parseJson(row.rewards_json, { exp: 0, coin: 0, items: [] }),
    sortOrder: row.sort_order,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNode(row) {
  if (!row) return row;
  return {
    id: row.id,
    storyId: row.story_id,
    seq: row.seq,
    title: row.title,
    description: row.description,
    checkinType: row.checkin_type,
    tips: row.tips,
    choices: parseJson(row.choices_json, null),
  };
}

function mapRun(row) {
  if (!row) return row;
  return {
    id: row.id,
    userId: row.user_id,
    storyId: row.story_id,
    status: row.status,
    obtainedVia: row.obtained_via,
    obtainedAt: row.obtained_at,
    completedAt: row.completed_at,
  };
}

function getStory(id) {
  return db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
}

// 是否仍在获取/打卡窗口内（permanent 恒真）
function inWindow(story, now = new Date()) {
  if (story.availability !== 'festival') return true;
  const iso = now.toISOString();
  if (story.window_start_at && iso < story.window_start_at) return false;
  if (story.window_end_at && iso > story.window_end_at) return false;
  return true;
}

// ============================================================
// 获取剧情（无事务版，供 claim 路由与任务验收的事务内复用）
// ============================================================
export function obtainStoryRaw(userId, storyId, via = 'claim') {
  const uid = Number(userId);
  const sid = Number(storyId);
  if (!Number.isInteger(uid) || uid <= 0) return { error: '用户不存在', code: 'STORY_USER_NOT_FOUND', status: 404 };
  if (!Number.isInteger(sid) || sid <= 0) return { error: '剧情不存在', code: 'STORY_NOT_FOUND', status: 404 };
  const story = getStory(sid);
  if (!story) return { error: '剧情不存在', code: 'STORY_NOT_FOUND', status: 404 };

  const info = db
    .prepare('INSERT OR IGNORE INTO player_stories (user_id, story_id, status, obtained_via, obtained_at) VALUES (?, ?, ?, ?, ?)')
    .run(uid, sid, 'in_progress', via, nowIso());
  if (info.changes === 0) {
    const run = db.prepare('SELECT * FROM player_stories WHERE user_id = ? AND story_id = ?').get(uid, sid);
    return { ok: true, duplicate: true, run: mapRun(run) };
  }

  // 首次使用剧情的时间锚点（只设一次）
  db.prepare(
    `INSERT INTO player_story_meta (user_id, first_story_at, completed_count, checkin_count)
     VALUES (?, ?, 0, 0)
     ON CONFLICT(user_id) DO UPDATE SET first_story_at = COALESCE(player_story_meta.first_story_at, excluded.first_story_at)`
  ).run(uid, nowIso());

  const run = db.prepare('SELECT * FROM player_stories WHERE user_id = ? AND story_id = ?').get(uid, sid);
  return { ok: true, duplicate: false, run: mapRun(run) };
}

export function obtainStory(userId, storyId, via = 'claim') {
  return db.transaction(() => obtainStoryRaw(userId, storyId, via))();
}

// ============================================================
// 直接领取（obtain_mode = claim）
// ============================================================
export function claimStory(userId, storyId) {
  const uid = Number(userId);
  const sid = Number(storyId);
  const story = getStory(sid);
  if (!story) return { error: '剧情不存在', code: 'STORY_NOT_FOUND', status: 404 };
  if (story.status !== 'published') return { error: '剧情未开放', code: 'STORY_NOT_PUBLISHED', status: 409 };
  if (story.obtain_mode !== 'claim') return { error: '该剧情需通过其他方式获得', code: 'STORY_NOT_CLAIMABLE', status: 400 };
  if (!inWindow(story)) return { error: '该剧情已过活动期，无法领取', code: 'STORY_WINDOW_CLOSED', status: 409 };
  return obtainStory(uid, sid, 'claim');
}

// ============================================================
// 剧情大厅（含我的进度）
// ============================================================
export function listStories(userId) {
  const uid = Number(userId);
  const stories = db.prepare("SELECT * FROM stories WHERE status = 'published' ORDER BY sort_order ASC, id ASC").all();
  const nodeCounts = new Map(
    db.prepare('SELECT story_id, COUNT(*) AS c FROM story_nodes GROUP BY story_id').all().map((r) => [r.story_id, r.c])
  );
  const runs = new Map(
    db.prepare('SELECT * FROM player_stories WHERE user_id = ?').all(uid).map((r) => [r.story_id, r])
  );
  const checkins = new Map(
    db.prepare('SELECT story_id, COUNT(*) AS c FROM player_story_checkins WHERE user_id = ? GROUP BY story_id').all(uid).map((r) => [r.story_id, r.c])
  );

  return stories.map((s) => {
    const total = nodeCounts.get(s.id) || 0;
    const run = runs.get(s.id) || null;
    const checked = checkins.get(s.id) || 0;
    return {
      ...mapStory(s),
      nodeCount: total,
      obtainable: run ? false : s.obtain_mode === 'claim' && inWindow(s),
      myRun: run ? { ...mapRun(run), checkedCount: checked, nodeCount: total } : null,
    };
  });
}

// ============================================================
// 章节详情（含节点解锁状态）
// ============================================================
export function getStoryDetail(userId, storyId) {
  const uid = Number(userId);
  const sid = Number(storyId);
  const story = getStory(sid);
  if (!story) return { error: '剧情不存在', code: 'STORY_NOT_FOUND', status: 404 };
  if (story.status !== 'published') return { error: '剧情未开放', code: 'STORY_NOT_PUBLISHED', status: 409 };

  const nodes = db.prepare('SELECT * FROM story_nodes WHERE story_id = ? ORDER BY seq ASC').all(sid).map(mapNode);
  const runRow = db.prepare('SELECT * FROM player_stories WHERE user_id = ? AND story_id = ?').get(uid, sid);
  const checkins = new Map(
    db.prepare('SELECT * FROM player_story_checkins WHERE user_id = ? AND story_id = ?')
      .all(uid, sid)
      .map((c) => [c.node_id, c])
  );

  const prevChecked = new Set();
  const nodeViews = nodes.map((n) => {
    const c = checkins.get(n.id) || null;
    const unlocked = !story.sequential || n.seq === 1 || prevChecked.has(n.seq - 1);
    if (c) prevChecked.add(n.seq);
    return {
      ...n,
      unlocked,
      checked: !!c,
      checkedAt: c ? c.checked_at : null,
      choice: c ? c.choice : null,
      proof: c ? parseJson(c.proof_json, null) : null,
    };
  });

  return {
    story: mapStory(story),
    nodes: nodeViews,
    myRun: runRow ? mapRun(runRow) : null,
    obtainable: runRow ? false : story.obtain_mode === 'claim' && inWindow(story),
  };
}

// ============================================================
// 节点打卡（线下完成、线上打卡；打满整章即完成并发奖）
// ============================================================
export function checkinNode(userId, storyId, nodeId, payload = {}) {
  const uid = Number(userId);
  const sid = Number(storyId);
  const nid = Number(nodeId);
  const proof = payload && typeof payload.proof === 'object' ? payload.proof : {};
  const choice = typeof payload.choice === 'string' ? payload.choice.trim() : null;

  // 限时过期需独立提交：若放在下方事务内，抛错会回滚掉过期标记
  const story0 = getStory(sid);
  if (story0 && story0.timeboxed && story0.window_end_at && nowIso() > story0.window_end_at) {
    const run0 = db.prepare('SELECT * FROM player_stories WHERE user_id = ? AND story_id = ?').get(uid, sid);
    if (run0 && run0.status === 'in_progress') {
      db.prepare("UPDATE player_stories SET status = 'expired' WHERE id = ?").run(run0.id);
    }
  }

  const r = runTx(() => {
    const story = getStory(sid);
    if (!story) throw bizErr('STORY_NOT_FOUND', '剧情不存在', 404);

    const runRow = db.prepare('SELECT * FROM player_stories WHERE user_id = ? AND story_id = ?').get(uid, sid);
    if (!runRow) throw bizErr('STORY_NOT_OBTAINED', '你尚未获得该剧情', 409);
    if (runRow.status === 'completed') throw bizErr('STORY_COMPLETED', '该剧情已完成', 409);
    if (runRow.status === 'expired') throw bizErr('STORY_EXPIRED', '该剧情已过期', 409);

    const node = db.prepare('SELECT * FROM story_nodes WHERE id = ? AND story_id = ?').get(nid, sid);
    if (!node) throw bizErr('STORY_NODE_NOT_FOUND', '打卡节点不存在', 404);

    // 兜底：窗口已过（前面已提交过期标记，这里只是防御直接调用方）
    if (story.timeboxed && story.window_end_at && nowIso() > story.window_end_at) {
      throw bizErr('STORY_EXPIRED', '该剧情已过打卡期', 409);
    }

    // 顺序打卡：前一节点未完成则当前不可打卡
    if (story.sequential && node.seq > 1) {
      const prev = db.prepare('SELECT id FROM story_nodes WHERE story_id = ? AND seq = ?').get(sid, node.seq - 1);
      if (prev && !db.prepare('SELECT 1 FROM player_story_checkins WHERE user_id = ? AND node_id = ?').get(uid, prev.id)) {
        throw bizErr('STORY_NODE_LOCKED', '请先完成上一个打卡节点', 409);
      }
    }

    // 凭证校验（按 checkin_type）
    const text = typeof proof.text === 'string' ? proof.text.trim() : '';
    const imageUrl = typeof proof.imageUrl === 'string' ? proof.imageUrl.trim() : '';
    const link = typeof proof.link === 'string' ? proof.link.trim() : '';
    if (node.checkin_type === 'text' && !text) throw bizErr('STORY_PROOF_REQUIRED', '该节点需写一段文字打卡', 400);
    if (node.checkin_type === 'photo' && !imageUrl) throw bizErr('STORY_PROOF_REQUIRED', '该节点需上传图片打卡', 400);
    if (node.checkin_type === 'link' && !link) throw bizErr('STORY_PROOF_REQUIRED', '该节点需附链接打卡', 400);
    if (text && containsSensitiveWord(text)) throw bizErr('SENSITIVE_CONTENT', '内容包含违规词，请修改', 400);

    // 伪分支选择项校验（只记录、不影响走向）
    const choices = parseJson(node.choices_json, null);
    if (choice && Array.isArray(choices) && !choices.includes(choice)) {
      throw bizErr('STORY_INVALID_CHOICE', '选择项无效', 400);
    }

    const proofJson = JSON.stringify({ text, imageUrl, link });
    const info = db
      .prepare('INSERT OR IGNORE INTO player_story_checkins (user_id, story_id, node_id, proof_json, choice, checked_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid, sid, nid, proofJson, choice || null, nowIso());
    if (info.changes === 0) {
      return { duplicate: true, completed: false };
    }

    db.prepare('UPDATE player_story_meta SET checkin_count = checkin_count + 1 WHERE user_id = ?').run(uid);

    // 是否打满整章
    const total = db.prepare('SELECT COUNT(*) AS c FROM story_nodes WHERE story_id = ?').get(sid).c;
    const done = db.prepare('SELECT COUNT(*) AS c FROM player_story_checkins WHERE user_id = ? AND story_id = ?').get(uid, sid).c;
    if (done < total) return { duplicate: false, completed: false };

    // 完成：单次状态迁移 + 一次性发奖励（幂等键带 run id）
    const up = db.prepare("UPDATE player_stories SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'in_progress'").run(nowIso(), runRow.id);
    if (up.changes === 0) return { duplicate: false, completed: true };

    const rewards = parseJson(story.rewards_json, { exp: 0, coin: 0, items: [] });
    if (Number(rewards.exp) > 0) {
      applyExpRaw({ toUserId: uid, amount: Number(rewards.exp), source: 'story', relatedId: runRow.id, idempotencyKey: `story:run:${runRow.id}:complete:exp` });
    }
    if (Number(rewards.coin) > 0) {
      applyCoinRaw({ toUserId: uid, amount: Number(rewards.coin), type: 'mint', relatedType: 'story', relatedId: runRow.id, idempotencyKey: `story:run:${runRow.id}:complete:coin` });
    }
    for (const it of Array.isArray(rewards.items) ? rewards.items : []) {
      grantInventoryItem(uid, {
        name: it.name || '剧情纪念品',
        icon: it.icon || '🎁',
        description: it.description || '',
        rarity: RARITIES.includes(it.rarity) ? it.rarity : 'common',
        source: 'story',
        sourceRefId: runRow.id,
      });
    }
    db.prepare('UPDATE player_story_meta SET completed_count = completed_count + 1 WHERE user_id = ?').run(uid);

    return { duplicate: false, completed: true, rewards };
  });

  if (r.error) return r;
  const freshRun = db.prepare('SELECT * FROM player_stories WHERE user_id = ? AND story_id = ?').get(uid, sid);
  return { ok: true, ...r.value, run: mapRun(freshRun) };
}

// ============================================================
// 我的剧情库
// ============================================================
export function listMyStories(userId) {
  const uid = Number(userId);
  const rows = db.prepare(`
    SELECT ps.*, s.title, s.cover, s.category,
           (SELECT COUNT(*) FROM story_nodes n WHERE n.story_id = ps.story_id) AS total_nodes
    FROM player_stories ps
    JOIN stories s ON s.id = ps.story_id
    WHERE ps.user_id = ?
    ORDER BY ps.id DESC
  `).all(uid);
  const checkins = new Map(
    db.prepare('SELECT story_id, COUNT(*) AS c FROM player_story_checkins WHERE user_id = ? GROUP BY story_id').all(uid).map((r) => [r.story_id, r.c])
  );
  return rows.map((r) => ({
    ...mapRun(r),
    title: r.title,
    cover: r.cover,
    category: r.category,
    nodeCount: r.total_nodes,
    checkedCount: checkins.get(r.story_id) || 0,
  }));
}

// ============================================================
// 时间线故事书（剧情主干 + 全站足迹，实时聚合；满周年解锁定稿）
// ============================================================
export function getStoryTimeline(userId) {
  const uid = Number(userId);
  const meta = db.prepare('SELECT * FROM player_story_meta WHERE user_id = ?').get(uid);
  const firstStoryAt = meta?.first_story_at || null;
  const anniversaryDays = config.story.anniversaryDays;
  const anniversaryAt = firstStoryAt
    ? new Date(new Date(firstStoryAt).getTime() + anniversaryDays * 86400000).toISOString()
    : null;
  const isAnniversary = !!firstStoryAt && nowIso() >= anniversaryAt;

  const completedStories = db.prepare(`
    SELECT ps.completed_at, s.title, s.cover, s.category
    FROM player_stories ps JOIN stories s ON s.id = ps.story_id
    WHERE ps.user_id = ? AND ps.status = 'completed'
    ORDER BY ps.completed_at ASC
  `).all(uid).map((r) => ({ title: r.title, cover: r.cover, category: r.category, completedAt: r.completed_at }));

  const choices = db.prepare(`
    SELECT n.title AS node_title, c.choice, COUNT(*) AS count
    FROM player_story_checkins c JOIN story_nodes n ON n.id = c.node_id
    WHERE c.user_id = ? AND c.choice IS NOT NULL AND c.choice != ''
    GROUP BY n.id, c.choice
    ORDER BY n.id ASC, count DESC
  `).all(uid).map((r) => ({ nodeTitle: r.node_title, choice: r.choice, count: r.count }));

  const items = db.prepare("SELECT name, icon, rarity FROM inventory_items WHERE owner_id = ? AND source = 'story' AND status != 'sold' ORDER BY id DESC").all(uid);

  const footprint = {
    messages: db.prepare('SELECT COUNT(*) AS c FROM messages WHERE user_id = ?').get(uid).c,
    posts: db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?').get(uid).c,
    privateTasksDone: db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE publisher_id = ? AND type = 'private' AND status = 'done'").get(uid).c,
    tasksApproved: db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE assignee_id = ? AND status = 'approved'").get(uid).c,
    signinDays: db.prepare('SELECT COUNT(*) AS c FROM sign_ins WHERE user_id = ?').get(uid).c,
    achievements: db.prepare('SELECT COUNT(*) AS c FROM user_achievements WHERE user_id = ?').get(uid).c,
    expTotal: db.prepare('SELECT exp FROM users WHERE id = ?').get(uid)?.exp ?? 0,
    coinEarned: db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM coin_transactions WHERE to_user_id = ? AND type IN ('mint','transfer')").get(uid).s,
    marketBought: db.prepare("SELECT COUNT(*) AS c FROM market_orders WHERE buyer_id = ? AND status = 'completed'").get(uid).c,
    marketSold: db.prepare("SELECT COUNT(*) AS c FROM market_orders WHERE seller_id = ? AND status = 'completed'").get(uid).c,
    friends: db.prepare("SELECT COUNT(*) AS c FROM friendships WHERE user_id = ? AND status = 'accepted'").get(uid).c,
  };

  const snapshot = firstStoryAt
    ? db.prepare('SELECT * FROM story_timelines WHERE user_id = ? AND period_start_at = ?').get(uid, firstStoryAt)
    : null;

  return {
    firstStoryAt,
    anniversaryAt,
    isAnniversary,
    finalized: !!snapshot,
    snapshot: snapshot
      ? { generatedAt: snapshot.generated_at, periodStartAt: snapshot.period_start_at, periodEndAt: snapshot.period_end_at }
      : null,
    daysUsed: firstStoryAt ? Math.max(0, Math.floor((Date.now() - new Date(firstStoryAt).getTime()) / 86400000)) : 0,
    story: {
      completedCount: meta?.completed_count || 0,
      checkinCount: meta?.checkin_count || 0,
      completedStories,
      choices,
      items,
    },
    footprint,
  };
}

// ============================================================
// 策划批量导入（仅 admin；按 code upsert，节点整章替换）
// ============================================================
export function importStories(adminUserId, payload) {
  const list = Array.isArray(payload) ? payload : payload ? [payload] : [];
  if (!list.length) return { error: '导入内容不能为空', code: 'STORY_EMPTY', status: 400 };

  const created = [];
  const updated = [];

  const r = runTx(() => {
    for (const item of list) {
      const code = (item.code || '').toString().trim();
      const title = (item.title || '').toString().trim();
      if (!code) throw bizErr('STORY_INVALID', '剧情 code 不能为空', 400);
      if (!title) throw bizErr('STORY_INVALID', '剧情标题不能为空', 400);
      const obtainMode = OBTAIN_MODES.includes(item.obtainMode) ? item.obtainMode : 'claim';
      const availability = AVAILABILITIES.includes(item.availability) ? item.availability : 'permanent';
      const nodes = Array.isArray(item.nodes) ? item.nodes : [];
      if (!nodes.length) throw bizErr('STORY_INVALID', `剧情「${code}」缺少打卡节点`, 400);

      const seqs = nodes.map((n) => Number(n.seq));
      if (seqs.some((s) => !Number.isInteger(s) || s <= 0)) throw bizErr('STORY_INVALID', `剧情「${code}」节点 seq 非法`, 400);
      if (new Set(seqs).size !== seqs.length) throw bizErr('STORY_INVALID', `剧情「${code}」节点 seq 重复`, 400);

      const rewards = item.rewards && typeof item.rewards === 'object' ? item.rewards : {};
      const rewardsJson = JSON.stringify({
        exp: Number.isInteger(Number(rewards.exp)) && Number(rewards.exp) > 0 ? Number(rewards.exp) : 0,
        coin: Number.isInteger(Number(rewards.coin)) && Number(rewards.coin) > 0 ? Number(rewards.coin) : 0,
        items: Array.isArray(rewards.items) ? rewards.items : [],
      });

      const windowStart = toIsoOrThrow(item.windowStartAt, 'windowStartAt');
      const windowEnd = toIsoOrThrow(item.windowEndAt, 'windowEndAt');
      const status = ['draft', 'published', 'archived'].includes(item.status) ? item.status : 'published';
      const now = nowIso();

      const existing = db.prepare('SELECT id FROM stories WHERE code = ?').get(code);
      let storyId;
      if (existing) {
        storyId = existing.id;
        db.prepare(`
          UPDATE stories SET title=?, subtitle=?, cover=?, category=?, obtain_mode=?, availability=?,
            window_start_at=?, window_end_at=?, festival_code=?, unlock_task_id=?, gacha_pool_id=?,
            sequential=?, timeboxed=?, rewards_json=?, sort_order=?, status=?, updated_at=?
          WHERE id=?
        `).run(
          title, (item.subtitle || '').toString(), item.cover || '📖', (item.category || '日常').toString(),
          obtainMode, availability, windowStart, windowEnd, item.festivalCode || null,
          item.unlockTaskId != null ? Number(item.unlockTaskId) : null,
          item.gachaPoolId != null ? Number(item.gachaPoolId) : null,
          item.sequential === false ? 0 : 1, item.timeboxed ? 1 : 0, rewardsJson,
          Number.isInteger(Number(item.sortOrder)) ? Number(item.sortOrder) : 0,
          status, now, storyId
        );
        updated.push(code);
      } else {
        const info = db.prepare(`
          INSERT INTO stories (code, title, subtitle, cover, category, obtain_mode, availability,
            window_start_at, window_end_at, festival_code, unlock_task_id, gacha_pool_id,
            sequential, timeboxed, rewards_json, sort_order, status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          code, title, (item.subtitle || '').toString(), item.cover || '📖', (item.category || '日常').toString(),
          obtainMode, availability, windowStart, windowEnd, item.festivalCode || null,
          item.unlockTaskId != null ? Number(item.unlockTaskId) : null,
          item.gachaPoolId != null ? Number(item.gachaPoolId) : null,
          item.sequential === false ? 0 : 1, item.timeboxed ? 1 : 0, rewardsJson,
          Number.isInteger(Number(item.sortOrder)) ? Number(item.sortOrder) : 0,
          status, adminUserId, now, now
        );
        storyId = Number(info.lastInsertRowid);
        created.push(code);
      }

      // 节点整章替换（全量快照，幂等）
      db.prepare('DELETE FROM story_nodes WHERE story_id = ?').run(storyId);
      const insNode = db.prepare('INSERT INTO story_nodes (story_id, seq, title, description, checkin_type, tips, choices_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const n of nodes) {
        const ct = CHECKIN_TYPES.includes(n.checkinType) ? n.checkinType : 'none';
        const choices = Array.isArray(n.choices) ? n.choices.filter((c) => typeof c === 'string' && c.trim()) : null;
        insNode.run(
          storyId,
          Number(n.seq),
          (n.title || '').toString().trim(),
          (n.description || '').toString(),
          ct,
          (n.tips || '').toString(),
          choices && choices.length ? JSON.stringify(choices) : null,
          now
        );
      }
    }
  });

  if (r.error) return r;
  return { ok: true, created, updated };
}

// ============================================================
// 剧情奖池（奖池限定章节的抽取）
// ============================================================

export function listStoryPools(userId) {
  const uid = Number(userId);
  const pools = db.prepare("SELECT * FROM story_pools WHERE status = 'active' ORDER BY id ASC").all();
  const owned = new Set(db.prepare('SELECT story_id FROM player_stories WHERE user_id = ?').all(uid).map((r) => r.story_id));
  return pools.map((p) => {
    const entries = db.prepare('SELECT e.*, s.title, s.cover FROM story_pool_entries e JOIN stories s ON s.id = e.story_id WHERE e.pool_id = ? ORDER BY e.id ASC').all(p.id);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      icon: p.icon,
      drawCostCoin: p.draw_cost_coin,
      startAt: p.start_at,
      endAt: p.end_at,
      status: p.status,
      entryCount: entries.length,
      ownedCount: entries.filter((e) => owned.has(e.story_id)).length,
      entries: entries.map((e) => ({ storyId: e.story_id, title: e.title, cover: e.cover, weight: e.weight, owned: owned.has(e.story_id) })),
    };
  });
}

// 策划批量导入奖池（仅 admin；按 code upsert，条目整池替换，story 用 code 解析）
export function importStoryPools(adminUserId, payload) {
  const list = Array.isArray(payload) ? payload : payload ? [payload] : [];
  if (!list.length) return { error: '导入内容不能为空', code: 'STORY_POOL_EMPTY', status: 400 };

  const created = [];
  const updated = [];
  const r = runTx(() => {
    for (const item of list) {
      const code = (item.code || '').toString().trim();
      const name = (item.name || '').toString().trim();
      if (!code) throw bizErr('STORY_INVALID', '奖池 code 不能为空', 400);
      if (!name) throw bizErr('STORY_INVALID', '奖池名称不能为空', 400);
      const entries = Array.isArray(item.entries) ? item.entries : [];
      const startAt = toIsoOrThrow(item.startAt, 'startAt');
      const endAt = toIsoOrThrow(item.endAt, 'endAt');
      const cost = Number.isInteger(Number(item.drawCostCoin)) && Number(item.drawCostCoin) >= 0 ? Number(item.drawCostCoin) : 50;
      const status = ['active', 'closed'].includes(item.status) ? item.status : 'active';
      const now = nowIso();

      const existing = db.prepare('SELECT id FROM story_pools WHERE code = ?').get(code);
      let poolId;
      if (existing) {
        poolId = existing.id;
        db.prepare('UPDATE story_pools SET name=?, icon=?, draw_cost_coin=?, start_at=?, end_at=?, status=? WHERE id=?')
          .run(name, item.icon || '🎁', cost, startAt, endAt, status, poolId);
        updated.push(code);
      } else {
        const info = db.prepare('INSERT INTO story_pools (code, name, icon, draw_cost_coin, start_at, end_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(code, name, item.icon || '🎁', cost, startAt, endAt, status, now);
        poolId = Number(info.lastInsertRowid);
        created.push(code);
      }

      db.prepare('DELETE FROM story_pool_entries WHERE pool_id = ?').run(poolId);
      const ins = db.prepare('INSERT INTO story_pool_entries (pool_id, story_id, weight) VALUES (?, ?, ?)');
      for (const en of entries) {
        const storyCode = (en.storyCode || en.code || '').toString().trim();
        if (!storyCode) continue;
        const story = db.prepare('SELECT id FROM stories WHERE code = ?').get(storyCode);
        if (!story) throw bizErr('STORY_INVALID', `奖池「${code}」引用了不存在的剧情「${storyCode}」`, 400);
        ins.run(poolId, story.id, Number.isInteger(Number(en.weight)) && Number(en.weight) > 0 ? Number(en.weight) : 1);
      }
    }
  });
  if (r.error) return r;
  return { ok: true, created, updated };
}

// 抽一次：扣费 + 加权抽取（排除已拥有）+ 发放剧情
export function drawStory(userId, poolId) {
  const uid = Number(userId);
  const pid = Number(poolId);
  const pool = db.prepare('SELECT * FROM story_pools WHERE id = ?').get(pid);
  if (!pool) return { error: '奖池不存在', code: 'STORY_POOL_NOT_FOUND', status: 404 };
  if (pool.status !== 'active') return { error: '奖池未开放', code: 'STORY_POOL_CLOSED', status: 409 };
  const now = nowIso();
  if (pool.start_at && now < pool.start_at) return { error: '奖池未开放', code: 'STORY_POOL_CLOSED', status: 409 };
  if (pool.end_at && now > pool.end_at) return { error: '奖池已结束', code: 'STORY_POOL_CLOSED', status: 409 };

  const entries = db.prepare('SELECT * FROM story_pool_entries WHERE pool_id = ?').all(pid);
  const owned = new Set(db.prepare('SELECT story_id FROM player_stories WHERE user_id = ?').all(uid).map((r) => r.story_id));
  const poolEntries = entries.filter((e) => !owned.has(e.story_id));
  if (poolEntries.length === 0) return { error: '奖池内剧情均已拥有', code: 'STORY_POOL_EMPTY', status: 409 };

  const totalWeight = poolEntries.reduce((s, e) => s + Math.max(1, e.weight), 0);
  let roll = randomInt(0, totalWeight);
  let picked = null;
  for (const e of poolEntries) {
    const w = Math.max(1, e.weight);
    if (roll < w) {
      picked = e;
      break;
    }
    roll -= w;
  }
  if (!picked) picked = poolEntries[poolEntries.length - 1];

  const result = runTx(() => {
    const cost = pool.draw_cost_coin || 0;
    if (cost > 0) {
      const c = applyCoinRaw({ fromUserId: uid, amount: cost, type: 'sink', relatedType: 'story_gacha', relatedId: pid, idempotencyKey: `story:gacha:${pid}:${uid}:${randomUUID()}` });
      if (c.error) throw bizErr(c.code, c.error, c.status);
    }
    const obtain = obtainStoryRaw(uid, picked.story_id, 'gacha');
    if (obtain.error) throw bizErr(obtain.code, obtain.error, obtain.status);
    db.prepare('INSERT INTO story_gacha_draws (user_id, pool_id, story_id, cost_coin, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, pid, picked.story_id, cost, nowIso());
    return { storyId: picked.story_id, cost, duplicate: obtain.duplicate };
  });
  if (result.error) return result;
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(result.value.storyId);
  return { ok: true, ...result.value, story: mapStory(story) };
}

// ============================================================
// 时间线故事书：1 周年定稿（快照 + 发纪念物品），幂等
// ============================================================
export function finalizeTimeline(userId) {
  const uid = Number(userId);
  const meta = db.prepare('SELECT * FROM player_story_meta WHERE user_id = ?').get(uid);
  if (!meta || !meta.first_story_at) return { due: false };
  const start = meta.first_story_at;
  const end = new Date(new Date(start).getTime() + config.story.anniversaryDays * 86400000).toISOString();
  if (nowIso() < end) return { due: false };

  const existing = db.prepare('SELECT * FROM story_timelines WHERE user_id = ? AND period_start_at = ?').get(uid, start);
  if (existing) return { due: true, finalized: true, duplicate: true, timelineId: existing.id };

  const contentJson = JSON.stringify(getStoryTimeline(uid));
  const r = runTx(() => {
    const info = db.prepare('INSERT INTO story_timelines (user_id, period_start_at, period_end_at, content_json, generated_at) VALUES (?, ?, ?, ?, ?)').run(uid, start, end, contentJson, nowIso());
    const timelineId = Number(info.lastInsertRowid);
    grantInventoryItem(uid, { name: '时间线故事书', icon: '📖', rarity: 'epic', description: '记录你这一年校园足迹的专属故事书。', source: 'story', sourceRefId: timelineId });
    return { timelineId };
  });
  if (r.error) return r;
  return { due: true, finalized: true, duplicate: false, timelineId: r.value.timelineId };
}

// 扫描并定稿所有到期的故事书（幂等，boot + 定时调用）
export function finalizeDueTimelines() {
  const cutoff = new Date(Date.now() - config.story.anniversaryDays * 86400000).toISOString();
  const due = db.prepare('SELECT user_id FROM player_story_meta WHERE first_story_at IS NOT NULL AND first_story_at <= ?').all(cutoff);
  let finalized = 0;
  for (const d of due) {
    const r = finalizeTimeline(d.user_id);
    if (r && r.finalized && !r.duplicate) finalized++;
  }
  return { finalized };
}
