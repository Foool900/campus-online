import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { api } from './api.js';
import { socket } from './socket.js';
import { UserContext } from './UserContext.jsx';
import Layout from './components/Layout.jsx';
import { AchievementToastProvider } from './components/AchievementToast.jsx';
import { BackgroundMusicProvider } from './components/BackgroundMusic.jsx';
import LoginModal from './components/LoginModal.jsx';
import TasksPage from './pages/TasksPage.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import ActivityDetailPage from './pages/ActivityDetailPage.jsx';
import TaskDetailPage from './pages/TaskDetailPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import CoOnlinePage from './pages/CoOnlinePage.jsx';
import SignInPage from './pages/SignInPage.jsx';
import MarketPage from './pages/MarketPage.jsx';
import LotteryPage from './pages/LotteryPage.jsx';

const TOKEN_KEY = 'campus_token';

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() =>
    typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
  );
  const [authReady, setAuthReady] = useState(false);

  // 登录态恢复：有 token 就拉取当前用户；否则视为未登录
  useEffect(() => {
    if (!token) {
      setUser(null);
      setAuthReady(true);
      return;
    }
    api
      .authMe()
      .then(setUser)
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setAuthReady(true));
  }, [token]);

  // 登录态变化时连接 / 断开 Socket（握手带 token 鉴权）
  useEffect(() => {
    if (token) socket.connect();
    else socket.disconnect();
  }, [token]);

  const applyAuth = useCallback((t, u) => {
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    api.authLogout().catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, setUser, token, applyAuth, logout }),
    [user, token, applyAuth, logout]
  );

  return (
    <BrowserRouter>
      <AchievementToastProvider>
      <BackgroundMusicProvider>
      <UserContext.Provider value={value}>
        <Layout key={token || 'anon'}>
          <Routes>
            <Route path="/" element={null} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/market" element={<MarketPage />} />
            <Route path="/lottery" element={<LotteryPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/activity/:id" element={<ActivityDetailPage />} />
            <Route path="/task/:id" element={<TaskDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/co-online" element={<CoOnlinePage />} />
            <Route path="*" element={null} />
          </Routes>
        </Layout>
        {authReady && !token && <LoginModal onAuth={applyAuth} />}
      </UserContext.Provider>
      </BackgroundMusicProvider>
      </AchievementToastProvider>
    </BrowserRouter>
  );
}
