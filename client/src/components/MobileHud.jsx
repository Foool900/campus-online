import { useEffect, useState } from 'react';
import { api } from '../api.js';

// 手机端 HUD：横屏（手游 HUD）/ 竖屏（侧边栏布局）两套布局，
// 通过小地图右下角的按钮手动切换。定位全部走 hud.css 的 class。

function Minimap({ slug, mode, onToggleMode }) {
  const label = mode === 'portrait' ? '切换横屏' : '切换竖屏';
  return (
    <div className="m-minimap">
      <div className="minimap">
        <div className="mm-ring" />
        <div className="mm-view" />
        <div className="mm-dot" />
      </div>
      <button type="button" className="m-mode-toggle" onClick={onToggleMode} title={label} aria-label={label}>
        🔄
      </button>
    </div>
  );
}

function MapButtons({ onSwitchMap, onSwitchWorld }) {
  return (
    <div className="m-mapbtns">
      <button type="button" className="hud-btn m-round" onClick={onSwitchMap} title="换地图" aria-label="换地图">
        🗺️
      </button>
      <button type="button" className="hud-btn warn m-round" onClick={onSwitchWorld} title="换世界观" aria-label="换世界观">
        🌍
      </button>
    </div>
  );
}

// 竖屏：当前区域 + 调整标记（小地图下方）
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

