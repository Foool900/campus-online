import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { api } from './api.js';
import { UserContext } from './UserContext.jsx';
import Layout from './components/Layout.jsx';
import NicknameModal from './components/NicknameModal.jsx';
import TasksPage from './pages/TasksPage.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import AchievementsPage from './pages/AchievementsPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import ActivityDetailPage from './pages/ActivityDetailPage.jsx';

const STORAGE_KEY = 'campus_user';

function loadStoredUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [user, setUserState] = useState(loadStoredUser);

  const saveUser = useCallback((u) => {
    setUserState(u);
    if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  // 挂载时向后端刷新一次，同步经验值/等级；若用户已被重置则重新引导
  useEffect(() => {
    const stored = loadStoredUser();
    if (!stored) return;
    api
      .user(stored.id)
      .then((fresh) => saveUser(fresh))
      .catch((err) => {
        if (err.status === 404) saveUser(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ user, setUser: saveUser }), [user, saveUser]);

  return (
    <BrowserRouter>
      <UserContext.Provider value={value}>
        <Layout>
          <Routes>
            <Route path="/" element={null} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/activity/:id" element={<ActivityDetailPage />} />
            <Route path="*" element={null} />
          </Routes>
        </Layout>
        {!user && <NicknameModal />}
      </UserContext.Provider>
    </BrowserRouter>
  );
}
