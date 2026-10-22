import { useLocation, useNavigate } from 'react-router-dom';

// 覆盖式玻璃面板：承载任务/排行榜/成就/我的等页面，浮在地图之上
export default function HudOverlay({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  // 活动详情页自己渲染全屏覆盖层，这里跳过以免被套进居中玻璃面板
  const show = location.pathname !== '/' && !location.pathname.startsWith('/activity');
  if (!show) return null;

  return (
    <div className="hud-overlay">
      <div className="hud-overlay-backdrop" onClick={() => navigate('/')} />
      <div className="hud-overlay-panel">
        <button className="hud-overlay-close" onClick={() => navigate('/')} aria-label="关闭">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
