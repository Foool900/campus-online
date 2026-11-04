import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
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

// 安全区兜底：Android 边到边时，无刘海机型的 env(safe-area-inset-top) 会返回 0，
// 但状态栏仍压在顶部。这里用 visualViewport.offsetTop 估算状态栏高度补进 --statusbar-h。
function syncSafeArea() {
  const vv = window.visualViewport;
  const h = vv && vv.offsetTop ? vv.offsetTop : 0;
  document.documentElement.style.setProperty('--statusbar-h', `${h}px`);
}
syncSafeArea();
window.visualViewport && window.visualViewport.addEventListener('resize', syncSafeArea);
window.addEventListener('orientationchange', syncSafeArea);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
