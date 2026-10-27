import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { socket } from '../socket.js';
import { useUser } from '../UserContext.jsx';
import ChatChannel from '../components/ChatChannel.jsx';

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
const TERMINAL = ['approved', 'terminated', 'expired', 'cancelled'];

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export default function TaskDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();

  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const [acting, setActing] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const [proofText, setProofText] = useState('');
  const [proofImage, setProofImage] = useState('');
  const [proofLink, setProofLink] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    api
      .task(id)
      .then((t) => active && setTask(t))
      .catch((e) => active && setError(e.message || '加载失败'));
    return () => {
      active = false;
    };
  }, [id]);

  // 状态实时同步
  useEffect(() => {
    const onStatus = (payload) => {
      if (payload && Number(payload.taskId) === Number(id) && payload.task) {
        setTask((prev) => ({ ...prev, ...payload.task }));
      }
    };
    socket.on('task:status', onStatus);
    return () => socket.off('task:status', onStatus);
  }, [id]);

  const run = async (fn, okMsg) => {
    if (!user || !task) return;
    setActing(true);
    setError('');
    try {
      const updated = await fn();
      setTask(updated);
      if (okMsg) setProofOpen(false);
    } catch (e) {
      setError(e.message || '操作失败');
    } finally {
      setActing(false);
    }
  };

  const accept = () => run(() => api.acceptTask(task.id));
  const abandon = () => run(() => api.abandonTask(task.id));
  const approve = () => run(() => api.approveTask(task.id));
  const reject = () => run(() => api.rejectTask(task.id));
  const cancel = () => run(() => api.cancelTask(task.id));
  const toggleDone = () => run(() => api.toggleTaskDone(task.id));
  const submit = () => {
    const proof = { text: proofText.trim(), imageUrl: proofImage.trim(), link: proofLink.trim() };
    if (!proof.text && !proof.imageUrl && !proof.link) {
      setError('请至少提供文本 / 图片链接 / 链接之一作为凭证');
      return;
    }
    run(() => api.submitTask(task.id, { proof }), true);
  };

  const members = useMemo(() => {
    const list = [];
    if (task?.publisherId) list.push({ userId: task.publisherId, userName: task.publisherName, avatar: task.publisherAvatar, isAdmin: true });
    if (task?.assigneeId && task.assigneeId !== task.publisherId) {
      list.push({ userId: task.assigneeId, userName: task.assigneeName, avatar: task.assigneeAvatar, isAdmin: false });
    }
    return list;
  }, [task]);

  const isVerified = !!(user && (user.role === 'student' || user.role === 'admin'));
  const isTerminal = task ? TERMINAL.includes(task.status) : false;
  const role = task?.role;
  const canSpeak = isVerified && (role === 'publisher' || role === 'assignee') && !isTerminal;
  const lockMessage = !isVerified
    ? '提交认证材料后才能发言'
    : isTerminal
      ? '任务已结束，讨论区只读'
      : '接取任务后即可参与讨论';
  const onJoin = isVerified && !isTerminal && role === 'other' && task?.status === 'published' ? accept : null;

  if (error && !task) {
    return (
      <div className="activity-detail">
        <div className="act-backbar">
          <button className="act-back" onClick={() => navigate('/tasks')} aria-label="返回">← 返回</button>
        </div>
        <div className="act-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="activity-detail">
      <div className="act-backbar">
        <button className="act-back" onClick={() => navigate('/tasks')} aria-label="返回">← 返回</button>
        <span className="act-back-title">任务详情</span>
      </div>

      <div className="act-layout">
        {/* A. 任务信息区 */}
        <aside className={'act-info' + (infoCollapsed ? ' collapsed' : '')}>
          {infoCollapsed ? (
            <button className="act-info-summary" onClick={() => setInfoCollapsed(false)} title="展开任务信息">
              <span className="act-info-chevron">▸</span>
              <span className="act-info-title">{task?.title || '…'}</span>
              {task && <span className={'status-badge status-' + task.status}>{STATUS_LABELS[task.status]}</span>}
            </button>
          ) : (
            <>
              <div className="act-info-head">
                {task?.type && <span className="post-category">{TYPE_LABELS[task.type]}</span>}
                {task && <span className={'status-badge status-' + task.status}>{STATUS_LABELS[task.status]}</span>}
                <button className="act-info-collapse" onClick={() => setInfoCollapsed(true)} title="收起信息" aria-label="收起信息">▾</button>
              </div>
              <h2 className="act-info-title">{task?.title}</h2>

              {(task?.tags || []).length > 0 && (
                <div className="task-tags">
                  {task.tags.map((tag) => (
                    <span key={tag} className="task-tag">{tag}</span>
                  ))}
                </div>
              )}

              <div className="act-info-meta">
                <div className="act-info-row">
                  <span className="act-info-label">发布者</span>
                  <span>{task?.publisherAvatar || '🎓'} {task?.publisherName}</span>
                  {role === 'publisher' && <span className="act-admin-badge">发布者</span>}
                </div>
                <div className="act-info-row">
                  <span className="act-info-label">接取者</span>
                  <span>{task?.assigneeId ? `${task.assigneeAvatar || '🎓'} ${task.assigneeName}` : '暂无'}</span>
                  {role === 'assignee' && <span className="act-admin-badge">接取者</span>}
                </div>
                <div className="act-info-row"><span className="act-info-label">奖励</span><span className="reward-chip">+{task?.rewardCoin ?? 0} 金币</span>{task?.rewardWardrobeName && <span className="task-tag" style={{ marginLeft: 8 }}>{task.rewardWardrobeIcon || '🧥'} {task.rewardWardrobeName}</span>}</div>
                <div className="act-info-row"><span className="act-info-label">发布时间</span><span>{formatTime(task?.createdAt)}</span></div>
                {task?.deadlineAt && <div className="act-info-row"><span className="act-info-label">截止时间</span><span>{formatTime(task.deadlineAt)}</span></div>}
                {task?.minCompleteAt && task.status === 'accepted' && (
                  <div className="act-info-row"><span className="act-info-label">最早可提交</span><span>{formatTime(task.minCompleteAt)}</span></div>
                )}
                {task?.rejectCount > 0 && <div className="act-info-row"><span className="act-info-label">被驳回</span><span>{task.rejectCount} 次</span></div>}
              </div>

              {task?.description && <p className="act-info-desc">{task.description}</p>}

              {task?.submittedProof && (
                <div className="task-proof">
                  <div className="act-info-label">完成凭证</div>
                  {task.submittedProof.text && <div>{task.submittedProof.text}</div>}
                  {task.submittedProof.imageUrl && <div>🖼 <a href={task.submittedProof.imageUrl} target="_blank" rel="noreferrer">查看图片</a></div>}
                  {task.submittedProof.link && <div>🔗 <a href={task.submittedProof.link} target="_blank" rel="noreferrer">{task.submittedProof.link}</a></div>}
                </div>
              )}

              <div className="act-info-join">
                {role === 'publisher' && (
                  <div className="act-admin">
                    <div className="act-admin-head">⚙️ 任务操作</div>
                    <div className="act-status-actions">
                      {task?.status === 'submitted' && (
                        <>
                          <button className="btn success act-status-btn" onClick={approve} disabled={acting}>✓ 通过</button>
                          <button className="btn ghost act-status-btn" onClick={reject} disabled={acting}>✗ 驳回</button>
                        </>
                      )}
                      {task?.type === 'private' && (
                        <button className="btn ghost act-status-btn" onClick={toggleDone} disabled={acting}>
                          {task?.status === 'done' ? '↩ 撤销完成' : '✓ 完成打卡'}
                        </button>
                      )}
                      {task?.type === 'public' && !isTerminal && task?.status !== 'submitted' && (
                        <button className="btn ghost act-status-btn" onClick={cancel} disabled={acting}>取消任务</button>
                      )}
                      {isTerminal && <span className="act-admin-hint">已处于终态，不可再变更</span>}
                    </div>
                  </div>
                )}

                {role === 'assignee' && task?.status === 'accepted' && (
                  <div className="act-admin">
                    <div className="act-admin-head">🧑‍💻 接取者操作</div>
                    <div className="act-status-actions">
                      <button className="btn primary act-status-btn" onClick={() => setProofOpen((v) => !v)}>
                        {proofOpen ? '收起提交' : '提交完成'}
                      </button>
                      <button className="btn ghost act-status-btn" onClick={abandon} disabled={acting}>放弃任务</button>
                    </div>
                  </div>
                )}

                {role === 'other' && task?.status === 'published' && isVerified && (
                  <button className="btn primary" onClick={accept} disabled={acting}>接取任务</button>
                )}
                {role === 'other' && task?.status === 'published' && !isVerified && (
                  <span className="act-info-status">🔒 认证学员后才能接取</span>
                )}
              </div>

              {proofOpen && role === 'assignee' && task?.status === 'accepted' && (
                <div className="task-proof-form">
                  <div className="act-info-label">提交凭证（文本 / 图片链接 / 链接 至少一项）</div>
                  <textarea value={proofText} onChange={(e) => setProofText(e.target.value)} placeholder="描述完成情况…" rows={3} maxLength={2000} />
                  <input value={proofImage} onChange={(e) => setProofImage(e.target.value)} placeholder="图片链接（可选）" />
                  <input value={proofLink} onChange={(e) => setProofLink(e.target.value)} placeholder="链接（可选）" />
                  <button className="btn primary" onClick={submit} disabled={acting}>{acting ? '提交中…' : '提交凭证'}</button>
                </div>
              )}
            </>
          )}
        </aside>

        {/* B. 讨论区（复用统一消息组件） */}
        <ChatChannel
          conversationType="task"
          conversationId={Number(id)}
          canSpeak={canSpeak}
          lockMessage={lockMessage}
          onJoin={onJoin}
          members={members}
          authorUserId={task?.publisherId}
          isAdmin={role === 'publisher'}
        />
      </div>

      {error && task && <div className="toast">{error}</div>}
    </div>
  );
}
