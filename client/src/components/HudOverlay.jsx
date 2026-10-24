import { useLocation, useNavigate } from 'react-router-dom';

// 覆盖式玻璃面板：承载任务/排行榜/成就/我的等页面，浮在地图之上
export default function HudOverlay({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  const show = location.pathname !== '/';
  if (!show) return null;

  // 活动详情页 / 任务详情页 / co-online 自带全屏覆盖层与返回按钮，这里原样渲染，不套居中玻璃面板
  // 注意：任务详情是 /task/:id，必须用 '/task/'（带斜杠），避免把 /tasks（任务列表）也误判成全屏页
  if (location.pathname.startsWith('/activity') || location.pathname.startsWith('/co-online') || location.pathname.startsWith('/task/') || location.pathname.startsWith('/profile')) {
    return children;
  }

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
