import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { socket } from '../socket.js';

// HUD 悬浮面板集合：小地图/头像/卡池/引导箭头/快捷栏/缩放/顶部区域
// 定位用内联样式（absolute），视觉走 hud.css

export function TopCenter({ activeCampus, editing, onToggleEdit }) {
  return (
    <div className="absolute" style={{ top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
      <div className="hud-panel-soft" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, letterSpacing: 2, color: 'rgba(255,255,255,.85)' }}>
          当前区域 · {activeCampus?.name || '加载中…'}
        </span>
        <button className="hud-btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onToggleEdit}>
          {editing ? '✅ 完成调整' : '✏️ 调整标记'}
        </button>
      </div>
    </div>
  );
}

export function TopLeft({ campuses, campusId, onSwitchMap, onSwitchWorld }) {
  const active = campuses.find((c) => c.id === campusId);
  const slug = active?.slug || 'minglun';
  return (
    <div className="absolute" style={{ top: 16, left: 16, zIndex: 20, width: 150 }}>
      <div className="hud-panel" style={{ padding: 8 }}>
        <div className="minimap">
          <img src={`/maps/${slug}.jpg`} alt="小地图" />
          <div className="mm-ring" />
          <div className="mm-view" />
          <div className="mm-dot" />
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 6, letterSpacing: 2 }}>
          小地图
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        <button className="hud-btn" onClick={onSwitchMap}>🗺️ 换地图</button>
        <button className="hud-btn warn" onClick={onSwitchWorld}>🌍 换世界观</button>
      </div>
    </div>
  );
}

export function TopRight({ user, onProfile, onAchievements, onLeaderboard, onFriends }) {
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
    <div className="absolute" style={{ top: 16, right: 16, zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
      <div className="hud-panel" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative' }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid rgba(245,199,106,.7)', background: 'linear-gradient(135deg,#1f2937,#0b1220)', fontSize: 20,
          }}>
            {user?.avatar || '🎓'}
          </div>
          <span style={{ position: 'absolute', bottom: -2, right: -2, width: 10, height: 10, borderRadius: '50%', background: '#34d399', border: '2px solid #0b1016' }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.nickname || '未登录'}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)' }}>Lv{user?.level ?? 1} · {user?.exp ?? 0} XP</div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 4 }}>
          <button className="hud-icon-chip" title="成就" onClick={onAchievements}>👑</button>
          <button className="hud-icon-chip" title="成就" onClick={onAchievements}>🪶</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="hud-btn" onClick={onProfile}>👤 用户信息</button>
        <button className="hud-btn active" onClick={onLeaderboard}>🏆 排行榜</button>
        <button className="hud-btn friend-icon-btn" onClick={onFriends} title="co-online 好友" aria-label="好友">
          👥
          {unread > 0 && <span className="friend-unread">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </div>
    </div>
  );
}

export function Gacha({ onGacha }) {
  return (
    <div className="absolute" style={{ right: 24, top: '32%', zIndex: 30 }}>
      <div className="gacha-btn animate-floaty" onClick={onGacha}>
        <div className="gacha-sheen" />
        <div style={{ fontSize: 22 }}>✨</div>
        <span style={{ fontSize: 14, letterSpacing: 2 }}>卡池 · 召唤</span>
        <span style={{ fontSize: 10, fontWeight: 'normal', opacity: 0.75 }}>Gacha</span>
        <span className="gacha-badge">未开发</span>
      </div>
    </div>
  );
}

export function GuideArrow() {
  return (
    <svg className="guide-arrow" viewBox="0 0 1600 900" preserveAspectRatio="none" fill="none">
      <path d="M 1520 110 C 1620 200, 1650 300, 1560 430" stroke="rgba(245,199,106,.2)" strokeWidth="8" />
      <path className="dash" d="M 1520 110 C 1620 200, 1650 300, 1560 430" stroke="rgba(245,199,106,.7)" strokeWidth="2.5" strokeDasharray="7 7" />
      <text x="1630" y="250" fill="rgba(245,199,106,.85)" fontSize="14" textAnchor="end" style={{ fontFamily: 'system-ui' }}>新卡池开启 →</text>
    </svg>
  );
}

export function QuickBar({ zoom, activeCampus, onTasks, onBag, onSettings }) {
  return (
    <div className="absolute" style={{ top: 16, left: 180, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="hud-panel-soft" style={{ padding: '6px 10px', fontSize: 12, color: 'rgba(255,255,255,.6)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>📍 {activeCampus?.name || ''}</span>
        <span style={{ color: 'rgba(255,255,255,.35)' }}>缩放 {Math.round(zoom * 100)}%</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="hud-btn" onClick={onTasks}>✅ 任务</button>
        <button className="hud-btn warn" onClick={onBag}>🎒 背包</button>
        <button className="hud-btn warn" onClick={onSettings}>⚙️ 设置</button>
      </div>
    </div>
  );
}

export function ZoomControl({ zoom, onZoom }) {
  const step = (d) => onZoom(Math.min(4, Math.max(0.5, Math.round((zoom + d) * 10) / 10)));
  return (
    <div className="absolute" style={{ bottom: 16, right: 16, zIndex: 20 }}>
      <div className="hud-panel" style={{ padding: '10px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <button className="hud-btn" style={{ padding: '6px 8px' }} onClick={() => step(0.2)}>＋</button>
        <input
          type="range" min="0.5" max="4" step="0.1" value={zoom}
          onChange={(e) => onZoom(parseFloat(e.target.value))}
          className="zoom-slider" style={{ margin: '4px 0' }}
        />
        <button className="hud-btn" style={{ padding: '6px 8px' }} onClick={() => step(-0.2)}>－</button>
        <span style={{ fontSize: 11, color: '#7dd3fc', fontFamily: 'monospace' }}>{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
}
