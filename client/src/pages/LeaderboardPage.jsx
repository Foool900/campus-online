import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

export default function LeaderboardPage() {
  const { user } = useUser();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .leaderboard()
      .then(setList)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <h1>🏆 排行榜</h1>
        <p>按经验值排序，完成任务就能往上爬！</p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="empty-state">加载中…</div>}
      {!loading && !error && list.length === 0 && <div className="empty-state">暂无玩家</div>}

      <div className="lb-list">
        {list.map((p, i) => (
          <div
            key={p.id}
            className={'card lb-row' + (i < 3 ? ` top${i + 1}` : '') + (p.id === user?.id ? ' lb-me' : '')}
          >
            <div className="lb-rank">{i + 1}</div>
            <div className="lb-info">
              <div className="lb-name">
                {p.avatar || '🎓'} {p.nickname}
              </div>
              <div className="lb-college">{p.college || '未填写学院'}</div>
            </div>
            <div className="lb-right">
              <div className="lb-exp">{p.exp} XP</div>
              <div className="lb-level">Lv{p.level}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
