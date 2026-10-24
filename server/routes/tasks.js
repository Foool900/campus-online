import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { requireRole } from '../auth.js';
import { config, levelOf, taskRewardCap, dailyPublishCap } from '../config.js';
import { applyExpRaw } from '../exp.js';
import { applyCoinRaw } from '../coin.js';
import { triggerAchievement } from '../achievements.js';
import {
  worldChannelId,
  listConversationMessages,
  insertConversationMessage,
  recallConversationMessage,
  reactConversationMessage,
  readConversation,
  listReads,
} from './messages.js';

const router = Router();

const TASK_TYPES = ['private', 'public'];
// 终态（不再流转，不可再取消/接取/提交/验收）
const TERMINAL = ['approved', 'terminated', 'expired', 'cancelled'];

// 本地日历日零点（「每日」额度按服务器本地日计算；created_at 为 ISO 绝对时间，跨时区比较仍正确）
function dayStartIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// 行为经验发放（带每日上限 + 幂等）。返回 true=已发，false=超限跳过。
function grantBehaviorExp(toUserId, amount, { relatedId, idempotencyKey }) {
  const dayStart = dayStartIso();
  const earned = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM exp_transactions WHERE to_user_id = ? AND type = 'grant' AND source = 'behavior' AND created_at >= ?")
    .get(toUserId, dayStart).s;
  if (earned + amount > config.exp.dailyCap) return false;
  const r = applyExpRaw({ toUserId, amount, source: 'behavior', relatedId, idempotencyKey });
  return !r.error;
}

