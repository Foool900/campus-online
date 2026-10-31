import { createContext, useCallback, useContext, useLayoutEffect, useState } from 'react';

const LS_KEY = 'theme';

// 可选主题（与 theme.css 里的 data-theme 作用域一一对应）
export const THEMES = [
  { id: 'night', label: '夜航', icon: '🌙' },
  { id: 'daylight', label: '白昼', icon: '☀️' },
];

const ThemeContext = createContext({
  theme: 'night',
  themes: THEMES,
  setTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY) === 'daylight' ? 'daylight' : 'night';
    } catch {
      return 'night';
    }
  });

  const setTheme = useCallback((t) => {
    const next = t === 'daylight' ? 'daylight' : 'night';
    setThemeState(next);
    try {
      localStorage.setItem(LS_KEY, next);
    } catch {
      /* 忽略 */
    }
  }, []);

  // 同步到 <html data-theme>（layoutEffect 在首帧绘制前执行，避免闪错色）
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const value = { theme, themes: THEMES, setTheme };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// 任意组件里调用：const { theme, setTheme } = useTheme();
export function useTheme() {
  return useContext(ThemeContext);
}

export default ThemeProvider;
