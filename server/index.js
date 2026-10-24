import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { initDb, db, nowIso } from './db.js';
import { seedIfEmpty, ensureWorldChannel, ensureAdmin, ensureAchievements } from './seed.js';
import { bumpPresence, presenceList, bumpGlobalPresence } from './presence.js';
import areasRouter from './routes/areas.js';
import channelsRouter from './routes/channels.js';
import messagesRouter, { insertConversationMessage, worldChannelId } from './routes/messages.js';
import usersRouter from './routes/users.js';
import campusesRouter from './routes/campuses.js';
import postsRouter from './routes/posts.js';
import achievementsRouter from './routes/achievements.js';
import worldRouter from './routes/world.js';
import coinRouter from './routes/coin.js';
import signinRouter from './routes/signin.js';
import marketRouter, { ensureMarketShops, drawStalls, settleSession, expireStalls, expireBargainPayments, releaseBlindboxHolds, settleDueShopTerms } from './routes/market.js';
import lotteryRouter from './routes/lottery.js';
import tasksRouter, { expireOverdueTasks } from './routes/tasks.js';
import stickersRouter from './routes/stickers.js';
import authRouter from './routes/auth.js';
import verificationRouter from './routes/verification.js';
import friendsRouter from './routes/friends.js';
import conversationsRouter from './routes/conversations.js';
import adminRouter from './routes/admin.js';
import { requireAuth, getSessionUser } from './auth.js';
import { triggerAchievement } from './achievements.js';

// 初始化数据库表结构与种子数据（仅在空库时写入）
initDb();
const seeded = seedIfEmpty();
ensureWorldChannel();
ensureAdmin();
ensureAchievements();
ensureMarketShops();
if (seeded) {
  console.log('[db] 已写入种子数据：2 个校区 / 区域与频道 / 示例消息与帖子 / 成就');
}

const app = express();
const PORT = process.env.PORT || 3001;

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.set('io', io);

app.use(express.json());

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'campus-online-server', time: new Date().toISOString() });
});

// 认证（公开，无需登录）
app.use('/api', authRouter);

// 全局鉴权：其余所有 /api 都需要登录
app.use('/api', requireAuth);

// 业务路由（登录后可用）
app.use('/api', areasRouter);
app.use('/api', channelsRouter);
app.use('/api', messagesRouter);
app.use('/api', usersRouter);
app.use('/api', campusesRouter);
app.use('/api', postsRouter);
app.use('/api', achievementsRouter);
app.use('/api', worldRouter);
app.use('/api', coinRouter);
app.use('/api', signinRouter);
app.use('/api', marketRouter);
app.use('/api', lotteryRouter);
app.use('/api', tasksRouter);
app.use('/api', stickersRouter);
app.use('/api', verificationRouter);
app.use('/api', friendsRouter);
app.use('/api', conversationsRouter);
app.use('/api', adminRouter);

// 未匹配的 /api 路由
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 生产环境：托管前端构建产物（client/dist），前后端同源，一个 URL 即可访问
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const clientDist = path.join(__dirname, '..', 'client', 'dist');

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));

  // 前端用 BrowserRouter，任何非 /api 的 GET 请求都回退到 index.html
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(clientDist, 'index.html'));
    }
    next();
  });
} else {
  console.warn('[server] 未找到 client/dist（前端尚未构建）。开发模式请用 npm run dev；部署前请先 npm run build。');
}

