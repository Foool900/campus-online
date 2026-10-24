import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { socket } from '../socket.js';
import { useUser } from '../UserContext.jsx';
import { useAchievementToast } from './AchievementToast.jsx';
import MapEngine from './MapEngine.jsx';
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
} from './HudPanels.jsx';

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

// 游戏 HUD 外壳：全屏地图引擎常驻，四周悬浮面板，页面以覆盖式玻璃面板承载
export default function Layout({ children }) {
  const { user } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

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
  const [editing, setEditing] = useState(false); // 编辑标记（拖拽节点在后续阶段接入）
  const [error, setError] = useState('');

  // Toast
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const say = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  // 成就解锁 Toast（socket 推送 → 全局 AchievementToast）
  const showAchievement = useAchievementToast();
  useEffect(() => {
    socket.on('achievement:unlocked', showAchievement);
    return () => socket.off('achievement:unlocked', showAchievement);
  }, [showAchievement]);

  // EXP_015 摸鱼先锋：60 分钟无交互（每天最多触发一次）
  useEffect(() => {
    if (!user) return;
    const IDLE_MS = 60 * 60 * 1000;
    let timer = null;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const today = new Date().toDateString();
        if (localStorage.getItem('ach_idle_last') === today) return;
        localStorage.setItem('ach_idle_last', today);
        api.triggerAchievement('EXP_015').catch(() => {});
      }, IDLE_MS);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [user?.id]);

  // 记录界面打开次数（供 page_opens 进度型成就统计，地图首页不计）
  useEffect(() => {
    if (!user) return;
    const page = location.pathname;
    if (!page || page === '/') return;
    api.trackPageOpen(page).catch(() => {});
  }, [location.pathname, user?.id]);

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
    api
      .areas(campusId)
      .then(setAreas)
      .catch((e) => setError(e.message));
  }, [campusId]);

  const activeCampus = campuses.find((c) => c.id === campusId);

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
  const gacha = () => navigate('/lottery');

  return (
    <div className="hud-root">
      {/* 全屏地图引擎：三层视差 + 惯性缩放平移 + 以鼠标为锚点 */}
      <MapEngine
        key={campusId}
        areas={areas}
        selectedAreaId={selectedArea?.id}
        onSelectArea={setSelectedArea}
      />
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
          onAchievements={() => navigate('/profile?tab=achievements')}
        />
      ) : (
        <>
          <TopCenter activeCampus={activeCampus} editing={editing} onToggleEdit={() => setEditing((v) => !v)} />
          <TopLeft campuses={campuses} campusId={campusId} onSwitchMap={switchMap} onSwitchWorld={switchWorld} />
          <TopRight
            user={user}
            onProfile={() => navigate('/profile')}
            onAchievements={() => navigate('/profile?tab=achievements')}
            onLeaderboard={() => navigate('/leaderboard')}
            onFriends={() => navigate('/co-online')}
          />
          <GuideArrow />
          <Gacha onGacha={gacha} />
          <QuickBar
            activeCampus={activeCampus}
            onTasks={() => navigate('/tasks')}
            onSignin={() => navigate('/signin')}
            onMarket={() => navigate('/market')}
            onBag={() => say('「背包」还未开发')}
            onSettings={() => navigate('/settings')}
          />
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
