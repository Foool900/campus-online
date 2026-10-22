import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import HeDaMap from './HeDaMap.jsx';
import AreaDialog from './AreaDialog.jsx';
import HudOverlay from './HudOverlay.jsx';
import WorldChat from './WorldChat.jsx';
import MobileHud from './MobileHud.jsx';
import {
  TopCenter,
  TopLeft,
  TopRight,
  Gacha,
  GuideArrow,
  QuickBar,
  ZoomControl,
} from './HudPanels.jsx';

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

// 判断是否为手机窄屏（覆盖横屏手机：主流手机横屏宽度 ≤ 932px）
function useIsMobile(query = '(max-width: 932px)') {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    setMatches(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// 物理方向：竖屏（宽 < 高）用于「请旋转」遮罩与横屏 HUD 启停
function useIsPortrait() {
  const [portrait, setPortrait] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < window.innerHeight : false
  );
  useEffect(() => {
    const onResize = () => setPortrait(window.innerWidth < window.innerHeight);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return portrait;
}

// 尝试锁定横屏（不支持 / 无权限时静默失败；物理旋转仍由系统控制）
function tryLockLandscape() {
  try {
    if (typeof screen === 'undefined' || !screen.orientation) return;
    const lock = screen.orientation.lock;
    if (typeof lock !== 'function') return;
    const r = lock.call(screen.orientation, 'landscape');
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch {
    /* 静默失败 */
  }
}

// 游戏 HUD 外壳：全屏地图常驻，四周悬浮面板，页面以覆盖式玻璃面板承载
export default function Layout({ children }) {
  const { user } = useUser();
  const navigate = useNavigate();

  // 手机适配：默认横屏 HUD；横 / 竖屏布局由小地图按钮手动切换（不改变物理旋转）
  const isMobile = useIsMobile();
  const isPhysicalPortrait = useIsPortrait();
  const [mode, setMode] = useState('landscape');
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const toggleMode = () => {
    const next = mode === 'portrait' ? 'landscape' : 'portrait';
    setMode(next);
    if (next === 'landscape') tryLockLandscape();
  };
  const enterPortrait = () => setMode('portrait');

  // 竖屏遮罩：横屏模式下手机仍竖屏时，提示旋转（切到竖屏布局或旋转后消失）
  const showMask = isMobile && mode === 'landscape' && isPhysicalPortrait;

  // 进入手机端时尝试锁定横屏（无用户手势时可能失败，静默）
  useEffect(() => {
    if (isMobile) tryLockLandscape();
  }, [isMobile]);

  // 地图数据
  const [campuses, setCampuses] = useState([]);
  const [campusId, setCampusId] = useState(null);
  const [areas, setAreas] = useState([]);
  const [selectedArea, setSelectedArea] = useState(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  // 地图视图（缩放 + 平移）
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panRef = useRef(null);

  // Toast
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const say = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => {
    api
      .campuses()
      .then((cs) => {
        setCampuses(cs);
        if (cs.length) setCampusId(cs[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!campusId) return;
    setAreas([]);
    setSelectedArea(null);
    setView({ zoom: 1, x: 0, y: 0 });
    api
      .areas(campusId)
      .then(setAreas)
      .catch((e) => setError(e.message));
  }, [campusId]);

  const activeCampus = campuses.find((c) => c.id === campusId);

  const moveArea = async (areaId, x, y) => {
    setAreas((prev) => prev.map((a) => (a.id === areaId ? { ...a, x, y } : a)));
    try {
      await api.moveArea(areaId, { x, y });
    } catch (e) {
      setError(e.message);
    }
  };

  // 平移（鼠标拖拽）：仅在空白处拖动（避开地点标记）；触摸交给下方 touch 手势处理
  const onPointerDown = (e) => {
    if (e.pointerType === 'touch') return;
    if (editing) return;
    if (e.target.closest && e.target.closest('.area-marker')) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    setPanning(true);
  };
  const onPointerMove = (e) => {
    if (e.pointerType === 'touch') return;
    const p = panRef.current;
    if (!p) return;
    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    if (!p.moved && Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
    if (p.moved) setView((v) => ({ ...v, x: p.ox + dx, y: p.oy + dy }));
  };
  const onPointerUp = (e) => {
    if (e.pointerType === 'touch') return;
    panRef.current = null;
    setPanning(false);
  };
  const onWheel = (e) => {
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setView((v) => ({ ...v, zoom: clamp(v.zoom * factor, 0.5, 4) }));
  };

  // 触摸手势：单指平移、双指捏合缩放（替代移动端缩放按钮）
  const touchRef = useRef(null);
  const onTouchStart = (e) => {
    if (editing) return;
    if (e.target.closest && e.target.closest('.area-marker')) return;
    const t = e.touches;
    if (t.length === 1) {
      touchRef.current = { mode: 'pan', sx: t[0].clientX, sy: t[0].clientY, ox: view.x, oy: view.y, moved: false };
      setPanning(true);
    } else if (t.length === 2) {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      touchRef.current = { mode: 'pinch', dist: Math.hypot(dx, dy), zoom: view.zoom };
      setPanning(false);
    }
  };
  const onTouchMove = (e) => {
    const s = touchRef.current;
    if (!s) return;
    const t = e.touches;
    if (s.mode === 'pan' && t.length === 1) {
      const dx = t[0].clientX - s.sx;
      const dy = t[0].clientY - s.sy;
      if (!s.moved && Math.abs(dx) + Math.abs(dy) > 3) s.moved = true;
      if (s.moved) setView((v) => ({ ...v, x: s.ox + dx, y: s.oy + dy }));
    } else if (s.mode === 'pinch' && t.length === 2) {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (s.dist > 0) setView((v) => ({ ...v, zoom: clamp(s.zoom * (dist / s.dist), 0.5, 4) }));
    }
  };
  const onTouchEnd = (e) => {
    const s = touchRef.current;
    const t = e.touches;
    if (t.length === 0) {
      touchRef.current = null;
      setPanning(false);
    } else if (s && s.mode === 'pinch' && t.length === 1) {
      // 捏合抬起到单指，接着平移
      touchRef.current = { mode: 'pan', sx: t[0].clientX, sy: t[0].clientY, ox: view.x, oy: view.y, moved: false };
      setPanning(true);
    }
  };

  // HUD 动作
  const switchMap = () => {
    if (campuses.length < 2) {
      say('只有一个校区');
      return;
    }
    const idx = campuses.findIndex((c) => c.id === campusId);
    const next = campuses[(idx + 1) % campuses.length];
    setCampusId(next.id);
    say(`已切换地图：${next.name}`);
  };
  const switchWorld = () => say('「换世界观」还未开发');
  const gacha = () => {
    const prizes = ['SSR 星辉剑姬', 'SR 霜语者', 'SSR 龙裔·烬', 'R 见习法师', 'SR 观星术士'];
    say(`✨ ${prizes[Math.floor(Math.random() * prizes.length)]} 加入队伍！（卡池功能未开发）`);
  };
  const setZoom = (z) => setView((v) => ({ ...v, zoom: clamp(z, 0.5, 4) }));

  return (
    <div className="hud-root">
      {/* 全屏大地图（可平移缩放） */}
      <div
        className={'map-viewport' + (panning ? ' panning' : '')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div
          className="map-transform"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          <HeDaMap
            campus={activeCampus}
            areas={areas}
            onSelectArea={setSelectedArea}
            selectedAreaId={selectedArea?.id}
            editable={editing}
            onMove={moveArea}
          />
        </div>
      </div>
      <div className="map-vignette" />

      {/* HUD 悬浮面板 */}
      {isMobile ? (
        <MobileHud
          mode={mode}
          activeCampus={activeCampus}
          user={user}
          editing={editing}
          onToggleMode={toggleMode}
          onSwitchMap={switchMap}
          onSwitchWorld={switchWorld}
          onToggleEdit={() => setEditing((v) => !v)}
          onGacha={gacha}
          onTasks={() => navigate('/tasks')}
          onBag={() => say('「背包」还未开发')}
          onSettings={() => navigate('/settings')}
          onProfile={() => navigate('/profile')}
          onLeaderboard={() => navigate('/leaderboard')}
          onAchievements={() => navigate('/achievements')}
        />
      ) : (
        <>
          <TopCenter activeCampus={activeCampus} editing={editing} onToggleEdit={() => setEditing((v) => !v)} />
          <TopLeft campuses={campuses} campusId={campusId} onSwitchMap={switchMap} onSwitchWorld={switchWorld} />
          <TopRight
            user={user}
            onProfile={() => navigate('/profile')}
            onAchievements={() => navigate('/achievements')}
            onLeaderboard={() => navigate('/leaderboard')}
            onFriends={() => navigate('/co-online')}
          />
          <GuideArrow />
          <Gacha onGacha={gacha} />
          <QuickBar
            zoom={view.zoom}
            activeCampus={activeCampus}
            onTasks={() => navigate('/tasks')}
            onBag={() => say('「背包」还未开发')}
            onSettings={() => navigate('/settings')}
          />
          <ZoomControl zoom={view.zoom} onZoom={setZoom} />
        </>
      )}

      {/* 世界频道：桌面居中、竖屏左下角、横屏左下角可折叠 */}
      <div
        className={
          'world-chat-wrap' +
          (isMobile && mode === 'portrait' ? ' portrait' : '') +
          (isMobile && mode === 'landscape' ? ' landscape' : '')
        }
      >
        <WorldChat
          collapsible={isMobile && mode === 'landscape' && !isPhysicalPortrait}
          collapsed={chatCollapsed}
          onToggleCollapse={() => setChatCollapsed((v) => !v)}
        />
      </div>

      {/* 覆盖式页面（任务/排行榜/成就/我的） */}
      <HudOverlay>{children}</HudOverlay>

      {/* 区域详情（点地图标记弹出） */}
      {selectedArea && <AreaDialog area={selectedArea} onClose={() => setSelectedArea(null)} />}

      {/* Toast / 错误 */}
      {toast && <div className="toast">{toast}</div>}
      {error && (
        <div className="toast" style={{ background: 'rgba(120, 22, 22, 0.94)' }}>
          {error}
        </div>
      )}

      {/* 竖屏遮罩：横屏模式下手机仍竖屏时提示旋转（切到竖屏布局或旋转后消失） */}
      {showMask && (
        <div className="portrait-mask">
          <div className="portrait-mask-icon">📱</div>
          <div className="portrait-mask-text">请旋转至横屏以获得最佳游戏体验</div>
          <button type="button" className="hud-btn portrait-mask-btn" onClick={enterPortrait}>
            进入竖屏布局
          </button>
        </div>
      )}
    </div>
  );
}
