// 手机端 HUD：横屏 / 竖屏两套布局，通过小地图右下角的按钮手动切换
// 定位全部走 hud.css 的 class（不写内联样式，便于两套布局共用一套 DOM），
// 视觉复用 .hud-btn / .hud-panel / .minimap 等已有样式。

function Minimap({ slug, mode, onToggleMode }) {
  const label = mode === 'portrait' ? '切换横屏' : '切换竖屏';
  return (
    <div className="m-minimap">
      <div className="minimap">
        <img src={`/maps/${slug}.jpg`} alt="小地图" />
        <div className="mm-ring" />
        <div className="mm-view" />
        <div className="mm-dot" />
      </div>
      <button type="button" className="m-mode-toggle" onClick={onToggleMode} title={label} aria-label={label}>
        🔁
      </button>
    </div>
  );
}

function MapButtons({ onSwitchMap, onSwitchWorld }) {
  return (
    <div className="m-mapbtns">
      <button type="button" className="hud-btn m-round" onClick={onSwitchMap} title="换地图">
        🗺️
      </button>
      <button type="button" className="hud-btn warn m-round" onClick={onSwitchWorld} title="换世界观">
        🌍
      </button>
    </div>
  );
}

function CampusPill({ activeCampus, editing, onToggleEdit }) {
  return (
    <div className="m-campus">
      <div className="hud-panel-soft m-campus-pill">
        <span className="m-campus-name">📍 {activeCampus?.name || '加载中…'}</span>
        <button type="button" className="hud-btn m-edit" onClick={onToggleEdit} title={editing ? '完成调整' : '调整标记'}>
          {editing ? '✅' : '✏️'}
        </button>
      </div>
    </div>
  );
}

function UserPanel({ user, onProfile, onAchievements, onLeaderboard }) {
  return (
    <div className="m-user">
      <div className="hud-panel m-user-card">
        <div className="m-avatar">{user?.avatar || '🎓'}</div>
        <div className="m-user-info">
          <div className="m-nick">{user?.nickname || '未登录'}</div>
          <div className="m-level">Lv{user?.level ?? 1} · {user?.exp ?? 0} XP</div>
        </div>
        <div className="m-chips">
          <button type="button" className="hud-icon-chip" title="成就" onClick={onAchievements}>👑</button>
          <button type="button" className="hud-icon-chip" title="成就" onClick={onAchievements}>🪶</button>
        </div>
      </div>
      <div className="m-user-btns">
        <button type="button" className="hud-btn" onClick={onProfile}>👤 用户信息</button>
        <button type="button" className="hud-btn active" onClick={onLeaderboard}>🏆 排行榜</button>
      </div>
    </div>
  );
}

function QuickButtons({ onTasks, onBag, onSettings }) {
  return (
    <div className="m-quick">
      <button type="button" className="hud-btn" onClick={onTasks}>✅ 任务</button>
      <button type="button" className="hud-btn warn" onClick={onBag}>🎒 背包</button>
      <button type="button" className="hud-btn warn" onClick={onSettings}>⚙️ 设置</button>
    </div>
  );
}

function Zoom({ zoom, onZoom }) {
  const step = (d) => onZoom(Math.min(4, Math.max(0.5, Math.round((zoom + d) * 10) / 10)));
  return (
    <div className="m-zoom">
      <button type="button" className="hud-btn" onClick={() => step(0.2)}>＋</button>
      <span className="m-zoom-val">{Math.round(zoom * 100)}%</span>
      <button type="button" className="hud-btn" onClick={() => step(-0.2)}>－</button>
    </div>
  );
}

export default function MobileHud({
  mode,
  activeCampus,
  user,
  editing,
  zoom,
  onToggleMode,
  onSwitchMap,
  onSwitchWorld,
  onToggleEdit,
  onGacha,
  onTasks,
  onBag,
  onSettings,
  onProfile,
  onLeaderboard,
  onAchievements,
  onZoom,
}) {
  const slug = activeCampus?.slug || 'minglun';

  return (
    <div className={'mobile-hud ' + mode}>
      <Minimap slug={slug} mode={mode} onToggleMode={onToggleMode} />
      <MapButtons onSwitchMap={onSwitchMap} onSwitchWorld={onSwitchWorld} />
      <CampusPill activeCampus={activeCampus} editing={editing} onToggleEdit={onToggleEdit} />
      <UserPanel user={user} onProfile={onProfile} onAchievements={onAchievements} onLeaderboard={onLeaderboard} />
      <QuickButtons onTasks={onTasks} onBag={onBag} onSettings={onSettings} />
      <Zoom zoom={zoom} onZoom={onZoom} />
      <button type="button" className="gacha-btn m-gacha-btn" onClick={onGacha} title="卡池 · 召唤">
        <span>✨</span>
      </button>
    </div>
  );
}