function parseJson(s, fallback = null) {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

const SELECT_TASK = `
  SELECT t.*,
         pu.nickname AS publisher_name, pu.avatar AS publisher_avatar,
         au.nickname AS assignee_name, au.avatar AS assignee_avatar
  FROM tasks t
  JOIN users pu ON pu.id = t.publisher_id
  LEFT JOIN users au ON au.id = t.assignee_id
`;

function mapTask(row) {
  if (!row) return row;
  return {
    id: row.id,
    publisherId: row.publisher_id,
    assigneeId: row.assignee_id,
    type: row.type,
    title: row.title,
    description: row.description,
    tags: parseJson(row.tags, []),
    rewardCoin: row.reward_coin,
    status: row.status,
    minCompleteAt: row.min_complete_at,
    deadlineAt: row.deadline_at,
    submittedProof: parseJson(row.submitted_proof, null),
    rejectCount: row.reject_count,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    submittedAt: row.submitted_at,
    finishedAt: row.finished_at,
    publisherName: row.publisher_name,
    publisherAvatar: row.publisher_avatar,
    assigneeName: row.assignee_name,
    assigneeAvatar: row.assignee_avatar,
  };
}

function getTask(id) {
  return db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(id);
}

function getRawTask(id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

// 我的角色：publisher / assignee / other
function roleOf(task, uid) {
  if (task.publisher_id === uid) return 'publisher';
  if (task.assignee_id === uid) return 'assignee';
  return 'other';
}

// 业务错误（在事务内 throw 触发回滚，由 runTx 捕获）
function throwErr(code, message, status = 400) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  throw e;
}

// 事务包装：把业务错误转成 { error, code, status }，其余异常继续上抛
function runTx(fn) {
  try {
    return { value: db.transaction(fn)() };
  } catch (e) {
    if (e && e.code) return { error: e.message, code: e.code, status: e.status || 400 };
    throw e;
  }
}

// 系统消息：写进任务讨论区（conversation_type='task'）
function insertTaskSystemMessage(taskId, operatorId, content) {
  const info = db
    .prepare(
      "INSERT INTO messages (channel_id, user_id, post_id, conversation_type, conversation_id, type, content, created_at) VALUES (?, ?, NULL, 'task', ?, 'system', ?, ?)"
    )
    .run(worldChannelId(), operatorId, taskId, content, nowIso());
  return db
    .prepare(
      `SELECT m.id, m.conversation_type AS conversationType, m.conversation_id AS conversationId, m.user_id AS userId, m.type, m.content, m.created_at AS createdAt, u.nickname, u.avatar
       FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`
    )
    .get(info.lastInsertRowid);
}

function auditLog(ctx, { userId, event, detail }) {
  db.prepare('INSERT INTO audit_logs (user_id, event, detail, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    userId ?? null,
    event,
    detail ?? null,
    ctx?.ip ?? null,
    String(ctx?.userAgent || '').slice(0, 255) || null,
    nowIso()
  );
}

function emitTaskChanged(req, taskId, sys) {
  const io = req.app.get('io');
  if (!io) return;
  const task = mapTask(getTask(taskId));
  if (sys) io.to(`task:${taskId}`).emit('message:new', { conversationType: 'task', conversationId: taskId, message: sys });
  io.to(`task:${taskId}`).emit('task:status', { taskId, status: task.status, task });
}

// 触发式成就：幂等触发并收集（阈值判断由调用方完成）
function collectAchievement(list, userId, code) {
  const a = triggerAchievement(userId, code);
  if (a) list.push({ userId, code: a.code, name: a.name, icon: a.icon, description: a.description });
}
function notifyUnlocked(req, unlocked) {
  const io = req.app.get('io');
  if (!io || !unlocked?.length) return;
  for (const u of unlocked) {
    io.to(`user:${u.userId}`).emit('achievement:unlocked', { code: u.code, name: u.name, icon: u.icon, description: u.description });
  }
}

// ============================================================
// 业务函数（导出供单测；路由层做薄包装 + 权限 + socket 推送）
// ============================================================

// 发布任务。返回 { task, sys } 或 { error, code, status }
export function publishTask(user, payload) {
  const { type, title, description, tags, rewardCoin, deadlineAt } = payload || {};
  const uid = user.id;

  if (!TASK_TYPES.includes(type)) return { error: '任务类型无效', code: 'EX_TASK_TYPE', status: 400 };

  const t = typeof title === 'string' ? title.trim() : '';
  if (!t) return { error: '任务标题不能为空', code: 'EX_TITLE_EMPTY', status: 400 };
  if (t.length > 60) return { error: '任务标题过长（最多 60 字）', code: 'EX_TITLE_LONG', status: 400 };

  const desc = typeof description === 'string' ? description.trim() : '';
  if (desc.length > 2000) return { error: '任务描述过长（最多 2000 字）', code: 'EX_DESC_LONG', status: 400 };

  const tagList = (Array.isArray(tags) ? tags : [])
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim().slice(0, 20))
    .slice(0, 5);
  const tagsJson = JSON.stringify(tagList);

  let deadline = null;
  if (deadlineAt) {
    const d = new Date(String(deadlineAt));
    if (Number.isNaN(d.getTime())) return { error: '截止时间格式无效', code: 'EX_DEADLINE_INVALID', status: 400 };
    deadline = d.toISOString();
  }

  // ===== 私密备忘：奖励恒 0，状态 todo =====
  if (type === 'private') {
    const info = db
      .prepare(
        `INSERT INTO tasks (publisher_id, type, title, description, tags, reward_coin, status, deadline_at, created_at)
         VALUES (?, 'private', ?, ?, ?, 0, 'todo', ?, ?)`
      )
      .run(uid, t, desc, tagsJson, deadline, nowIso());
    const unlocked = [];
    const privCount = db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE publisher_id = ? AND type = 'private'").get(uid).c;
    if (privCount >= 20) collectAchievement(unlocked, uid, 'EXP_007');
    return { task: mapTask(getTask(info.lastInsertRowid)), sys: null, unlocked };
  }

  // ===== 公开任务 =====
  const reward = rewardCoin === undefined || rewardCoin === null ? 0 : Number(rewardCoin);
  if (!Number.isInteger(reward) || reward < 0) {
    return { error: '奖励金币无效', code: 'EX_REWARD_INVALID', status: 400 };
  }

  const me = db.prepare('SELECT exp, coin FROM users WHERE id = ?').get(uid);
  const cap = taskRewardCap(me.coin);
  if (reward > cap) {
    const unlocked = [];
    if (me.coin === 0) collectAchievement(unlocked, uid, 'EXP_008');
    return { error: `单任务赏金不能超过 ${cap}（金币余额 ${me.coin}）`, code: 'EX_REWARD_OVER_CAP', status: 400, unlocked };
  }

  // 每日发布额度 / 数量
  const dayStart = dayStartIso();
  const level = levelOf(me.exp);
  const publishCoinCap = dailyPublishCap(level);
  const usedCoin = db
    .prepare("SELECT COALESCE(SUM(reward_coin), 0) AS s FROM tasks WHERE publisher_id = ? AND type = 'public' AND created_at >= ?")
    .get(uid, dayStart).s;
  if (usedCoin + reward > publishCoinCap) {
    return { error: `今日发布赏金额度已满（${usedCoin}/${publishCoinCap}）`, code: 'EX_DAILY_PUBLISH_COIN', status: 400 };
  }
  const publishCount = db
    .prepare("SELECT COUNT(*) AS c FROM tasks WHERE publisher_id = ? AND type = 'public' AND created_at >= ?")
    .get(uid, dayStart).c;
  if (publishCount >= config.task.dailyPublishPublic) {
    return { error: '今日发布公开任务数已达上限', code: 'EX_DAILY_PUBLISH_COUNT', status: 400 };
  }

  const minCompleteAt = new Date(Date.now() + config.task.minCompleteMinutes * 60 * 1000).toISOString();

  const result = runTx(() => {
    const info = db
      .prepare(
        `INSERT INTO tasks (publisher_id, type, title, description, tags, reward_coin, status, min_complete_at, deadline_at, created_at)
         VALUES (?, 'public', ?, ?, ?, ?, 'published', ?, ?, ?)`
      )
      .run(uid, t, desc, tagsJson, reward, minCompleteAt, deadline, nowIso());
    const taskId = Number(info.lastInsertRowid);

    // 发布即冻结赏金（幂等键 task:{id}:freeze）
    if (reward > 0) {
      const coin = applyCoinRaw({ fromUserId: uid, amount: reward, type: 'freeze', relatedType: 'task', relatedId: taskId, idempotencyKey: `task:${taskId}:freeze` });
      if (coin.error) throwErr(coin.code, coin.error, coin.status);
    }

    const sys = insertTaskSystemMessage(taskId, uid, `${user.nickname} 发布了公开任务`);
    return { task: mapTask(getTask(taskId)), sys };
  });

  if (result.error) return result;
  const unlocked = [];
  const totalReward = db.prepare("SELECT COALESCE(SUM(reward_coin), 0) AS s FROM tasks WHERE publisher_id = ? AND type = 'public'").get(uid).s;
  if (totalReward >= 1000) collectAchievement(unlocked, uid, 'EXP_006');
  return { ...result.value, unlocked };
}

