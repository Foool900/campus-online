import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const LS_ENABLED = 'bgm_enabled';
const LS_TRACK = 'bgm_track';

// 可选背景音乐曲目：把 mp3 放到 client/public/sounds/ 下，在此登记即可新增曲目
export const BGM_TRACKS = [
  { id: 'calm-ambient', title: 'Calm & Ambient · PERTENENCIA Y RENUNCIA', src: '/sounds/bgm-calm-ambient.mp3' },
];

const BackgroundMusicContext = createContext({
  enabled: false,
  track: BGM_TRACKS[0].id,
  tracks: BGM_TRACKS,
  setEnabled: () => {},
  setTrack: () => {},
});

export function BackgroundMusicProvider({ children }) {
  const [enabled, setEnabledState] = useState(() => {
    try {
      return localStorage.getItem(LS_ENABLED) !== '0';
    } catch {
      return true;
    }
  });
  const [track, setTrackState] = useState(() => {
    try {
      return localStorage.getItem(LS_TRACK) || BGM_TRACKS[0].id;
    } catch {
      return BGM_TRACKS[0].id;
    }
  });
  const audioRef = useRef(null);

  const setEnabled = useCallback((v) => {
    setEnabledState(v);
    try {
      localStorage.setItem(LS_ENABLED, v ? '1' : '0');
    } catch {
      /* 忽略 */
    }
  }, []);

  const setTrack = useCallback((id) => {
    setTrackState(id);
    try {
      localStorage.setItem(LS_TRACK, id);
    } catch {
      /* 忽略 */
    }
  }, []);

  // 同步曲目与开关到 audio 元素
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const tr = BGM_TRACKS.find((t) => t.id === track) || BGM_TRACKS[0];
    audio.src = tr.src;
    audio.loop = true;
    audio.volume = 0.5;
    if (enabled) {
      audio.play().catch(() => {
        /* 自动播放被拦截，等首次交互再重试 */
      });
    } else {
      audio.pause();
    }
  }, [enabled, track]);

  // 自动播放兜底：被浏览器拦截时，用户首次点击 / 按键后重试播放
  useEffect(() => {
    if (!enabled) return;
    const tryPlay = () => audioRef.current?.play().catch(() => {});
    window.addEventListener('pointerdown', tryPlay, { once: true });
    window.addEventListener('keydown', tryPlay, { once: true });
    return () => {
      window.removeEventListener('pointerdown', tryPlay);
      window.removeEventListener('keydown', tryPlay);
    };
  }, [enabled]);

  const value = { enabled, track, tracks: BGM_TRACKS, setEnabled, setTrack };

  return (
    <BackgroundMusicContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="auto" />
    </BackgroundMusicContext.Provider>
  );
}

// 任意组件里调用：const bgm = useBackgroundMusic();
export function useBackgroundMusic() {
  return useContext(BackgroundMusicContext);
}

export default BackgroundMusicProvider;
