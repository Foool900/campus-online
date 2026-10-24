import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const AchievementToastContext = createContext(() => {});

// 判断图标是否为图片 URL（否则按 emoji 文本渲染）
function isImageIcon(icon) {
  return typeof icon === 'string' && /^(https?:\/\/|\/uploads\/|data:)/.test(icon);
}

// 单个 Toast：挂载时播音效 + 进场 → 停留 → 离场
function Toast({ achievement, onDone }) {
  const [exiting, setExiting] = useState(false);
  const icon = achievement?.icon || '🏆';
  const name = achievement?.name || '成就解锁';
  const description = achievement?.description || '';
  const isImg = isImageIcon(icon);

  // 音效：挂载时播放一次；浏览器拦截自动播放 / 文件缺失时静默忽略。
  // 音频文件请放在 client/public/sounds/achievement.mp3
  useEffect(() => {
    let audio = null;
    try {
      audio = new Audio('/sounds/achievement.mp3');
      audio.play().catch(() => {});
    } catch {
      /* 忽略 */
    }
    return () => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, []);

  // 时序：停留 3.2s 后进入离场动画，0.4s 动画结束后通知父级移除
  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), 3200);
    const doneTimer = setTimeout(onDone, 3600);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div className={'achievement-toast' + (exiting ? ' exiting' : '')}>
      <div className="achievement-toast-icon">
        {isImg ? <img src={icon} alt="" /> : icon}
      </div>
      <div className="achievement-toast-body">
        <div className="achievement-toast-label">🏆 成就解锁</div>
        <div className="achievement-toast-name">{name}</div>
        {description && <div className="achievement-toast-desc">{description}</div>}
      </div>
      <div className="achievement-toast-sheen" />
    </div>
  );
}

// 全局 Provider：持有当前 Toast，暴露 showAchievement 给任意子组件
export function AchievementToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { data, key }
  const idRef = useRef(0);

  const showAchievement = useCallback((data) => {
    idRef.current += 1;
    setToast({ data, key: idRef.current });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  return (
    <AchievementToastContext.Provider value={showAchievement}>
      {children}
      {toast && <Toast key={toast.key} achievement={toast.data} onDone={dismiss} />}
    </AchievementToastContext.Provider>
  );
}

// 任意组件里调用：showAchievement({ name, icon, description })
export function useAchievementToast() {
  return useContext(AchievementToastContext);
}

export default AchievementToastProvider;
