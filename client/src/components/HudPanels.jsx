import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { socket } from '../socket.js';
import { useTheme } from '../ThemeContext.jsx';

// 夜航用 [ 名称 ] 的终端风括号，白昼显示干净名称
const bracket = (theme, text) => (theme === 'daylight' ? text : '[ ' + text + ' ]');

// 极简 SVG 线框图标（16×16，继承 currentColor）
const ICONS = {
  task: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2" />
    </>
  ),
  bag: (
    <>
      <path d="M3 6h10v8H3z" />
      <path d="M6 6V4.5a2 2 0 0 1 4 0V6" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.2v1.8M8 13v1.8M1.2 8h1.8M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3" />
    </>
  ),
  map: (
    <>
      <path d="M2 4l4-2 4 2 4-2v10l-4 2-4-2-4 2z" />
      <path d="M6 2v12M10 2v12" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="6" />
      <ellipse cx="8" cy="8" rx="2.4" ry="6" />
      <path d="M2 8h12" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="4.6" r="2.6" />
      <path d="M3 14c0-3 2-5 5-5s5 2 5 5" />
    </>
  ),
  rank: (
    <>
      <path d="M4 13V6M8 13V3M12 13V9" />
      <path d="M2 14h12" />
    </>
  ),
  friends: (
    <>
      <circle cx="5.4" cy="6" r="2" />
      <circle cx="10.6" cy="6" r="2" />
      <path d="M3.4 13.5c0-2 1-3.5 2-3.5s2 1.5 2 3.5M8.6 13.5c0-2 1-3.5 2-3.5s2 1.5 2 3.5" />
    </>
  ),
  ach: (
    <>
      <circle cx="8" cy="9" r="3" />
      <path d="M5 2l1.5 3H9.5L11 2" />
    </>
  ),
  coin: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5.5v5M5.8 6.5h4.4M5.8 9.5h4.4" />
    </>
  ),
  shop: (
    <>
      <path d="M3 7l1-3h8l1 3" />
      <path d="M3 7h10v2H3zM4 9v5h8V9" />
    </>
  ),
  hall: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2" />
      <circle cx="8" cy="8" r="2.2" />
    </>
  ),
  story: (
    <>
      <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3H8v11H4.5A1.5 1.5 0 0 1 3 12.5z" />
      <path d="M13 4.5A1.5 1.5 0 0 0 11.5 3H8v11h3.5A1.5 1.5 0 0 0 13 12.5z" />
    </>
  ),
  character: (
    <>
      <rect x="4" y="3" width="8" height="8" rx="1.2" />
      <path d="M5.5 6h2M8.5 6h2M6.5 8.5h3" />
    </>
  ),
  bot: (
    <>
      <rect x="3" y="6" width="10" height="7" rx="1.6" />
      <path d="M8 6V3M6.5 9.2h.01M9.5 9.2h.01M5 11h6" />
    </>
  ),
};

function HudIcon({ name }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {ICONS[name]}
    </svg>
  );
}

