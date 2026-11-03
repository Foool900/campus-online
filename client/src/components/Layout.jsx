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
import MobileAppShell from './MobileAppShell.jsx';
import useMapData from '../hooks/useMapData.js';
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

// 游戏 HUD 外壳：桌面端全屏地图引擎 + 悬浮面板 + 覆盖式页面；
// 手机端切到 MobileAppShell（底部 Tab 导航 + 全屏页面）。
export default function Layout({ children }) {
  const { user } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  const isMobile = useIsMobile();
  const map = useMapData();

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

  // HUD 动作
  const switchMap = () => {
    if (map.campuses.length < 2) {
      say('只有一个校区');
      return;
    }
    const idx = map.campuses.findIndex((c) => c.id === map.campusId);
    const next = map.campuses[(idx + 1) % map.campuses.length];
    map.setCampusId(next.id);
    say(`已切换地图：${next.name}`);
  };
  const switchWorld = () => say('「换世界观」还未开发');
  const gacha = () => navigate('/lottery');

  return (
    <div className="hud-root">
      {isMobile ? (
        <MobileAppShell map={map} onSwitchMap={switchMap} onSwitchWorld={switchWorld} onGacha={gacha}>
          {children}
        </MobileAppShell>
      ) : (
        <>
          {/* 全屏地图引擎：三层视差 + 惯性缩放平移 + 以鼠标为锚点 */}
          <MapEngine
            key={map.campusId}
            areas={map.areas}
            selectedAreaId={map.selectedArea?.id}
            onSelectArea={map.setSelectedArea}
          />
          <div className="map-vignette" />

          {/* HUD 悬浮面板 */}
          <TopCenter activeCampus={map.activeCampus} editing={map.editing} onToggleEdit={() => map.setEditing((v) => !v)} />
          <TopLeft campuses={map.campuses} campusId={map.campusId} onSwitchMap={switchMap} onSwitchWorld={switchWorld} />
          <TopRight
            user={user}
            onProfile={() => navigate('/profile')}
            onAchievements={() => navigate('/profile?tab=achievements')}
            onLeaderboard={() => navigate('/leaderboard')}
            onFriends={() => navigate('/co-online')}
            onInformationHall={() => navigate('/information')}
          />
          <GuideArrow />
          <Gacha onGacha={gacha} />
          <QuickBar
            activeCampus={map.activeCampus}
            onTasks={() => navigate('/tasks')}
            onSignin={() => navigate('/signin')}
            onMarket={() => navigate('/market')}
            onBag={() => navigate('/bag')}
            onSettings={() => navigate('/settings')}
            onStory={() => navigate('/story')}
            onCharacter={() => navigate('/character')}
            onBot={() => navigate('/bot')}
          />

          {/* 世界频道：桌面左下角 */}
          <div className="world-chat-wrap">
            <WorldChat />
          </div>

          {/* 覆盖式页面（任务/排行榜/成就/我的） */}
          <HudOverlay>{children}</HudOverlay>

          {/* 区域详情（点地图标记弹出） */}
          {map.selectedArea && <AreaDialog area={map.selectedArea} onClose={() => map.setSelectedArea(null)} />}
        </>
      )}

      {/* Toast / 错误 */}
      {toast && <div className="toast">{toast}</div>}
      {map.error && (
        <div className="toast error">
          {map.error}
        </div>
      )}
    </div>
  );
}
