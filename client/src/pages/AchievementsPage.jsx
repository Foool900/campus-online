import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

export default function AchievementsPage() {
  const { user } = useUser();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    api
      .achievements(user.id)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const unlockedCount = data?.achievements.filter((a) => a.unlocked).length ?? 0;
  const total = data?.achievements.length ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <h1>🎖️ 成就</h1>
        <p>
          已解锁 {unlockedCount}/{total}，达成条件见每条描述
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="empty-state">加载中…</div>}
      {!loading && !error && data && data.achievements.length === 0 && (
        <div className="empty-state">暂无成就</div>
      )}

      <div className="ach-list">
        {data?.achievements.map((a) => (
          <div key={a.id} className={'card ach-card' + (a.unlocked ? ' unlocked' : '')}>
            <div className="ach-icon">{a.icon}</div>
            <div className="ach-main">
              <div className="ach-name">{a.name}</div>
              <div className="ach-desc">{a.description}</div>
              <div className="ach-progress-row">
                <div className="ach-progress-bar">
                  <div className="ach-progress-fill" style={{ width: `${a.progressPct}%` }} />
                </div>
                <span className="ach-count">
                  {a.current}/{a.target}
                </span>
              </div>
            </div>
            <div className="ach-state">{a.unlocked ? '✅' : '🔒'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
