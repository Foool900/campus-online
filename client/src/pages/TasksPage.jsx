import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import TodoCard from '../components/TodoCard.jsx';

const levelOf = (exp) => Math.floor(exp / 100) + 1;

export default function TasksPage() {
  const { user, setUser } = useUser();
  const [tab, setTab] = useState('pending');
  const [todos, setTodos] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [completingId, setCompletingId] = useState(null);

  // 创建表单
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [areaId, setAreaId] = useState('');
  const [expReward, setExpReward] = useState('10');

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    api
      .todos(user.id)
      .then(setTodos)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => {
    api.areas().then(setAreas).catch(() => {});
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2200);
  };

  const createTodo = async (e) => {
    e.preventDefault();
    if (!user) return;
    const t = title.trim();
    if (!t) {
      showToast('请填写任务标题');
      return;
    }
    let reward = Number(expReward);
    if (!Number.isFinite(reward) || reward <= 0) reward = 10;
    try {
      const created = await api.createTodo({
        userId: user.id,
        title: t,
        description: description.trim(),
        dueDate: dueDate || null,
        areaId: areaId ? Number(areaId) : null,
        expReward: reward,
      });
      setTitle('');
      setDescription('');
      setDueDate('');
      setExpReward('10');
      setTodos((prev) => [created, ...prev]);
      showToast('待办已创建');
    } catch (err) {
      showToast(err.message || '创建失败');
    }
  };

  const complete = async (todo) => {
    if (!user || todo.status === 'completed') return;
    setCompletingId(todo.id);
    try {
      const result = await api.completeTodo(todo.id, { userId: user.id });
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? result : t)));
      setUser({ ...user, exp: result.userExp, level: levelOf(result.userExp) });
      showToast(result.alreadyCompleted ? '该任务已完成过' : `完成！+${result.expReward} 经验值`);
    } catch (err) {
      showToast(err.message || '操作失败');
    } finally {
      setCompletingId(null);
    }
  };

  const pending = todos.filter((t) => t.status === 'pending');
  const completed = todos.filter((t) => t.status === 'completed');
  const shown = tab === 'pending' ? pending : completed;

  return (
    <div className="page">
      <div className="page-head">
        <h1>✅ 任务 / 待办</h1>
        <p>完成任务即可获得经验值，登上排行榜！</p>
      </div>

      <form className="card todo-form" onSubmit={createTodo}>
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>标题 *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="要做什么？" />
          </div>
          <div className="field">
            <label>截止日期</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>描述</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="补充说明（可选）" />
          </div>
          <div className="field">
            <label>关联区域</label>
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">不关联</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>经验奖励</label>
            <input type="number" min="1" max="1000" value={expReward} onChange={(e) => setExpReward(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="btn primary">
          + 添加待办
        </button>
      </form>

      <div className="tabs">
        <button className={'tab' + (tab === 'pending' ? ' active' : '')} onClick={() => setTab('pending')}>
          待办 ({pending.length})
        </button>
        <button className={'tab' + (tab === 'completed' ? ' active' : '')} onClick={() => setTab('completed')}>
          已完成 ({completed.length})
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="empty-state">加载中…</div>}
      {!loading && !error && shown.length === 0 && (
        <div className="empty-state">{tab === 'pending' ? '暂无待办，添加一个吧～' : '还没有完成的任务'}</div>
      )}

      <div className="todo-list">
        {shown.map((t) => (
          <TodoCard key={t.id} todo={t} onComplete={complete} completing={completingId === t.id} />
        ))}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