// 用户排名表（迷你排行榜，取前 N 名）
function LeaderboardMini({ onOpen, limit = 5 }) {
  const [list, setList] = useState([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .leaderboard()
      .then((l) => {
        if (active) setList(l.slice(0, limit));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [limit]);

  return (
    <div className="hud-panel m-rank">
      <button type="button" className="m-rank-head" onClick={onOpen} title="查看完整排行榜">
        🏆 排行榜
      </button>
      {!loaded && <div className="m-rank-empty">加载中…</div>}
      {loaded && list.length === 0 && <div className="m-rank-empty">暂无玩家</div>}
      {list.map((p, i) => (
        <div key={p.id} className={'m-rank-row' + (i < 3 ? ` top${i + 1}` : '')}>
          <span className="m-rank-idx">{i + 1}</span>
          <span className="m-rank-name">{p.avatar || '🎓'} {p.nickname}</span>
          <span className="m-rank-exp">{p.exp}</span>
        </div>
      ))}
    </div>
  );
}

// 竖屏右侧统一侧边栏：用户学习 → 用户排名表 → 背包 → 任务设置
function Sidebar({ user, onProfile, onAchievements, onLeaderboard, onTasks, onBag, onSettings, onStory, onCharacter, onBot }) {
  return (
    <div className="m-sidebar">
      <div className="hud-panel m-user-card">
        <button type="button" className="m-user-main" onClick={onProfile} title="用户信息" aria-label="用户信息">
          <span className="m-avatar">{user?.avatar || '🎓'}</span>
          <span className="m-user-info">
            <span className="m-nick">{user?.nickname || '未登录'}</span>
            <span className="m-level">Lv{user?.level ?? 1} · {user?.exp ?? 0} XP</span>
          </span>
        </button>
        <button type="button" className="hud-icon-chip" title="成就" aria-label="成就" onClick={onAchievements}>
          👑
        </button>
      </div>

      <LeaderboardMini onOpen={onLeaderboard} />

      <button type="button" className="hud-btn warn m-side-btn" onClick={onBag} title="背包" aria-label="背包">
        🎒 背包
      </button>

      <button type="button" className="hud-btn m-side-btn" onClick={onStory} title="剧情" aria-label="剧情">
        📖 剧情
      </button>

      <button type="button" className="hud-btn m-side-btn" onClick={onCharacter} title="形象" aria-label="形象">
        🧍 形象
      </button>

      <button type="button" className="hud-btn m-side-btn" onClick={onBot} title="Ala" aria-label="Ala">
        🤖 Ala
      </button>

      <div className="m-side-row">
        <button type="button" className="hud-btn" onClick={onTasks} title="任务" aria-label="任务">
          ✅ 任务
        </button>
        <button type="button" className="hud-btn warn" onClick={onSettings} title="设置" aria-label="设置">
          ⚙️ 设置
        </button>
      </div>
    </div>
  );
}

// 横屏：顶部极窄状态栏（P0 信息：校区 + 等级/经验 + 编辑）
function StatusBar({ activeCampus, user, editing, onToggleEdit }) {
  return (
    <div className="m-statusbar">
      <div className="hud-panel-soft m-statusbar-inner">
        <span className="m-status-name">📍 {activeCampus?.name || '加载中…'}</span>
        <span className="m-status-sep">·</span>
        <span className="m-status-level">Lv{user?.level ?? 1} {user?.exp ?? 0} XP</span>
        <button type="button" className="hud-btn m-status-edit" onClick={onToggleEdit} title={editing ? '完成调整' : '调整标记'}>
          {editing ? '✅' : '✏️'}
        </button>
      </div>
    </div>
  );
}

// 横屏：右上角 用户学习 + 用户排名表（可整体折叠为一个图标）
function RightPanel({ user, onProfile, onAchievements, onLeaderboard, onGacha, collapsed, onToggleCollapse }) {
  if (collapsed) {
    return (
      <div className="m-rightpanel collapsed">
        <button type="button" className="hud-btn m-rightpanel-toggle" onClick={onToggleCollapse} title="展开用户面板" aria-label="展开用户面板">
          👤
        </button>
      </div>
    );
  }

  return (
    <div className="m-rightpanel">
      <div className="hud-panel m-user-card">
        <button type="button" className="m-user-main" onClick={onProfile} title="用户信息" aria-label="用户信息">
          <span className="m-avatar">{user?.avatar || '🎓'}</span>
          <span className="m-user-info">
            <span className="m-nick">{user?.nickname || '未登录'}</span>
            <span className="m-level">Lv{user?.level ?? 1} · {user?.exp ?? 0} XP</span>
          </span>
        </button>
        <button type="button" className="hud-icon-chip" title="成就" aria-label="成就" onClick={onAchievements}>
          👑
        </button>
      </div>

      <LeaderboardMini onOpen={onLeaderboard} limit={3} />

      <button type="button" className="hud-btn m-gacha-inline" onClick={onGacha} title="卡池 · 召唤">
        ✨ 卡池 · 召唤
      </button>

      <button type="button" className="m-rightpanel-collapse" onClick={onToggleCollapse} title="收起">
        收起 ▾
      </button>
    </div>
  );
}

// 横屏：右下角 背包 + 任务设置（两个大圆形触摸按钮）
function CornerButtons({ onTasks, onBag }) {
  return (
    <div className="m-cornerbtns">
      <button type="button" className="hud-btn warn m-corner" onClick={onBag} title="背包" aria-label="背包">
        🎒
      </button>
      <button type="button" className="hud-btn m-corner" onClick={onTasks} title="任务设置" aria-label="任务设置">
        📋
      </button>
    </div>
  );
}

export default function MobileHud({
  mode,
  activeCampus,
  user,
  editing,
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
  onStory,
  onCharacter,
  onBot,
}) {
  const slug = activeCampus?.slug || 'minglun';
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  return (
    <div className={'mobile-hud ' + mode}>
      <Minimap slug={slug} mode={mode} onToggleMode={onToggleMode} />
      <MapButtons onSwitchMap={onSwitchMap} onSwitchWorld={onSwitchWorld} />

      {/* 竖屏布局 */}
      <CampusPill activeCampus={activeCampus} editing={editing} onToggleEdit={onToggleEdit} />
      <Sidebar
        user={user}
        onProfile={onProfile}
        onAchievements={onAchievements}
        onLeaderboard={onLeaderboard}
        onTasks={onTasks}
        onBag={onBag}
        onSettings={onSettings}
        onStory={onStory}
        onCharacter={onCharacter}
        onBot={onBot}
      />
      <button type="button" className="gacha-btn m-gacha-btn" onClick={onGacha} title="卡池 · 召唤">
        <span>✨</span>
      </button>

      {/* 横屏 HUD */}
      <StatusBar activeCampus={activeCampus} user={user} editing={editing} onToggleEdit={onToggleEdit} />
      <RightPanel
        user={user}
        onProfile={onProfile}
        onAchievements={onAchievements}
        onLeaderboard={onLeaderboard}
        onGacha={onGacha}
        collapsed={panelCollapsed}
        onToggleCollapse={() => setPanelCollapsed((v) => !v)}
      />
      <CornerButtons onTasks={onTasks} onBag={onBag} />
    </div>
  );
}
