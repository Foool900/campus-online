import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Map as MapIcon,
  MessageCircle,
  ListTodo,
  Store,
  User,
  RefreshCw,
  Globe,
  CalendarCheck,
  Sparkles,
} from 'lucide-react';
import { useUser } from '../UserContext.jsx';
import MapEngine from './MapEngine.jsx';
import AreaDialog from './AreaDialog.jsx';
import WorldChat from './WorldChat.jsx';
import HudOverlay from './HudOverlay.jsx';

// 手机端 App 壳：底部 Tab 导航 + 全屏页面。地图降级为「首页」Tab，
// 世界频道挂在首页底部。非首页内容复用 HudOverlay 的玻璃面板逻辑。
// 图标统一用 Lucide 线性图标（不用 emoji）。

const TABS = [
  { key: 'home', path: '/', label: '首页', Icon: MapIcon },
  { key: 'messages', path: '/co-online', label: '消息', Icon: MessageCircle },
  { key: 'tasks', path: '/tasks', label: '任务', Icon: ListTodo },
  { key: 'market', path: '/market', label: '市场', Icon: Store },
  { key: 'profile', path: '/profile', label: '我的', Icon: User },
];

// 精确匹配 Tab 路由（详情页如 /task/:id、/story/:id 不属于任何 Tab）
const TAB_BY_PATH = { '/': 'home', '/co-online': 'messages', '/tasks': 'tasks', '/market': 'market', '/profile': 'profile' };

const DETAIL_TITLES = {
  '/signin': '签到',
  '/settings': '设置',
  '/bag': '背包',
  '/character': '形象',
  '/lottery': '卡池 · 召唤',
  '/information': '信息大厅',
  '/leaderboard': '排行榜',
  '/bot': 'Ala',
};

function pageTitle(pathname) {
  if (DETAIL_TITLES[pathname]) return DETAIL_TITLES[pathname];
  if (pathname.startsWith('/task/')) return '任务详情';
  if (pathname.startsWith('/activity/')) return '活动详情';
  if (pathname.startsWith('/story/')) return '剧情';
  if (pathname.startsWith('/story')) return '剧情';
  return 'Campus Online';
}

// 首页：地图引擎 + 极简地图控件 + 可折叠世界频道
function HomeMap({ map, onSwitchMap, onSwitchWorld, onGacha, chatOpen, setChatOpen }) {
  const navigate = useNavigate();
  return (
    <div className="m-home">
      <MapEngine
        key={map.campusId}
        areas={map.areas}
        selectedAreaId={map.selectedArea?.id}
        onSelectArea={map.setSelectedArea}
      />
      <div className="map-vignette" />

      <div className="m-mapbar">
        <span className="m-mapbar-name">📍 {map.activeCampus?.name || '加载中…'}</span>
        <button type="button" className="hud-btn m-mapbar-btn" onClick={onSwitchMap} title="换地图" aria-label="换地图">
          <RefreshCw size={20} />
        </button>
        <button type="button" className="hud-btn warn m-mapbar-btn" onClick={onSwitchWorld} title="换世界观" aria-label="换世界观">
          <Globe size={20} />
        </button>
        <button type="button" className="hud-btn m-mapbar-btn" onClick={() => navigate('/signin')} title="签到" aria-label="签到">
          <CalendarCheck size={20} />
        </button>
        <button type="button" className="hud-btn m-mapbar-btn" onClick={onGacha} title="卡池" aria-label="卡池">
          <Sparkles size={20} />
        </button>
      </div>

      <div className="m-worldchat">
        <button type="button" className="m-worldchat-toggle" onClick={() => setChatOpen((v) => !v)}>
          <MessageCircle size={16} /> 世界频道 {chatOpen ? '▾' : '▴'}
        </button>
        {chatOpen && <WorldChat />}
      </div>

      {map.selectedArea && <AreaDialog area={map.selectedArea} onClose={() => map.setSelectedArea(null)} />}
    </div>
  );
}

export default function MobileAppShell({ map, onSwitchMap, onSwitchWorld, onGacha, children }) {
  const { user } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [chatOpen, setChatOpen] = useState(false);

  const pathname = location.pathname;
  const tabKey = TAB_BY_PATH[pathname] || null;
  const isHome = tabKey === 'home';
  const title = tabKey ? TABS.find((t) => t.key === tabKey).label : pageTitle(pathname);

  const go = (path) => {
    if (pathname !== path) navigate(path);
  };

  return (
    <div className="m-app">
      {!isHome && (
        <header className="m-topbar">
          {tabKey ? (
            <span className="m-topbar-title">{title}</span>
          ) : (
            <>
              <button type="button" className="m-topbar-back" onClick={() => navigate(-1)} aria-label="返回">‹</button>
              <span className="m-topbar-title">{title}</span>
            </>
          )}
          <span className="m-topbar-spacer" />
          {user && <span className="m-topbar-user">Lv{user.level ?? 1} · {user.nickname}</span>}
        </header>
      )}

      <main className="m-page">
        {isHome ? (
          <HomeMap
            map={map}
            onSwitchMap={onSwitchMap}
            onSwitchWorld={onSwitchWorld}
            onGacha={onGacha}
            chatOpen={chatOpen}
            setChatOpen={setChatOpen}
          />
        ) : (
          <HudOverlay>{children}</HudOverlay>
        )}
      </main>

      {tabKey && (
        <nav className="m-tabbar">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={'m-tab' + (tabKey === t.key ? ' active' : '')}
              onClick={() => go(t.path)}
            >
              <span className="m-tab-icon"><t.Icon size={22} strokeWidth={2} /></span>
              <span className="m-tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
