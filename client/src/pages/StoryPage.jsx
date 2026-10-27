import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';

const MODE_LABEL = { claim: '直接领取', task: '任务解锁', gacha: '奖池限定' };
const AVAIL_LABEL = { permanent: '常驻', festival: '节日限定' };
const FILTERS = [
  ['all', '全部'],
  ['available', '可领取'],
  ['mine', '我的'],
  ['festival', '节日限定'],
];

function StoryCard({ s, isStudent, onClaim, onOpen }) {
  const run = s.myRun;
  const status = run ? run.status : null;
  return (
    <div className={'story-card' + (run ? ' owned' : '')} onClick={onOpen}>
      <div className="story-card-cover">{s.cover || '📖'}</div>
      <div className="story-card-body">
        <div className="story-card-title">{s.title}</div>
        <div className="story-card-sub">{s.subtitle || '—'}</div>
        <div className="story-card-tags">
          <span className="story-tag">{AVAIL_LABEL[s.availability] || s.availability}</span>
          <span className="story-tag">{MODE_LABEL[s.obtainMode] || s.obtainMode}</span>
          <span className="story-tag">{s.category}</span>
        </div>
        <div className="story-card-progress">
          {run ? `已打卡 ${run.checkedCount}/${run.nodeCount}` : `共 ${s.nodeCount} 个节点`}
        </div>
      </div>
      <div className="story-card-action">
        {status === 'completed' ? (
          <span className="story-state done">✓ 已完成</span>
        ) : status === 'expired' ? (
          <span className="story-state expired">已过期</span>
        ) : run ? (
          <span className="story-state ongoing">进行中 →</span>
        ) : s.obtainable ? (
          isStudent ? (
            <button className="hud-btn" onClick={(e) => { e.stopPropagation(); onClaim(); }}>领取</button>
          ) : (
            <span className="story-state locked">🔒 需实名</span>
          )
        ) : (
          <span className="story-state locked">🔒 未开放</span>
        )}
      </div>
    </div>
  );
}

export default function StoryPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const isStudent = !!user && (user.role === 'student' || user.role === 'admin');
  const [stories, setStories] = useState(null);
  const [filter, setFilter] = useState('all');
  const [toast, setToast] = useState(null);

  const say = (text, kind = 'ok') => setToast({ text, kind });

  const refresh = useCallback(async () => {
    try {
      setStories(await api.stories());
    } catch (e) {
      say(e.message || '加载失败', 'err');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const doClaim = async (id) => {
    try {
      await api.storyClaim(id);
      say('已领取剧情');
      refresh();
    } catch (e) {
      say(e.message || '领取失败', 'err');
    }
  };

  if (!stories) {
    return <div className="page story-page"><div className="story-loading">&gt; SYNC…</div></div>;
  }

  const completed = stories.filter((s) => s.myRun?.status === 'completed').length;
  const inProgress = stories.filter((s) => s.myRun?.status === 'in_progress').length;
  const filtered = stories.filter((s) => {
    if (filter === 'mine') return !!s.myRun;
    if (filter === 'available') return s.obtainable;
    if (filter === 'festival') return s.availability === 'festival';
    return true;
  });

  return (
    <div className="page story-page">
      <div className="story-hero">
        <div>
          <div className="story-hero-title">[ STORY ] 剧情</div>
          <div className="story-hero-meta">已完成 {completed} · 进行中 {inProgress} · 共 {stories.length} 章</div>
        </div>
        <div className="story-hero-actions">
          <button className="hud-btn" onClick={() => navigate('/lottery?tab=story')}>🎁 剧情祈愿</button>
          <button className="hud-btn" onClick={() => navigate('/story/timeline')}>📖 时间线故事书</button>
        </div>
      </div>

      {toast && <div className={toast.kind === 'ok' ? 'form-success' : 'form-error'} style={{ marginBottom: 12 }}>{toast.text}</div>}

      <div className="story-filters">
        {FILTERS.map(([k, label]) => (
          <button key={k} className={'story-filter' + (filter === k ? ' active' : '')} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      <div className="story-scroll">
        {filtered.length === 0 ? (
          <div className="story-empty">
            <div className="story-empty-ico">📖</div>
            <div>这里还没有剧情</div>
            <div className="story-empty-sub">完成特定任务、或等待节日 / 奖池限定的新章节</div>
          </div>
        ) : (
          <div className="story-grid">
            {filtered.map((s) => (
              <StoryCard key={s.id} s={s} isStudent={isStudent} onClaim={() => doClaim(s.id)} onOpen={() => navigate(`/story/${s.id}`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