// 列表。filter: public | mine | assigned | private
export function listTasks(userId, { filter = 'public', status = null, sort = 'created' } = {}) {
  const where = [];
  const params = [];
  if (filter === 'mine') {
    where.push('t.publisher_id = ?');
    params.push(userId);
  } else if (filter === 'assigned') {
    where.push('t.assignee_id = ?');
    params.push(userId);
  } else if (filter === 'private') {
    where.push("t.publisher_id = ? AND t.type = 'private'");
    params.push(userId);
  } else {
    where.push("t.type = 'public'");
  }
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  const orderBy = sort === 'deadline' ? 't.deadline_at IS NULL, t.deadline_at ASC, t.id DESC' : 't.id DESC';
  const rows = db.prepare(`${SELECT_TASK} WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`).all(...params);
  return rows.map(mapTask);
}

// 详情（含我的角色）。私密任务仅本人可见。
export function getTaskDetail(userId, taskId) {
  const task = getTask(taskId);
  if (!task) return { error: '任务不存在', code: 'EX_NOT_FOUND', status: 404 };
  if (task.type === 'private' && task.publisher_id !== userId) {
    return { error: '无权查看该任务', code: 'EX_FORBIDDEN', status: 403 };
  }
  return { task: { ...mapTask(task), role: roleOf(task, userId) } };
}

