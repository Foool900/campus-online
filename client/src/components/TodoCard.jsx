function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export default function TodoCard({ todo, onComplete, completing }) {
  const done = todo.status === 'completed';

  return (
    <div className={'card todo-card' + (done ? ' done' : '')}>
      <div className="todo-main">
        <div className="todo-title">{todo.title}</div>
        {todo.description && <p className="todo-desc">{todo.description}</p>}
        <div className="todo-meta">
          {todo.areaName && <span>📍 {todo.areaName}</span>}
          {todo.dueDate && <span>📅 {todo.dueDate}</span>}
          <span className="reward-chip">+{todo.expReward} XP</span>
          {done && todo.completedAt && <span>✅ 完成于 {formatDateTime(todo.completedAt)}</span>}
        </div>
      </div>

      <div className="todo-actions">
        {done ? (
          <span className="done-badge">已完成 +{todo.expReward} XP</span>
        ) : (
          <button className="btn success" onClick={() => onComplete(todo)} disabled={completing}>
            {completing ? '完成中…' : '✓ 完成'}
          </button>
        )}
      </div>
    </div>
  );
}
