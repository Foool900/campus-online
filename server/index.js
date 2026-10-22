import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { initDb } from './db.js';
import { seedIfEmpty, ensureWorldChannel } from './seed.js';
import { bumpPresence, presenceList } from './presence.js';
import areasRouter from './routes/areas.js';
import channelsRouter from './routes/channels.js';
import messagesRouter, { insertMessage, insertPostMessage } from './routes/messages.js';
import todosRouter from './routes/todos.js';
import usersRouter from './routes/users.js';
import campusesRouter from './routes/campuses.js';
import postsRouter from './routes/posts.js';
import achievementsRouter from './routes/achievements.js';
import worldRouter from './routes/world.js';
import stickersRouter from './routes/stickers.js';

// 初始化数据库表结构与种子数据（仅在空库时写入）
initDb();
const seeded = seedIfEmpty();
ensureWorldChannel();
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

// 业务路由
app.use('/api', areasRouter);
app.use('/api', channelsRouter);
app.use('/api', messagesRouter);
app.use('/api', todosRouter);
app.use('/api', usersRouter);
app.use('/api', campusesRouter);
app.use('/api', postsRouter);
app.use('/api', achievementsRouter);
app.use('/api', worldRouter);
app.use('/api', stickersRouter);

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
    return res.status(413).json({ error: '文件过大（单张最多 2MB）' });
  }
  console.error('[server] 未处理错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

function broadcastPresence(postId) {
  io.to(`post:${postId}`).emit('presence:update', { postId, online: presenceList(postId) });
}

// Socket.IO：房间名 channel:{channelId} / post:{postId}
io.on('connection', (socket) => {
  socket.on('join:channel', ({ channelId }) => {
    const cid = Number(channelId);
    if (Number.isInteger(cid)) socket.join(`channel:${cid}`);
  });

  socket.on('leave:channel', ({ channelId }) => {
    const cid = Number(channelId);
    if (Number.isInteger(cid)) socket.leave(`channel:${cid}`);
  });

  // 活动讨论区房间 + 在线成员
  socket.on('join:post', ({ postId, userId }) => {
    const pid = Number(postId);
    const uid = Number(userId);
    if (!Number.isInteger(pid)) return;
    socket.join(`post:${pid}`);
    if (Number.isInteger(uid)) {
      socket.data.postId = pid;
      socket.data.userId = uid;
      bumpPresence(pid, uid, 1);
      broadcastPresence(pid);
    }
  });
  socket.on('leave:post', ({ postId, userId }) => {
    const pid = Number(postId);
    const uid = Number(userId);
    if (!Number.isInteger(pid)) return;
    socket.leave(`post:${pid}`);
    if (Number.isInteger(uid)) {
      bumpPresence(pid, uid, -1);
      broadcastPresence(pid);
    }
  });

  socket.on('disconnect', () => {
    const { postId, userId } = socket.data;
    if (Number.isInteger(postId) && Number.isInteger(userId)) {
      bumpPresence(postId, userId, -1);
      broadcastPresence(postId);
    }
  });

  socket.on('message:send', ({ channelId, postId, userId, content, type, replyTo, mentions }, ack) => {
    const pid = postId ? Number(postId) : null;
    const result = Number.isInteger(pid)
      ? insertPostMessage(pid, userId, { type, content, replyTo, mentions })
      : insertMessage(channelId, userId, content);
    if (result.error) {
      if (typeof ack === 'function') ack({ ok: false, error: result.error });
      return;
    }
    const room = Number.isInteger(pid) ? `post:${pid}` : `channel:${Number(channelId)}`;
    io.to(room).emit('message:new', {
      channelId: Number(channelId) || null,
      postId: pid,
      message: result.message,
    });
    if (typeof ack === 'function') ack({ ok: true, message: result.message });
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] Campus Online 后端已启动: http://localhost:${PORT}`);
});