// 接取（自己不能接自己；仅 published 可接）
export function acceptTask(user, taskId) {
  const result = runTx(() => {
    const task = getRawTask(taskId);
    if (!task) throwErr('EX_NOT_FOUND', '任务不存在', 404);
    if (task.type !== 'public') throwErr('EX_NOT_PUBLIC', '私密任务不可接取', 400);
    if (task.publisher_id === user.id) throwErr('EX_SELF_ACCEPT', '不能接取自己发布的任务', 400);
    if (task.status !== 'published') throwErr('EX_BAD_STATE', '当前状态不可接取', 409);

    db.prepare("UPDATE tasks SET assignee_id = ?, status = 'accepted', accepted_at = ? WHERE id = ?").run(user.id, nowIso(), taskId);
    const sys = insertTaskSystemMessage(taskId, user.id, `${user.nickname} 接取了任务`);
    return { task: mapTask(getTask(taskId)), sys };
  });
  if (result.error) return result;
  return result.value;
}

// 提交（需凭证；最短完成时间内不可提交；仅 accepted）
export function submitTask(user, taskId, proof) {
  const p = proof && typeof proof === 'object' ? proof : {};
  const hasText = typeof p.text === 'string' && p.text.trim();
  const hasImage = typeof p.imageUrl === 'string' && p.imageUrl.trim();
  const hasLink = typeof p.link === 'string' && p.link.trim();
  if (!hasText && !hasImage && !hasLink) {
    return { error: '请至少提供文本 / 图片 / 链接之一作为凭证', code: 'EX_PROOF_REQUIRED', status: 400 };
  }
  const proofJson = JSON.stringify({
    text: hasText ? p.text.trim().slice(0, 2000) : '',
    imageUrl: hasImage ? p.imageUrl.trim() : '',
    link: hasLink ? p.link.trim() : '',
  });

  const result = runTx(() => {
    const task = getRawTask(taskId);
    if (!task) throwErr('EX_NOT_FOUND', '任务不存在', 404);
    if (task.type !== 'public') throwErr('EX_NOT_PUBLIC', '私密任务无需提交', 400);
    if (task.assignee_id !== user.id) throwErr('EX_NOT_ASSIGNEE', '只有接取者可以提交', 403);
    if (task.status !== 'accepted') throwErr('EX_BAD_STATE', '当前状态不可提交', 409);
    if (task.min_complete_at && nowIso() < task.min_complete_at) {
      throwErr('EX_TOO_EARLY', '任务发布后最短完成时间内不可提交', 409);
    }

    db.prepare("UPDATE tasks SET status = 'submitted', submitted_proof = ?, submitted_at = ? WHERE id = ?").run(proofJson, nowIso(), taskId);
    const sys = insertTaskSystemMessage(taskId, user.id, `${user.nickname} 提交了完成凭证`);
    return { task: mapTask(getTask(taskId)), sys };
  });
  if (result.error) return result;
  return result.value;
}

