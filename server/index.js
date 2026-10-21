import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { initDb } from './db.js';
import { seedIfEmpty, ensureWorldChannel } from './seed.js';
import areasRouter from './routes/areas.js';
import channelsRouter from './routes/channels.js';
import messagesRouter, { insertMessage } from './routes/messages.js';
import todosRouter from './routes/todos.js';
import usersRouter from './routes/users.js';
import campusesRouter from './routes/campuses.js';
import postsRouter from './routes/posts.js';
import achievementsRouter from './routes/achievements.js';
import worldRouter from './routes/world.js';

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

// 未匹配的 /api 路由
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 生产环境：托管前端构建产物（client/dist），前后端同源，一个 URL 即可访问
const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  console.error('[server] 未处理错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

// Socket.IO：房间名 channel:{channelId}
io.on('connection', (socket) => {
  socket.on('join:channel', ({ channelId }) => {
    const cid = Number(channelId);
    if (Number.isInteger(cid)) socket.join(`channel:${cid}`);
  });

  socket.on('leave:channel', ({ channelId }) => {
    const cid = Number(channelId);
    if (Number.isInteger(cid)) socket.leave(`channel:${cid}`);
  });

  socket.on('message:send', ({ channelId, userId, content }, ack) => {
    const cid = Number(channelId);
    const result = insertMessage(channelId, userId, content);
    if (result.error) {
      if (typeof ack === 'function') ack({ ok: false, error: result.error });
      return;
    }
    io.to(`channel:${cid}`).emit('message:new', { channelId: cid, message: result.message });
    if (typeof ack === 'function') ack({ ok: true, message: result.message });
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] Campus Online 后端已启动: http://localhost:${PORT}`);
});
