import { useLocation, useNavigate } from 'react-router-dom';

// 覆盖式玻璃面板：承载任务/排行榜/成就/我的等页面，浮在地图之上
export default function HudOverlay({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  const show = location.pathname !== '/';
  if (!show) return null;

  // 活动详情页自带全屏覆盖层与返回按钮，这里原样渲染，不套居中玻璃面板
  if (location.pathname.startsWith('/activity')) {
    return children;
  }

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