// 验收通过（经验划转 + 每日接取/往来上限）
export function approveTask(user, taskId, ctx = {}) {
  const result = runTx(() => {
    const task = getRawTask(taskId);
    if (!task) throwErr('EX_NOT_FOUND', '任务不存在', 404);
    if (task.publisher_id !== user.id) throwErr('EX_NOT_PUBLISHER', '只有发布者可以验收', 403);
    if (task.status !== 'submitted') throwErr('EX_BAD_STATE', '当前状态不可验收', 409);

    const reward = task.reward_coin;
    const assigneeId = task.assignee_id;
    const dayStart = dayStartIso();

    // 每日接取获得金币上限
    const receivedToday = db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM coin_transactions WHERE to_user_id = ? AND type = 'transfer' AND created_at >= ?")
      .get(assigneeId, dayStart).s;
    if (receivedToday + reward > config.coin.dailyAccept) {
      throwErr('EX_DAILY_ACCEPT', '接取者今日获得金币已达上限', 400);
    }

    // 每日同一对用户金币往来次数上限（命中打标，只记录不封禁）
    const pairCount = db
      .prepare(
        `SELECT COUNT(*) AS c FROM coin_transactions WHERE type = 'transfer' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)) AND created_at >= ?`
      )
      .get(user.id, assigneeId, assigneeId, user.id, dayStart).c;
    if (pairCount >= config.coin.dailyPairTransfer) {
      auditLog(ctx, { userId: user.id, event: 'high_freq_mutual', detail: `with=${assigneeId};task=${taskId}` });
      throwErr('EX_DAILY_PAIR', '今日与该用户的金币往来已达上限', 400);
    }

    // 划转：发布者 frozen_coin → 接取者 coin（幂等键 task:{id}:approve）
    if (reward > 0) {
      const coin = applyCoinRaw({ fromUserId: user.id, toUserId: assigneeId, amount: reward, type: 'transfer', relatedType: 'task', relatedId: taskId, idempotencyKey: `task:${taskId}:approve` });
      if (coin.error) throwErr(coin.code, coin.error, coin.status);
    }
    // 接取者完成行为：发经验（等级成长，带每日上限，幂等键 task:{id}:exp）
    grantBehaviorExp(assigneeId, config.exp.taskComplete, { relatedId: taskId, idempotencyKey: `task:${taskId}:exp` });

    db.prepare("UPDATE tasks SET status = 'approved', finished_at = ? WHERE id = ?").run(nowIso(), taskId);
    const sys = insertTaskSystemMessage(taskId, user.id, `${user.nickname} 验收通过，奖励已发放`);
    auditLog(ctx, { userId: user.id, event: 'task_approved', detail: `task=${taskId};assignee=${assigneeId};reward=${reward}` });
    return { task: mapTask(getTask(taskId)), sys };
  });
  if (result.error) return result;
  const unlocked = [];
  const assigneeId = result.value.task.assigneeId;
  const approvedCount = db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE assignee_id = ? AND status = 'approved'").get(assigneeId).c;
  if (approvedCount === 1) collectAchievement(unlocked, assigneeId, 'EXP_005');
  return { ...result.value, unlocked };
}

