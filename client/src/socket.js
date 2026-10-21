import { io } from 'socket.io-client';

// 连接同源（Vite 会把 /socket.io 代理到后端 3001）
export const socket = io({
  autoConnect: true,
});
