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

// 判断是否为手机窄屏（横屏手机也归入此断点）
function useIsMobile(query = '(max-width: 820px)') {
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

// 游戏 HUD 外壳：全屏地图常驻，四周悬浮面板，页面以覆盖式玻璃面板承载
export default function Layout({ children }) {
  const { user } = useUser();
  const navigate = useNavigate();

  // 手机适配：窄屏走 MobileHud，横屏/竖屏由小地图按钮手动切换
  const isMobile = useIsMobile();
  const [mode, setMode] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < window.innerHeight ? 'portrait' : 'landscape'
  );
  const toggleMode = () => setMode((m) => (m === 'portrait' ? 'landscape' : 'portrait'));

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

  // 平移：仅在空白处拖动（避开地点标记）
  const onPointerDown = (e) => {
    if (editing) return;
    if (e.target.closest && e.target.closest('.area-marker')) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    setPanning(true);
  };
  const onPointerMove = (e) => {
    const p = panRef.current;
    if (!p) return;
    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    if (!p.moved && Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
    if (p.moved) setView((v) => ({ ...v, x: p.ox + dx, y: p.oy + dy }));
  };
  const onPointerUp = () => {
    panRef.current = null;
    setPanning(false);
  };
  const onWheel = (e) => {
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setView((v) => ({ ...v, zoom: clamp(v.zoom * factor, 0.5, 4) }));
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
          zoom={view.zoom}
          onToggleMode={toggleMode}
          onSwitchMap={switchMap}
          onSwitchWorld={switchWorld}
          onToggleEdit={() => setEditing((v) => !v)}
          onGacha={gacha}
          onTasks={() => navigate('/tasks')}
          onBag={() => say('「背包」还未开发')}
          onSettings={() => say('「设置」还未开发')}
          onProfile={() => navigate('/profile')}
          onLeaderboard={() => navigate('/leaderboard')}
          onAchievements={() => navigate('/achievements')}
          onZoom={setZoom}
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
          />
          <GuideArrow />
          <Gacha onGacha={gacha} />
          <QuickBar
            zoom={view.zoom}
            activeCampus={activeCampus}
            onTasks={() => navigate('/tasks')}
            onBag={() => say('「背包」还未开发')}
            onSettings={() => say('「设置」还未开发')}
          />
          <ZoomControl zoom={view.zoom} onZoom={setZoom} />
        </>
      )}

      {/* 世界频道：桌面/横屏居中，竖屏贴左下角 */}
      <div className={'world-chat-wrap' + (isMobile && mode === 'portrait' ? ' portrait' : '')}>
        <WorldChat />
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
    </div>
  );
}