// 驳回（达到上限 → terminated + 退经验；否则回 accepted 可重交）
export function rejectTask(user, taskId, ctx = {}) {
  const result = runTx(() => {
    const task = getRawTask(taskId);
    if (!task) throwErr('EX_NOT_FOUND', '任务不存在', 404);
    if (task.publisher_id !== user.id) throwErr('EX_NOT_PUBLISHER', '只有发布者可以驳回', 403);
    if (task.status !== 'submitted') throwErr('EX_BAD_STATE', '当前状态不可驳回', 409);

    const nextCount = task.reject_count + 1;
    const maxReject = config.task.maxRejectCount;
    let sys;
    if (nextCount >= maxReject) {
      // 终止 + 退赏金（幂等键 task:{id}:refund）
      if (task.reward_coin > 0) {
        const coin = applyCoinRaw({ fromUserId: user.id, amount: task.reward_coin, type: 'refund', relatedType: 'task', relatedId: taskId, idempotencyKey: `task:${taskId}:refund` });
        if (coin.error) throwErr(coin.code, coin.error, coin.status);
      }
      db.prepare("UPDATE tasks SET status = 'terminated', reject_count = ?, finished_at = ? WHERE id = ?").run(nextCount, nowIso(), taskId);
      sys = insertTaskSystemMessage(taskId, user.id, `任务被驳回 ${nextCount} 次，已终止，奖励已退回`);
    } else {
      db.prepare("UPDATE tasks SET status = 'accepted', reject_count = ?, submitted_proof = NULL, submitted_at = NULL WHERE id = ?").run(nextCount, taskId);
      sys = insertTaskSystemMessage(taskId, user.id, `任务被驳回（${nextCount}/${maxReject}），可重新提交`);
    }
    auditLog(ctx, { userId: user.id, event: 'task_rejected', detail: `task=${taskId};count=${nextCount}` });
    return { task: mapTask(getTask(taskId)), sys };
  });
  if (result.error) return result;
  const unlocked = [];
  const rejected = result.value.task;
  if (rejected.status === 'terminated' && rejected.assigneeId) collectAchievement(unlocked, rejected.assigneeId, 'EXP_009');
  return { ...result.value, unlocked };
}

// 发布者取消（非终态 → cancelled + 退经验）
export function cancelTask(user, taskId) {
  const result = runTx(() => {
    const task = getRawTask(taskId);
    if (!task) throwErr('EX_NOT_FOUND', '任务不存在', 404);
    if (task.type !== 'public') throwErr('EX_NOT_PUBLIC', '私密任务请用打卡 / 删除', 400);
    if (task.publisher_id !== user.id) throwErr('EX_NOT_PUBLISHER', '只有发布者可以取消', 403);
    if (TERMINAL.includes(task.status)) throwErr('EX_BAD_STATE', '终态任务不可取消', 409);

    if (task.reward_coin > 0) {
      const coin = applyCoinRaw({ fromUserId: user.id, amount: task.reward_coin, type: 'refund', relatedType: 'task', relatedId: taskId, idempotencyKey: `task:${taskId}:refund` });
      if (coin.error) throwErr(coin.code, coin.error, coin.status);
    }
    db.prepare("UPDATE tasks SET status = 'cancelled', finished_at = ? WHERE id = ?").run(nowIso(), taskId);
    const sys = insertTaskSystemMessage(taskId, user.id, `${user.nickname} 取消了任务，奖励已退回`);
    return { task: mapTask(getTask(taskId)), sys };
  });
  if (result.error) return result;
  return result.value;
}

// 接取者放弃（accepted → published）
export function abandonTask(user, taskId) {
  const result = runTx(() => {
    const task = getRawTask(taskId);
    if (!task) throwErr('EX_NOT_FOUND', '任务不存在', 404);
    if (task.assignee_id !== user.id) throwErr('EX_NOT_ASSIGNEE', '只有接取者可以放弃', 403);
    if (task.status !== 'accepted') throwErr('EX_BAD_STATE', '当前状态不可放弃', 409);

    db.prepare("UPDATE tasks SET assignee_id = NULL, status = 'published', accepted_at = NULL WHERE id = ?").run(taskId);
    const sys = insertTaskSystemMessage(taskId, user.id, `${user.nickname} 放弃了任务`);
    return { task: mapTask(getTask(taskId)), sys };
  });
  if (result.error) return result;
  return result.value;
}

