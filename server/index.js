import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { initDb } from './db.js';
import { seedIfEmpty } from './seed.js';
import areasRouter from './routes/areas.js';
import channelsRouter from './routes/channels.js';
import messagesRouter, { insertMessage } from './routes/messages.js';
import todosRouter from './routes/todos.js';
import usersRouter from './routes/users.js';
import campusesRouter from './routes/campuses.js';
import postsRouter from './routes/posts.js';
import achievementsRouter from './routes/achievements.js';

// 初始化数据库表结构与种子数据（仅在空库时写入）
initDb();
const seeded = seedIfEmpty();
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

// 未匹配的 /api 路由
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

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
