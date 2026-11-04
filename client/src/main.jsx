import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import './theme.css';
import './styles.css';
import './hud.css';
import './market.css';
import './information.css';
import './backpack.css';
import './character.css';
import './story.css';
import './gacha.css';
import './bot.css';
import './daylight.css';
import './app.css';

// 安全区：Android 边到边时 env(safe-area-inset-top) 在无刘海机型返回 0，
// 用原生 StatusBar 插件拿准确状态栏高度，补进 --statusbar-h 供顶部导航做 padding。
async function syncSafeArea() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const info = await StatusBar.getInfo();
    if (info && info.height) {
      document.documentElement.style.setProperty('--statusbar-h', `${info.height}px`);
    }
  } catch {
    /* 拿不到就退回 env() */
  }
}
syncSafeArea();
window.addEventListener('orientationchange', () => syncSafeArea());

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