// 私密备忘打卡 / 撤销（todo ↔ done）
export function toggleTaskDone(user, taskId) {
  const result = runTx(() => {
    const task = getRawTask(taskId);
    if (!task) throwErr('EX_NOT_FOUND', '任务不存在', 404);
    if (task.type !== 'private') throwErr('EX_NOT_PRIVATE', '仅私密备忘支持打卡', 400);
    if (task.publisher_id !== user.id) throwErr('EX_NOT_OWNER', '只能操作自己的备忘', 403);

    if (task.status === 'done') {
      db.prepare("UPDATE tasks SET status = 'todo', finished_at = NULL WHERE id = ?").run(taskId);
    } else {
      db.prepare("UPDATE tasks SET status = 'done', finished_at = ? WHERE id = ?").run(nowIso(), taskId);
      // 完成私密备忘：发行为经验（幂等键 task:{id}:exp，重复打卡不重复发放）
      grantBehaviorExp(user.id, config.exp.todoComplete, { relatedId: taskId, idempotencyKey: `task:${taskId}:exp` });
    }
    return { task: mapTask(getTask(taskId)) };
  });
  if (result.error) return result;
  return result.value;
}

// 超时扫描：到期未验收的公开任务按配置退回（默认）或自动通过。返回处理条数。
export function expireOverdueTasks(io) {
  const now = nowIso();
  const overdue = db
    .prepare("SELECT * FROM tasks WHERE type = 'public' AND status IN ('published','accepted','submitted') AND deadline_at IS NOT NULL AND deadline_at < ?")
    .all(now);

  let handled = 0;
  for (const task of overdue) {
    const result = runTx(() => {
      if (config.task.expireAction === 'autoApprove' && task.status === 'submitted') {
        if (task.reward_coin > 0) {
          const coin = applyCoinRaw({ fromUserId: task.publisher_id, toUserId: task.assignee_id, amount: task.reward_coin, type: 'transfer', relatedType: 'task', relatedId: task.id, idempotencyKey: `task:${task.id}:approve` });
          if (coin.error) throwErr(coin.code, coin.error, coin.status);
        }
        grantBehaviorExp(task.assignee_id, config.exp.taskComplete, { relatedId: task.id, idempotencyKey: `task:${task.id}:exp` });
        db.prepare("UPDATE tasks SET status = 'approved', finished_at = ? WHERE id = ?").run(now, task.id);
        const sys = insertTaskSystemMessage(task.id, task.publisher_id, '任务超时，已自动验收通过');
        return { status: 'approved', sys };
      }

      if (task.reward_coin > 0) {
        const coin = applyCoinRaw({ fromUserId: task.publisher_id, amount: task.reward_coin, type: 'refund', relatedType: 'task', relatedId: task.id, idempotencyKey: `task:${task.id}:refund` });
        if (coin.error) throwErr(coin.code, coin.error, coin.status);
      }
      db.prepare("UPDATE tasks SET status = 'expired', finished_at = ? WHERE id = ?").run(now, task.id);
      const sys = insertTaskSystemMessage(task.id, task.publisher_id, '任务已过期，奖励已退回发布者');
      return { status: 'expired', sys };
    });

    if (result.error) {
      console.error('[tasks] 过期处理失败:', result.code, result.error);
      continue;
    }
    handled += 1;
    const { status, sys } = result.value;
    if (io) {
      io.to(`task:${task.id}`).emit('message:new', { conversationType: 'task', conversationId: task.id, message: sys });
      io.to(`task:${task.id}`).emit('task:status', { taskId: task.id, status, task: mapTask(getTask(task.id)) });
    }
  }
  return handled;
}

// ============================================================
// 路由（薄包装：权限 + 入参解析 + socket 推送）
// ============================================================

router.post('/tasks', requireRole('student', 'admin'), (req, res) => {
  const result = publishTask(req.user, req.body || {});
  notifyUnlocked(req, result.unlocked);
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  emitTaskChanged(req, result.task.id, result.sys);
  res.status(201).json(result.task);
});

router.get('/tasks', (req, res) => {
  const { filter, status, sort } = req.query;
  res.json(listTasks(req.user.id, { filter: String(filter || 'public'), status: status ? String(status) : null, sort: String(sort || 'created') }));
});

router.get('/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '无效的任务 ID' });
  const result = getTaskDetail(req.user.id, id);
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  res.json(result.task);
});

