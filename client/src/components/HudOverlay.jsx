import { useLocation, useNavigate } from 'react-router-dom';

// 覆盖式玻璃面板：承载任务/排行榜/成就/我的等页面，浮在地图之上。
// 市场页改为全屏 Dashboard，不走居中弹窗。
export default function HudOverlay({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  const show = location.pathname !== '/';
  if (!show) return null;

  // 活动详情 / 任务详情 / co-online / profile 自带全屏覆盖层与返回按钮，原样渲染
  if (location.pathname.startsWith('/activity') || location.pathname.startsWith('/co-online') || location.pathname.startsWith('/task/') || location.pathname.startsWith('/profile')) {
    return children;
  }

  // 市场 / 设置：全屏页面外壳
  if (location.pathname === '/market' || location.pathname === '/settings' || location.pathname === '/information') {
    return (
      <div className="fullscreen-page">
        {children}
        <button className="market-close" onClick={() => navigate('/')} aria-label="返回地图">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    );
  }

  // 其余页面：居中玻璃面板
  return (
    <div className="hud-overlay">
      <div className="hud-overlay-backdrop" onClick={() => navigate('/')} />
      <div className="hud-overlay-panel">
        <i className="ov-corner tl" />
        <i className="ov-corner tr" />
        <i className="ov-corner bl" />
        <i className="ov-corner br" />
        <button className="hud-overlay-close" onClick={() => navigate('/')} aria-label="关闭">
          [ ESC ]
        </button>
        {children}
      </div>
    </div>
  );
}