// 统一错误处理
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: '文件过大' });
  }
  console.error('[server] 未处理错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

function convRoom(type, id) {
  return type === 'activity' ? `post:${id}` : type === 'chat' ? `channel:${id}` : `${type}:${id}`;
}

function broadcastPresence(type, id) {
  io.to(convRoom(type, id)).emit('presence:update', { conversationType: type, conversationId: id, online: presenceList(type, id) });
}

function trackPresence(socket, type, id, userId) {
  if (!Number.isInteger(id) || !Number.isInteger(userId)) return;
  socket.data.userId = userId;
  if (!socket.data.rooms) socket.data.rooms = new Set();
  const key = `${type}:${id}`;
  if (socket.data.rooms.has(key)) return;
  socket.data.rooms.add(key);
  bumpPresence(type, id, userId, 1);
  broadcastPresence(type, id);
}

function untrackPresence(socket, type, id, userId) {
  if (!Number.isInteger(id) || !Number.isInteger(userId)) return;
  const key = `${type}:${id}`;
  if (!socket.data.rooms?.has(key)) return;
  socket.data.rooms.delete(key);
  bumpPresence(type, id, userId, -1);
  broadcastPresence(type, id);
}

// Socket.IO 鉴权：握手带 token，未登录拒绝连接
io.use((socket, next) => {
  const user = getSessionUser(socket.handshake.auth?.token);
  if (!user) return next(new Error('未登录'));
  socket.data.user = user;
  next();
});

// Socket.IO：房间名 channel:{channelId} / post:{postId}（均带在线成员 presence）
io.on('connection', (socket) => {
  if (socket.data.user) {
    bumpGlobalPresence(socket.data.user.id, 1);
    socket.join(`user:${socket.data.user.id}`); // 成就解锁通知房间
  }

  socket.on('join:channel', ({ channelId }) => {
    const cid = Number(channelId);
    if (!Number.isInteger(cid)) return;
    socket.join(`channel:${cid}`);
    trackPresence(socket, 'chat', cid, socket.data.user.id);
  });

  socket.on('leave:channel', ({ channelId }) => {
    const cid = Number(channelId);
    if (!Number.isInteger(cid)) return;
    socket.leave(`channel:${cid}`);
    untrackPresence(socket, 'chat', cid, socket.data.user.id);
  });

  socket.on('join:post', ({ postId }) => {
    const pid = Number(postId);
    if (!Number.isInteger(pid)) return;
    socket.join(`post:${pid}`);
    trackPresence(socket, 'activity', pid, socket.data.user.id);
  });
  socket.on('leave:post', ({ postId }) => {
    const pid = Number(postId);
    if (!Number.isInteger(pid)) return;
    socket.leave(`post:${pid}`);
    untrackPresence(socket, 'activity', pid, socket.data.user.id);
  });

  // 通用会话事件（direct / group）
  socket.on('join:conv', ({ conversationType, conversationId }) => {
    const type = conversationType;
    const id = Number(conversationId);
    if (!Number.isInteger(id) || !type) return;
    socket.join(convRoom(type, id));
    trackPresence(socket, type, id, socket.data.user.id);
  });
  socket.on('leave:conv', ({ conversationType, conversationId }) => {
    const type = conversationType;
    const id = Number(conversationId);
    if (!Number.isInteger(id) || !type) return;
    socket.leave(convRoom(type, id));
    untrackPresence(socket, type, id, socket.data.user.id);
  });

  socket.on('disconnect', () => {
    if (socket.data.user) bumpGlobalPresence(socket.data.user.id, -1);
    const userId = socket.data.userId;
    const rooms = socket.data.rooms;
    if (rooms && Number.isInteger(userId)) {
      for (const key of rooms) {
        const i = key.indexOf(':');
        bumpPresence(key.slice(0, i), Number(key.slice(i + 1)), userId, -1);
        broadcastPresence(key.slice(0, i), Number(key.slice(i + 1)));
      }
    }
  });

  socket.on('message:send', ({ channelId, postId, conversationType, conversationId, content, type, replyTo, mentions }, ack) => {
    const userId = socket.data.user?.id;
    if (!Number.isInteger(userId)) {
      if (typeof ack === 'function') ack({ ok: false, error: '未登录' });
      return;
    }

    // 会话维度：优先用显式 conversationType/conversationId，兼容旧的 postId/channelId
    let convType;
    let convId;
    let room;
    if (conversationType && Number.isInteger(Number(conversationId))) {
      convType = conversationType;
      convId = Number(conversationId);
      room = convType === 'activity' ? `post:${convId}` : convType === 'chat' ? `channel:${convId}` : `${convType}:${convId}`;
    } else if (Number.isInteger(Number(postId))) {
      convType = 'activity';
      convId = Number(postId);
      room = `post:${convId}`;
    } else {
      convType = 'chat';
      convId = Number(channelId);
      room = `channel:${convId}`;
    }

    const result = insertConversationMessage(convType, convId, userId, { type, content, replyTo, mentions });
    if (result.error) {
      if (typeof ack === 'function') ack({ ok: false, error: result.error });
      return;
    }
    io.to(room).emit('message:new', {
      conversationType: result.message.conversationType,
      conversationId: result.message.conversationId,
      channelId: Number(channelId) || null,
      postId: convType === 'activity' ? convId : null,
      message: result.message,
    });

    // ===== 触发式成就埋点（消息维度：EXP_010/011/012/013/014）=====
    const unlock = (code) => {
      const ach = triggerAchievement(userId, code);
      if (ach) {
        io.to(`user:${userId}`).emit('achievement:unlocked', { code: ach.code, name: ach.name, icon: ach.icon, description: ach.description });
      }
    };
    const wcId = worldChannelId();
    const now = new Date();
    if (convType === 'chat' && convId === wcId) {
      const wcCount = db
        .prepare("SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND conversation_type = 'chat' AND conversation_id = ?")
        .get(userId, wcId).c;
      if (wcCount === 1) unlock('EXP_010');
      const hour = now.getHours();
      if (hour >= 2 && hour < 4) unlock('EXP_014');
    }
    const recent = db
      .prepare('SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND created_at >= ?')
      .get(userId, new Date(now.getTime() - 60000).toISOString()).c;
    if (recent >= 10) unlock('EXP_011');
    if (Array.isArray(mentions) && mentions.length) {
      const totalMentions = db
        .prepare("SELECT COALESCE(SUM(json_array_length(mentions)), 0) AS s FROM messages WHERE user_id = ? AND mentions IS NOT NULL")
        .get(userId).s;
      if (totalMentions >= 50) unlock('EXP_012');
    }
    if (type === 'sticker') {
      const stickerCount = db.prepare('SELECT COUNT(*) AS c FROM stickers WHERE user_id = ?').get(userId).c;
      if (stickerCount >= 50) unlock('EXP_013');
    }

    if (typeof ack === 'function') ack({ ok: true, message: result.message });
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] Campus Online 后端已启动: http://localhost:${PORT}`);
});

// 超时任务扫描：启动即扫一次，之后每分钟扫一次（到期退回 / 自动通过 + 通知）
expireOverdueTasks(io);
setInterval(() => expireOverdueTasks(io), 60 * 1000);

// 夜市生命周期：报名抽签 → 开市 → 闭市 → 结算（每 30s 扫一次）
function tickMarket() {
  const now = nowIso();
  try {
    const toDraw = db.prepare("SELECT * FROM market_sessions WHERE status='upcoming' AND draw_status='pending' AND signup_end_at <= ?").all(now);
    for (const s of toDraw) drawStalls(s.id);
    db.prepare("UPDATE market_sessions SET status='open' WHERE status='upcoming' AND open_at <= ?").run(now);
    const toClose = db.prepare("SELECT * FROM market_sessions WHERE status='open' AND close_at <= ?").all(now);
    for (const s of toClose) {
      db.prepare("UPDATE market_sessions SET status='closed' WHERE id=?").run(s.id);
      settleSession(s.id);
    }
    // 定时任务：地摊到期 / 砍价支付超时 / 盲盒保证金释放 / 店铺竞拍结算
    expireStalls(now);
    expireBargainPayments(now);
    releaseBlindboxHolds(now);
    settleDueShopTerms(now);
  } catch (e) {
    console.error('[market] tick 失败:', e);
  }
}
tickMarket();
setInterval(tickMarket, 30 * 1000);