router.post('/tasks/:id/accept', requireRole('student', 'admin'), (req, res) => {
  const result = acceptTask(req.user, Number(req.params.id));
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  emitTaskChanged(req, result.task.id, result.sys);
  res.json(result.task);
});

router.post('/tasks/:id/submit', requireRole('student', 'admin'), (req, res) => {
  const result = submitTask(req.user, Number(req.params.id), req.body?.proof);
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  emitTaskChanged(req, result.task.id, result.sys);
  res.json(result.task);
});

router.post('/tasks/:id/approve', requireRole('student', 'admin'), (req, res) => {
  const result = approveTask(req.user, Number(req.params.id), { ip: req.ip, userAgent: req.headers['user-agent'] });
  notifyUnlocked(req, result.unlocked);
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  emitTaskChanged(req, result.task.id, result.sys);
  res.json(result.task);
});

router.post('/tasks/:id/reject', requireRole('student', 'admin'), (req, res) => {
  const result = rejectTask(req.user, Number(req.params.id), { ip: req.ip, userAgent: req.headers['user-agent'] });
  notifyUnlocked(req, result.unlocked);
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  emitTaskChanged(req, result.task.id, result.sys);
  res.json(result.task);
});

router.post('/tasks/:id/cancel', requireRole('student', 'admin'), (req, res) => {
  const result = cancelTask(req.user, Number(req.params.id));
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  emitTaskChanged(req, result.task.id, result.sys);
  res.json(result.task);
});

router.post('/tasks/:id/abandon', requireRole('student', 'admin'), (req, res) => {
  const result = abandonTask(req.user, Number(req.params.id));
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  emitTaskChanged(req, result.task.id, result.sys);
  res.json(result.task);
});

router.patch('/tasks/:id/toggle-done', requireRole('student', 'admin'), (req, res) => {
  const result = toggleTaskDone(req.user, Number(req.params.id));
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  emitTaskChanged(req, result.task.id, null);
  res.json(result.task);
});

// ============================================================
// 任务讨论区（复用统一消息模型，conversation_type='task'，消息按任务严格隔离）
// ============================================================

router.get('/tasks/:id/messages', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '无效的任务 ID' });
  if (!db.prepare('SELECT id FROM tasks WHERE id = ?').get(id)) {
    return res.status(404).json({ error: '任务不存在' });
  }
  res.json(listConversationMessages('task', id));
});

router.post('/tasks/:id/messages', requireRole('student', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const result = insertConversationMessage('task', id, req.user.id, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  const io = req.app.get('io');
  if (io) io.to(`task:${id}`).emit('message:new', { conversationType: 'task', conversationId: id, message: result.message });
  res.status(201).json(result.message);
});

router.post('/tasks/:id/messages/:mid/recall', requireRole('student', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const result = recallConversationMessage('task', id, Number(req.params.mid), req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const io = req.app.get('io');
  if (io) io.to(`task:${id}`).emit('message:recalled', { conversationType: 'task', conversationId: id, messageId: result.messageId, recalledBy: req.user.id });
  res.json(result);
});

router.post('/tasks/:id/messages/:mid/react', requireRole('student', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const result = reactConversationMessage('task', id, Number(req.params.mid), req.user.id, req.body?.emoji);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const io = req.app.get('io');
  if (io) io.to(`task:${id}`).emit('message:reaction', { conversationType: 'task', conversationId: id, messageId: result.messageId, reactions: result.reactions });
  res.json(result);
});

router.get('/tasks/:id/messages/:mid/reads', (req, res) => {
  const rows = listReads('task', Number(req.params.id), Number(req.params.mid));
  if (rows === null) return res.status(404).json({ error: '消息不存在' });
  res.json(rows);
});

router.post('/tasks/:id/read', requireRole('student', 'admin'), (req, res) => {
  const result = readConversation('task', Number(req.params.id), req.user.id, Number(req.body?.upToMessageId));
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

export default router;
