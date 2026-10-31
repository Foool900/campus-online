import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { socket } from '../socket.js';
import { useUser } from '../UserContext.jsx';
import ChatChannel from '../components/ChatChannel.jsx';

const STATUS_LABELS = { draft: '草稿', open: '报名中', ongoing: '进行中', ended: '已结束', cancelled: '已取消' };
const TRANSITIONS = {
  draft: ['open', 'cancelled'],
  open: ['ongoing', 'ended', 'cancelled'],
  ongoing: ['ended', 'cancelled'],
  ended: [],
  cancelled: [],
};
const STATUS_ACTION_LABELS = { open: '发布', ongoing: '开始', ended: '结束', cancelled: '取消' };

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export default function ActivityDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();

  const [post, setPost] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [role, setRole] = useState('guest');
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState('');

  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [featuredSaving, setFeaturedSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteVisible, setNoteVisible] = useState(true);
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  // 活动详情（角色/状态/参与者）
  useEffect(() => {
    let active = true;
    setError('');
    api
      .post(id, user?.id)
      .then((detail) => {
        if (!active) return;
        setPost(detail.post);
        setParticipants(detail.participants || []);
        setParticipantCount(detail.participantCount || 0);
        setRole(detail.role || 'guest');
      })
      .catch((e) => {
        if (active) setError(e.message || '加载失败');
      });
    return () => {
      active = false;
    };
  }, [id, user?.id]);

  // 备注（角色决定可见范围）
  useEffect(() => {
    let active = true;
    api
      .postNotes(id, user?.id)
      .then((n) => {
        if (active) setNotes(n || []);
      })
      .catch(() => {
        if (active) setNotes([]);
      });
    return () => {
      active = false;
    };
  }, [id, user?.id, role]);

  // 活动状态实时同步（管理员改状态 → 其他端只读）
  useEffect(() => {
    const onStatus = (payload) => {
      if (payload && Number(payload.postId) === Number(id) && payload.status) {
        setPost((prev) => (prev ? { ...prev, status: payload.status } : prev));
      }
    };
    socket.on('post:status', onStatus);
    return () => socket.off('post:status', onStatus);
  }, [id]);

  const join = async () => {
    if (!user || !post) return;
    setJoinLoading(true);
    try {
      const r = await api.joinPost(post.id, { userId: user.id });
      setRole(r.role || 'participant');
      setParticipantCount(r.participantCount);
    } catch (e) {
      setError(e.message || '加入失败');
    } finally {
      setJoinLoading(false);
    }
  };

  const changeStatus = async (status) => {
    if (!user || !post) return;
    setStatusChanging(true);
    setError('');
    try {
      const r = await api.updateStatus(post.id, { userId: user.id, status });
      setPost(r.post);
    } catch (e) {
      setError(e.message || '状态修改失败');
    } finally {
      setStatusChanging(false);
    }
  };

  const toggleFeatured = async () => {
    if (!post) return;
    setFeaturedSaving(true);
    setError('');
    try {
      const r = await api.setPostFeatured(post.id, { featured: !post.featured });
      setPost(r.post);
      if (r.indexed === false) setError('已标记，但知识库索引未更新（Ollama 未启动），重建后即可检索');
    } catch (e) {
      setError(e.message || '操作失败');
    } finally {
      setFeaturedSaving(false);
    }
  };

  const addNote = async () => {
    const content = noteDraft.trim();
    if (!content || !user || !post) return;
    setNoteSubmitting(true);
    setError('');
    try {
      const note = await api.addNote(post.id, { userId: user.id, content, visibleToParticipants: noteVisible });
      setNotes((prev) => [note, ...prev]);
      setNoteDraft('');
    } catch (e) {
      setError(e.message || '备注添加失败');
    } finally {
      setNoteSubmitting(false);
    }
  };

  const members = useMemo(() => {
    const list = [];
    if (post) list.push({ userId: post.userId, userName: post.nickname, avatar: post.avatar, isAdmin: true });
    for (const p of participants) list.push({ userId: p.id, userName: p.nickname, avatar: p.avatar, isAdmin: false });
    return list;
  }, [post, participants]);

  const isVerified = !!(user && (user.role === 'student' || user.role === 'admin'));
  const isTerminal = post ? post.status === 'ended' || post.status === 'cancelled' : false;
  const canSpeak = isVerified && (role === 'admin' || role === 'participant') && !isTerminal;
  const lockMessage = !isVerified
    ? '提交认证材料后才能发言'
    : isTerminal
      ? `活动已${STATUS_LABELS[post.status]}，全员只读`
      : '加入活动后即可发言';
  const onJoin = isVerified && !isTerminal && role === 'guest' && post?.status === 'open' ? join : null;

  if (error && !post) {
    return (
      <div className="activity-detail">
        <div className="act-backbar">
          <button className="act-back" onClick={() => navigate('/')} aria-label="返回">← 返回</button>
        </div>
        <div className="act-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="activity-detail">
      <div className="act-backbar">
        <button className="act-back" onClick={() => navigate('/')} aria-label="返回">← 返回</button>
        <span className="act-back-title">活动详情</span>
      </div>

      <div className="act-layout">
        {/* A. 活动信息区 */}
        <aside className={'act-info' + (infoCollapsed ? ' collapsed' : '')}>
          {infoCollapsed ? (
            <button className="act-info-summary" onClick={() => setInfoCollapsed(false)} title="展开活动信息">
              <span className="act-info-chevron">▸</span>
              <span className="act-info-title">{post?.title || '…'}</span>
              {post && <span className={'status-badge status-' + post.status}>{STATUS_LABELS[post.status]}</span>}
              <span className="act-info-count">👥 {participantCount}</span>
            </button>
          ) : (
            <>
              <div className="act-info-head">
                {post?.category && <span className="post-category">{post.category}</span>}
                {post && <span className={'status-badge status-' + post.status}>{STATUS_LABELS[post.status]}</span>}
                <button className="act-info-collapse" onClick={() => setInfoCollapsed(true)} title="收起信息" aria-label="收起信息">▾</button>
              </div>
              <h2 className="act-info-title">{post?.title}</h2>
              <div className="act-info-meta">
                <div className="act-info-row">
                  <span className="act-info-label">发起人</span>
                  <span>{post?.avatar || '🎓'} {post?.nickname}</span>
                  {role === 'admin' && <span className="act-admin-badge">管理员</span>}
                </div>
                <div className="act-info-row"><span className="act-info-label">时间</span><span>{formatTime(post?.createdAt)}</span></div>
                <div className="act-info-row"><span className="act-info-label">形式</span><span>{post?.category || '未分类'}</span></div>
                <div className="act-info-row"><span className="act-info-label">参与</span><span>{participantCount} 人</span></div>
              </div>
              {post?.content && <p className="act-info-desc">{post.content}</p>}

              <div className="act-info-join">
                {role === 'admin' ? (
                  <span className="act-info-status">✅ 我是发起人</span>
                ) : role === 'participant' ? (
                  <span className="act-info-status">✅ 已加入，可参与讨论</span>
                ) : !isVerified ? (
                  <span className="act-info-status">🔒 认证学员后才能加入</span>
                ) : post?.status === 'open' ? (
                  <button className="btn primary" onClick={join} disabled={joinLoading || !user}>{joinLoading ? '加入中…' : '报名 / 加入'}</button>
                ) : (
                  <span className="act-info-status">当前状态不可报名</span>
                )}
              </div>

              {user?.role === 'admin' && post && (
                <div className="act-info-row">
                  <span className="act-info-label">精华</span>
                  <button className="btn ghost" onClick={toggleFeatured} disabled={featuredSaving}>
                    {post.featured ? '取消精华' : '设为精华'}
                  </button>
                </div>
              )}

              {role === 'admin' && post && (
                <div className="act-admin">
                  <div className="act-admin-head">⚙️ 活动管理</div>
                  <div className="act-status-actions">
                    {TRANSITIONS[post.status].map((s) => (
                      <button key={s} className="btn ghost act-status-btn" onClick={() => changeStatus(s)} disabled={statusChanging}>
                        {STATUS_ACTION_LABELS[s]}
                      </button>
                    ))}
                    {TRANSITIONS[post.status].length === 0 && <span className="act-admin-hint">已处于终态，不可再变更</span>}
                  </div>

                  <div className="act-notes">
                    <button className="act-notes-toggle" onClick={() => setNotesCollapsed((v) => !v)}>
                      📝 活动备注（{notes.length}）{notesCollapsed ? '▸' : '▾'}
                    </button>
                    {!notesCollapsed && (
                      <>
                        {notes.length === 0 && <div className="act-notes-empty">暂无备注</div>}
                        {notes.map((n) => (
                          <div key={n.id} className="act-note">
                            <div className="act-note-content">{n.content}</div>
                            <div className="act-note-meta">
                              <span>{n.creatorName}</span>
                              <span>{formatTime(n.createdAt)}</span>
                              <span className="act-note-vis">{n.visibleToParticipants ? '对参与者可见' : '仅管理员'}</span>
                            </div>
                          </div>
                        ))}
                        <div className="act-note-form">
                          <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="写一条活动备注…" rows={2} maxLength={500} />
                          <div className="act-note-form-row">
                            <label className="act-note-check"><input type="checkbox" checked={noteVisible} onChange={(e) => setNoteVisible(e.target.checked)} /> 对参与者可见</label>
                            <button className="btn primary" onClick={addNote} disabled={noteSubmitting || !noteDraft.trim()}>{noteSubmitting ? '保存中…' : '添加备注'}</button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </aside>

        {/* B. 频道区（统一组件） */}
        <ChatChannel
          conversationType="activity"
          conversationId={Number(id)}
          canSpeak={canSpeak}
          lockMessage={lockMessage}
          onJoin={onJoin}
          members={members}
          authorUserId={post?.userId}
          isAdmin={role === 'admin'}
        />
      </div>
    </div>
  );
}
