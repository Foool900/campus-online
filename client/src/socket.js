import { io } from 'socket.io-client';

// 连接同源（Vite 会把 /socket.io 代理到后端 3001）
// autoConnect 关闭：登录成功后由 App 手动 connect，握手带 token 鉴权
export const socket = io({
  autoConnect: false,
  auth: (cb) => cb({ token: localStorage.getItem('campus_token') || '' }),
});
