import { NavLink } from 'react-router-dom';
import { useUser } from '../UserContext.jsx';

const TABS = [
  { to: '/', label: '🗺️ 地图', end: true },
  { to: '/tasks', label: '✅ 任务' },
  { to: '/leaderboard', label: '🏆 排行榜' },
  { to: '/achievements', label: '🎖️ 成就' },
  { to: '/profile', label: '👤 我的' },
];

export default function Layout({ children }) {
  const { user } = useUser();

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">🎓 Campus Online</div>
        <nav className="nav">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="nav-user">
          {user ? `${user.avatar || '🎓'} ${user.nickname} · Lv${user.level}` : '未登录'}
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