export function TopCenter({ activeCampus, editing, onToggleEdit }) {
  const { theme } = useTheme();
  return (
    <div className="absolute" style={{ top: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
      <div className="topcenter">
        <span className="tc-title">{bracket(theme, activeCampus?.name || 'LOADING…')}</span>
        <button className="hud-btn" style={{ minHeight: 30, padding: '0 10px' }} onClick={onToggleEdit}>
          {editing ? 'DONE' : 'EDIT'}
        </button>
      </div>
    </div>
  );
}

export function TopLeft({ campuses, campusId, onSwitchMap, onSwitchWorld }) {
  const { theme } = useTheme();
  const active = campuses.find((c) => c.id === campusId);
  return (
    <div className="absolute" style={{ top: 16, left: 16, zIndex: 20, width: 150 }}>
      <div className="hud-panel" style={{ padding: 8 }}>
        <div className="minimap">
          <i className="mm-corner tl" />
          <i className="mm-corner tr" />
          <i className="mm-corner bl" />
          <i className="mm-corner br" />
          <div className="mm-ring" />
          <div className="mm-view" />
          <div className="mm-dot" />
        </div>
        <div className="minimap-label">{bracket(theme, active?.name || 'MAP')}</div>
      </div>
      <div className="minimap-btns">
        <button className="hud-btn" onClick={onSwitchMap}><HudIcon name="map" />换地图</button>
        <button className="hud-btn warn" onClick={onSwitchWorld}><HudIcon name="globe" />世界观</button>
      </div>
    </div>
  );
}

export function TopRight({ user, onProfile, onAchievements, onLeaderboard, onFriends, onInformationHall }) {
  const [unread, setUnread] = useState(0);
  const location = useLocation();

  useEffect(() => {
    if (!user) return;
    api.conversationUnread().then((r) => setUnread(r.total || 0)).catch(() => {});
  }, [user?.id, location.pathname]);

  useEffect(() => {
    const onNew = (payload) => {
      if (payload && (payload.conversationType === 'direct' || payload.conversationType === 'group') && payload.message?.userId !== user?.id) {
        setUnread((n) => n + 1);
      }
    };
    socket.on('message:new', onNew);
    return () => socket.off('message:new', onNew);
  }, [user?.id]);

  return (
    <div className="absolute" style={{ top: 16, right: 16, zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      <button
        className="hud-btn"
        onClick={onInformationHall}
        style={{ alignSelf: 'flex-start', color: 'var(--accent-info)', borderColor: 'var(--accent-info-soft)' }}
      >
        <HudIcon name="hall" />Horizon
      </button>
      <div className="hud-panel tr-card">
        <div className="tr-avatar">
          <span className="tr-avatar-em">{user?.avatar || 'USR'}</span>
          <span className="tr-status" />
        </div>
        <div className="tr-info">
          <div className="tr-nick">{user?.nickname || 'UNKNOWN'}</div>
          <div className="tr-level">LV {user?.level ?? 1} · {user?.exp ?? 0} XP</div>
          <div className="tr-expbar"><i style={{ width: `${(user?.exp ?? 0) % 100}%` }} /></div>
        </div>
        <button className="hud-icon-chip" title="成就" onClick={onAchievements}><HudIcon name="ach" />成就</button>
      </div>

      <div className="tr-btns">
        <button className="hud-btn" onClick={onProfile}><HudIcon name="user" />用户</button>
        <button className="hud-btn active" onClick={onLeaderboard}><HudIcon name="rank" />排行</button>
        <button className="hud-btn friend-icon-btn" onClick={onFriends} title="co-online 好友" aria-label="好友">
          <HudIcon name="friends" />好友
          {unread > 0 && <span className="friend-unread">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </div>
    </div>
  );
}

export function Gacha({ onGacha }) {
  return (
    <div className="absolute" style={{ right: 24, top: '32%', zIndex: 30 }}>
      <div className="gacha-btn" onClick={onGacha}>
        <span className="gacha-label">GACHA</span>
        <span className="gacha-sub">LOTTERY</span>
      </div>
    </div>
  );
}

export function GuideArrow() {
  return (
    <svg className="guide-arrow" viewBox="0 0 1600 900" preserveAspectRatio="none" fill="none">
      <path d="M 1520 110 C 1620 200, 1650 300, 1560 430" stroke="rgba(139,157,245,.18)" strokeWidth="8" />
      <path className="dash" d="M 1520 110 C 1620 200, 1650 300, 1560 430" stroke="rgba(139,157,245,.6)" strokeWidth="2.5" strokeDasharray="7 7" />
      <text x="1630" y="250" fill="rgba(139,157,245,.85)" fontSize="14" textAnchor="end" style={{ fontFamily: 'Consolas, monospace' }}>NEW_GACHA →</text>
    </svg>
  );
}

export function QuickBar({ activeCampus, onTasks, onBag, onSettings, onSignin, onMarket, onStory, onCharacter, onBot }) {
  const { theme } = useTheme();
  return (
    <div className="absolute" style={{ top: 16, left: 180, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="quickbar-label">{bracket(theme, activeCampus?.name || '')}</div>
      <div className="tr-btns" style={{ display: 'flex', gap: 8 }}>
        <button className="hud-btn" onClick={onBot}><HudIcon name="bot" />Ala</button>
        <button className="hud-btn" onClick={onTasks}><HudIcon name="task" />任务</button>
        <button className="hud-btn" onClick={onStory}><HudIcon name="story" />剧情</button>
        <button className="hud-btn" onClick={onCharacter}><HudIcon name="character" />形象</button>
        <button className="hud-btn" onClick={onSignin}><HudIcon name="coin" />签到</button>
        <button className="hud-btn" onClick={onMarket}><HudIcon name="shop" />市场</button>
        <button className="hud-btn warn" onClick={onBag}><HudIcon name="bag" />背包</button>
        <button className="hud-btn warn" onClick={onSettings}><HudIcon name="gear" />设置</button>
      </div>
    </div>
  );
}
