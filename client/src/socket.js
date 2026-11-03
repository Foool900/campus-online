import { io } from 'socket.io-client';
import { WS_URL } from './apiBase.js';

// 浏览器部署连接同源（WS_URL 为空）；打包 APK 时 WS_URL 指向公网后端。
// autoConnect 关闭：登录成功后由 App 手动 connect，握手带 token 鉴权
export const socket = io(WS_URL, {
  autoConnect: false,
  auth: (cb) => cb({ token: localStorage.getItem('campus_token') || '' }),
});
