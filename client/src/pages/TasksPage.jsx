import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import TaskHelpModal from '../components/TaskHelpModal.jsx';

const STATUS_LABELS = {
  todo: '待办',
  done: '已完成',
  published: '可接取',
  accepted: '进行中',
  submitted: '待验收',
  approved: '已通过',
  terminated: '已终止',
  expired: '已过期',
  cancelled: '已取消',
};
const TYPE_LABELS = { public: '公开任务', private: '私密备忘' };
const FILTERS = [
  ['public', '公开任务'],
  ['mine', '我发布的'],
  ['assigned', '我接取的'],
  ['private', '私密备忘'],
];

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

const pad2 = (n) => String(n).padStart(2, '0');

export default function TasksPage() {
  const { user } = useUser();
  const navigate = useNavigate();

  const [filter, setFilter] = useState('public');
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [wallet, setWallet] = useState(null);
  const [expConfig, setExpConfig] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const [pubOpen, setPubOpen] = useState(false);
  const [type, setType] = useState('public');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [rewardExp, setRewardExp] = useState('0');
  const [deadlineAt, setDeadlineAt] = useState('');

  useEffect(() => {
    api.wallet().then(setWallet).catch(() => {});
    api.expConfig().then(setExpConfig).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError('');
    api
      .tasks(filter)
      .then(setTasks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user?.id, filter]);

  const showToast = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2200);
  };

  const refreshWallet = () => api.wallet().then(setWallet).catch(() => {});
  const refresh = () => api.tasks(filter).then(setTasks).catch(() => {});

  const rewardCap =
    wallet && expConfig
      ? Math.min(Math.floor(wallet.availableExp * expConfig.reward.capRatio), expConfig.reward.capAbsolute)
      : null;

  const createTask = async (e) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      showToast('请填写任务标题');
      return;
    }
    const tagList = tags.split(/[,，\s]+/).filter(Boolean).slice(0, 5);
    const reward = type === 'private' ? 0 : Math.max(0, Number(rewardExp) || 0);
    try {
      const created = await api.createTask({
        type,
        title: t,
        description: description.trim(),
        tags: tagList,
        rewardExp: reward,
        deadlineAt: deadlineAt || null,
      });
      setTitle('');
      setDescription('');
      setTags('');
      setRewardExp('0');
      setDeadlineAt('');
      setPubOpen(false);
      refreshWallet();
      refresh();
      showToast(type === 'private' ? '私密备忘已创建' : '公开任务已发布');
      navigate(`/task/${created.id}`);
    } catch (err) {
      showToast(err.message || '发布失败');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          [ MISSION_CENTER ]
          <button className="task-help-btn" onClick={() => setHelpOpen(true)} title="帮助" aria-label="帮助">
            [ ? ]
          </button>
        </h1>
        <p className="page-sub">// 发布悬赏任务，或记录私密备忘</p>
      </div>

      {wallet && (
        <>
          <div className="task-wallet">
            <span>[ PILOT_LV: <span className="tw-val">{pad2(wallet.level)}</span> ]</span>
            <span className="tw-sep">|</span>
            <span>[ EXP_TOTAL: <span className="tw-val">{wallet.totalExp}</span> ]</span>
            <span className="tw-sep">|</span>
            <span>[ EXP_FREE: <span className="tw-val">{wallet.availableExp}</span> ]</span>
            <span className="tw-sep">|</span>
            <span>[ EXP_FROZEN: <span className="tw-val">{wallet.frozenExp}</span> ]</span>
          </div>
          <div className="task-exp-bar">
            <i style={{ width: `${wallet.totalExp % 100}%` }} />
          </div>
        </>
      )}

      <div className="tabs" style={{ flexWrap: 'wrap', gap: 8 }}>
        {FILTERS.map(([k, label]) => (
          <button key={k} className={'tab' + (filter === k ? ' active' : '')} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
        <button className="btn primary mission-create" style={{ marginLeft: 'auto' }} onClick={() => setPubOpen((v) => !v)}>
          + NEW MISSION
        </button>
      </div>

      {pubOpen && (
        <form className="card todo-form" onSubmit={createTask}>
          <div className="row">
            <div className="field" style={{ flex: 1.4 }}>
              <label>类型</label>
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  if (e.target.value === 'private') setRewardExp('0');
                }}
              >
                <option value="public">公开任务（可设经验奖励）</option>
                <option value="private">私密备忘（仅自己可见，无奖励）</option>
              </select>
            </div>
            <div className="field">
              <label>经验奖励</label>
              <input
                type="number"
                min="0"
                max={rewardCap ?? 500}
                value={type === 'private' ? '0' : rewardExp}
                onChange={(e) => setRewardExp(e.target.value)}
                disabled={type === 'private'}
              />
              {type === 'private' ? (
                <small style={{ color: 'var(--muted)' }}>私密备忘无奖励</small>
              ) : rewardCap != null ? (
                <small style={{ color: 'var(--muted)' }}>单任务上限 {rewardCap}（可用 {wallet.availableExp}）</small>
              ) : null}
            </div>
            <div className="field">
              <label>截止时间（可选）</label>
              <input type="datetime-local" value={deadlineAt} onChange={(e) => setDeadlineAt(e.target.value)} />
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 2 }}>
              <label>标题 *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="要做什么？" />
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label>标签（逗号分隔，最多 5 个）</label>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="如：跑腿, 学习" />
            </div>
          </div>
          <div className="field">
            <label>描述</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="补充说明（可选）" rows={2} />
          </div>
          <button type="submit" className="btn primary">＋ 发布</button>
        </form>
      )}

      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="empty-state">SYNC…</div>}
      {!loading && !error && tasks.length === 0 && (
        <div className="empty-state">
          {filter === 'public' ? '> NO ACTIVE MISSIONS DETECTED...' : '> NO DATA'}
        </div>
      )}

      <div className="todo-list">
        {tasks.map((t) => (
          <div key={t.id} className="card todo-card task-card" onClick={() => navigate(`/task/${t.id}`)}>
            <div className="todo-main">
              <div className="todo-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="task-title-text">{t.title}</span>
                <span className="post-category">{TYPE_LABELS[t.type]}</span>
                <span className={'status-badge status-' + t.status}>{STATUS_LABELS[t.status]}</span>
              </div>
              {t.description && <p className="todo-desc">{t.description}</p>}
              {(t.tags || []).length > 0 && (
                <div className="task-tags">
                  {t.tags.map((tag) => (
                    <span key={tag} className="task-tag">{tag}</span>
                  ))}
                </div>
              )}
              <div className="todo-meta" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="reward-chip">+{t.rewardExp} XP</span>
                <span className="meta-item">PUB {t.publisherName}</span>
                {t.assigneeId && <span className="meta-item">ASG {t.assigneeName}</span>}
                {t.deadlineAt && <span className="meta-item">DL {formatTime(t.deadlineAt)}</span>}
              </div>
            </div>
            <div className="todo-actions">
              <span className="view-link">VIEW ›</span>
            </div>
          </div>
        ))}
      </div>

      {toast && <div className="toast">{toast}</div>}
      {helpOpen && <TaskHelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
