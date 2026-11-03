// API / WebSocket 基地址：浏览器部署走同源（空串），打包 APK 时用 .env.apk 覆盖为公网地址。
// 例：VITE_API_BASE=http://218.244.151.114  VITE_WS_URL=http://218.244.151.114
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
export const WS_URL = import.meta.env.VITE_WS_URL || undefined; // undefined → 同源
