import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { socket } from '../socket.js';
import { useUser } from '../UserContext.jsx';

const STATUS_LABELS = { draft: '草稿', open: '报名中', ongoing: '进行中', ended: '已结束', cancelled: '已取消' };
const TRANSITIONS = {
  draft: ['open', 'cancelled'],
  open: ['ongoing', 'ended', 'cancelled'],
  ongoing: ['ended', 'cancelled'],
  ended: [],
  cancelled: [],
};
const STATUS_ACTION_LABELS = { open: '发布', ongoing: '开始', ended: '结束', cancelled: '取消' };
const PRESET_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢'];
const SYSTEM_EMOJIS = ['😀', '😄', '😂', '😊', '😍', '😘', '😎', '🤔', '🙌', '👏', '🎉', '🔥', '💯', '❤️', '👍', '🙏', '😢', '😡', '🤯', '😴', '🥳', '😇'];

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

function newClientId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function replaceTemp(prev, clientId, message) {
  const idx = prev.findIndex((m) => m.clientId === clientId);
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = message;
    return next;
  }
  return prev.some((m) => m.id === message.id) ? prev : [...prev, message];
}

function mergeIncoming(prev, message, myId) {
  if (prev.some((m) => m.id === message.id)) return prev;
  if (message.userId === myId) {
    const idx = prev.findIndex((m) => m.pending && m.content === message.content);
    if (idx >= 0) {
      const next = [...prev];
      next[idx] = message;
      return next;
    }
  }
  return [...prev, message];
}

function mergeReaction(prev, messageId, reactions) {
  return prev.map((m) => (m.id === messageId ? { ...m, reactions } : m));
}

function mergeRecalled(prev, messageId) {
  return prev.map((m) =>
    m.id === messageId ? { ...m, type: 'recalled', content: '', recalledAt: new Date().toISOString() } : m
  );
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
  const [online, setOnline] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [mentions, setMentions] = useState([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState('emoji');
  const [stickers, setStickers] = useState([]);
  const [reactFor, setReactFor] = useState(null);
  const [readListFor, setReadListFor] = useState(null);
  const [readList, setReadList] = useState([]);
  const [readListLoading, setReadListLoading] = useState(false);

  const [joinLoading, setJoinLoading] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteVisible, setNoteVisible] = useState(true);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  const listRef = useRef(null);
  const nearBottomRef = useRef(true);
  const textareaRef = useRef(null);
  const userRef = useRef(user);
  userRef.current = user;

  const scrollToBottom = (force = false) => {
    const el = listRef.current;
    if (!el) return;
    if (force || nearBottomRef.current) el.scrollTop = el.scrollHeight;
  };
  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // 活动详情（含角色/状态/参与者）
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

  // 我的表情包
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    api
      .stickers(user.id)
      .then((s) => {
        if (active) setStickers(s || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.id]);

  // 历史消息 + 房间 + 实时事件
  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessages([]);
    setError('');

    api
      .postMessages(id)
      .then((msgs) => {
        if (active) setMessages(msgs || []);
      })
      .catch(() => {
        if (active) setMessages([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    socket.emit('join:post', { postId: id });

    const onNew = (payload) => {
      if (!active) return;
      if (payload && Number(payload.postId) === Number(id) && payload.message) {
        setMessages((prev) => mergeIncoming(prev, payload.message, userRef.current?.id));
      }
    };
    const onReaction = (payload) => {
      if (active && payload && Number(payload.postId) === Number(id)) {
        setMessages((prev) => mergeReaction(prev, payload.messageId, payload.reactions));
      }
    };
    const onRecalled = (payload) => {
      if (active && payload && Number(payload.postId) === Number(id)) {
        setMessages((prev) => mergeRecalled(prev, payload.messageId));
      }
    };
    const onPresence = (payload) => {
      if (active && payload && Number(payload.postId) === Number(id)) {
        setOnline(payload.online || []);
      }
    };
    const onStatus = (payload) => {
      if (active && payload && Number(payload.postId) === Number(id) && payload.status) {
        setPost((prev) => (prev ? { ...prev, status: payload.status } : prev));
      }
    };

    socket.on('message:new', onNew);
    socket.on('message:reaction', onReaction);
    socket.on('message:recalled', onRecalled);
    socket.on('presence:update', onPresence);
    socket.on('post:status', onStatus);

    return () => {
      active = false;
      socket.off('message:new', onNew);
      socket.off('message:reaction', onReaction);
      socket.off('message:recalled', onRecalled);
      socket.off('presence:update', onPresence);
      socket.off('post:status', onStatus);
      socket.emit('leave:post', { postId: id });
    };
  }, [id]);

  // 在线成员：登录后以 userId 加入房间（presence 追踪）
  useEffect(() => {
    if (!user?.id) return undefined;
    socket.emit('join:post', { postId: id, userId: user.id });
    return () => {
      socket.emit('leave:post', { postId: id, userId: user.id });
    };
  }, [id, user?.id]);

  // 初次加载后滚到底
  useEffect(() => {
    if (!loading) scrollToBottom(true);
  }, [loading]);

  // 新消息到达：仅接近底部时跟随
  useEffect(() => {
    if (!loading && messages.length > 0) scrollToBottom(false);
  }, [messages.length, loading]);

  // 标记已读：接近底部时把最后一条（含之前）标为已读
  useEffect(() => {
    if (loading || !user || role === 'guest' || !post || !nearBottomRef.current) return;
    const lastWithId = [...messages].reverse().find((m) => m.id != null);
    if (!lastWithId) return;
    api.markRead(post.id, { userId: user.id, upToMessageId: lastWithId.id }).catch(() => {});
  }, [messages.length, loading, role, post?.id, user?.id]);

  const sendContent = (text, clientId, opts = {}) => {
    if (!user || !post) return;
    const temp = {
      clientId,
      pending: 'sending',
      type: opts.type || 'text',
      content: text,
      replyTo: opts.replyTo || null,
      mentions: opts.mentions || [],
      userId: user.id,
      nickname: user.nickname,
      avatar: user.avatar,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, temp]);
    scrollToBottom(true);

    const payload = {
      postId: post.id,
      channelId: post.channelId,
      userId: user.id,
      content: text,
      type: opts.type || 'text',
      replyTo: opts.replyTo || null,
      mentions: opts.mentions || [],
    };
    const ok = (msg) => setMessages((prev) => replaceTemp(prev, clientId, msg));
    const fail = () =>
      setMessages((prev) => prev.map((m) => (m.clientId === clientId ? { ...m, pending: 'failed' } : m)));

    if (socket.connected) {
      socket.emit('message:send', payload, (ack) => {
        if (ack && ack.ok && ack.message) ok(ack.message);
        else fail();
      });
    } else {
      api.sendPostMessage(post.id, { userId: user.id, content: text, type: opts.type, replyTo: opts.replyTo, mentions: opts.mentions }).then(ok).catch(fail);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    sendContent(text, newClientId(), { replyTo, mentions });
    setReplyTo(null);
    setMentions([]);
  };

  const sendText = (text) => {
    sendContent(text, newClientId(), { replyTo, mentions });
    setReplyTo(null);
    setMentions([]);
    setPickerOpen(false);
  };

  const sendSticker = (url) => {
    sendContent(url, newClientId(), { type: 'sticker', replyTo, mentions });
    setReplyTo(null);
    setMentions([]);
    setPickerOpen(false);
  };

  const retry = (msg) => {
    setMessages((prev) => prev.filter((m) => m.clientId !== msg.clientId));
    sendContent(msg.content, newClientId(), { type: msg.type, replyTo: msg.replyTo, mentions: msg.mentions });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onDraftChange = (text) => {
    setDraft(text);
    const at = text.lastIndexOf('@');
    if (at >= 0 && !text.slice(at + 1).includes(' ') && !text.slice(at + 1).includes('\n')) {
      setMentionQuery(text.slice(at + 1));
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
    }
  };

  const pickMention = (member) => {
    const tag = `@${member.userName}`;
    const at = draft.lastIndexOf('@');
    if (at >= 0 && !draft.slice(at + 1).includes(' ') && !draft.slice(at + 1).includes('\n')) {
      setDraft(draft.slice(0, at) + tag + ' ');
    } else {
      setDraft((d) => (d ? d + ' ' : '') + tag + ' ');
    }
    setMentions((prev) => (prev.some((x) => x.userId === member.userId) ? prev : [...prev, { userId: member.userId, userName: member.userName }]));
    setMentionOpen(false);
    textareaRef.current?.focus();
  };

  const startReply = (m) => {
    setReplyTo({ messageId: m.id, userId: m.userId, userName: m.nickname, contentPreview: m.content });
    if (m.userId !== user?.id) {
      const tag = `@${m.nickname}`;
      setDraft((d) => (d.includes(tag) ? d : (d ? d + ' ' : '') + tag + ' '));
      setMentions((prev) => (prev.some((x) => x.userId === m.userId) ? prev : [...prev, { userId: m.userId, userName: m.nickname }]));
    }
  };

  const recall = async (m) => {
    if (!user || !m.id) return;
    try {
      await api.recallMessage(post.id, m.id, { userId: user.id });
      setMessages((prev) => mergeRecalled(prev, m.id));
    } catch (e) {
      setError(e.message || '撤回失败');
    }
  };

  const react = async (m, emoji) => {
    if (!user || !m.id) return;
    try {
      const r = await api.reactMessage(post.id, m.id, { userId: user.id, emoji });
      setMessages((prev) => mergeReaction(prev, m.id, r.reactions));
    } catch (e) {
      setError(e.message || '回应失败');
    }
  };

  const showReads = async (m) => {
    setReadListFor(m.id);
    setReadList([]);
    setReadListLoading(true);
    try {
      const list = await api.messageReads(post.id, m.id);
      setReadList(list || []);
    } catch {
      setReadList([]);
    } finally {
      setReadListLoading(false);
    }
  };

  const jumpToMessage = (messageId) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1600);
    }
  };

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
      if (r.systemMessage) {
        setMessages((prev) => (prev.some((m) => m.id === r.systemMessage.id) ? prev : [...prev, r.systemMessage]));
      }
    } catch (e) {
      setError(e.message || '状态修改失败');
    } finally {
      setStatusChanging(false);
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

  const upload = async (file) => {
    if (!user || !file) return;
    setUploading(true);
    setUploadMsg('');
    try {
      const s = await api.uploadSticker(user.id, file);
      setStickers((prev) => [s, ...prev]);
      setUploadMsg('上传成功');
    } catch (e) {
      setUploadMsg(e.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const members = useMemo(() => {
    const list = [];
    if (post) list.push({ userId: post.userId, userName: post.nickname, avatar: post.avatar, isAdmin: true });
    for (const p of participants) list.push({ userId: p.id, userName: p.nickname, avatar: p.avatar, isAdmin: false });
    return list;
  }, [post, participants]);

  const isOnline = (userId) => online.some((o) => o.userId === userId);

  const filteredMembers = mentionOpen
    ? members
        .filter((m) => !mentionQuery || m.userName.includes(mentionQuery))
        .sort((a, b) => Number(isOnline(b.userId)) - Number(isOnline(a.userId)))
    : [];

  const isTerminal = post ? post.status === 'ended' || post.status === 'cancelled' : false;
  const canSpeak = !!(user && (role === 'admin' || role === 'participant') && !isTerminal);

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
                ) : post?.status === 'open' ? (
                  <button className="btn primary" onClick={join} disabled={joinLoading || !user}>{joinLoading ? '加入中…' : '报名 / 加入'}</button>
                ) : (
                  <span className="act-info-status">当前状态不可报名</span>
                )}
              </div>

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

        {/* B. 频道区 */}
        <section className="act-channel">
          <div className="act-channel-top">
            <button className="act-online-btn" onClick={() => setOnlineOpen((v) => !v)}>在线 {online.length} 人</button>
            {onlineOpen && (
              <div className="act-online-list">
                {online.length === 0 && <span className="act-online-empty">暂无在线成员</span>}
                {online.map((o) => (
                  <span key={o.userId} className="act-online-item">{o.avatar} {o.userName}{o.isAdmin && <em className="act-admin-badge">管理员</em>}</span>
                ))}
              </div>
            )}
          </div>

          <div className="act-messages" ref={listRef} onScroll={onListScroll}>
            {loading && <div className="act-empty">加载中…</div>}
            {!loading && messages.length === 0 && <div className="act-empty">频道还很安静，来发第一条消息吧～</div>}
            {messages.map((m) => {
              if (m.type === 'system') return <div key={m.id} className="act-system-msg">{m.content}</div>;
              const mine = m.userId === user?.id;
              const author = post && m.userId === post.userId;
              const recalled = m.type === 'recalled';
              const isTemp = !!m.pending;
              const mentionsMe = m.mentions?.some((x) => x.userId === user?.id);
              const canRecall = !isTemp && !recalled && (role === 'admin' || (mine && Date.now() - new Date(m.createdAt).getTime() < 2 * 60 * 1000));

              return (
                <div
                  key={m.clientId || m.id}
                  id={m.id != null ? `msg-${m.id}` : undefined}
                  className={'act-msg' + (mine ? ' mine' : '') + (mentionsMe ? ' mention-me' : '') + (m.pending === 'failed' ? ' failed' : '')}
                >
                  <div className="act-msg-avatar">
                    {m.avatar || '🎓'}
                    {isOnline(m.userId) && !isTemp && <span className="act-avatar-dot" />}
                  </div>
                  <div className="act-msg-main">
                    {m.replyTo && !recalled && (
                      <button className="act-replybar" onClick={() => jumpToMessage(m.replyTo.messageId)}>
                        ↪ 回复 {m.replyTo.userName}：{m.replyTo.contentPreview || '…'}
                      </button>
                    )}
                    <div className="act-msg-meta">
                      <span className="act-msg-nick">{m.nickname}</span>
                      {author && <span className="act-msg-badge">发起人</span>}
                      <span className="act-msg-time">{formatTime(m.createdAt)}</span>
                    </div>
                    {recalled ? (
                      <div className="act-msg-content act-msg-recalled">该消息已撤回</div>
                    ) : m.type === 'sticker' ? (
                      <div className="act-msg-content"><img className="act-sticker" src={m.content} alt="表情包" /></div>
                    ) : (
                      <div className="act-msg-content">{m.content}</div>
                    )}
                    {m.pending === 'sending' && <span className="act-msg-pending">发送中…</span>}
                    {m.pending === 'failed' && <button className="act-msg-retry" onClick={() => retry(m)}>发送失败，点击重试</button>}

                    {!isTemp && !recalled && Object.keys(m.reactions || {}).length > 0 && (
                      <div className="act-reactions">
                        {Object.entries(m.reactions).map(([emoji, userIds]) => (
                          <button key={emoji} className={'act-react-chip' + (userIds.includes(user?.id) ? ' mine' : '')} onClick={() => react(m, emoji)}>
                            {emoji} {userIds.length}
                          </button>
                        ))}
                      </div>
                    )}

                    {!isTemp && !recalled && mine && m.readBy?.length > 0 && (
                      <button className="act-readcount" onClick={() => showReads(m)}>已读 {m.readBy.length} 人</button>
                    )}

                    {!isTemp && !recalled && (
                      <div className="act-msg-actions">
                        <button onClick={() => setReactFor(m.id)} title="表情回应">😀</button>
                        <button onClick={() => startReply(m)} title="回复">↩️</button>
                        {canRecall && <button onClick={() => recall(m)} title="撤回">🗑️</button>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 输入区 */}
          {!user ? (
            <div className="act-composer-lock">请先登录后加入活动发言</div>
          ) : isTerminal ? (
            <div className="act-composer-lock">活动已{STATUS_LABELS[post.status]}，全员只读</div>
          ) : !canSpeak ? (
            <div className="act-composer-lock">
              <span>加入活动后即可发言</span>
              {post?.status === 'open' && <button className="btn primary" onClick={join} disabled={joinLoading}>{joinLoading ? '加入中…' : '报名 / 加入'}</button>}
            </div>
          ) : (
            <div className="act-composer">
              {replyTo && (
                <div className="act-replypreview">
                  <span>回复 @{replyTo.userName}：{replyTo.contentPreview || '…'}</span>
                  <button onClick={() => setReplyTo(null)} aria-label="取消回复">×</button>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="说点什么…（Enter 发送，Shift+Enter 换行；@ 提及成员）"
                maxLength={500}
                rows={1}
              />
              <div className="act-composer-bar">
                <button className="act-tool-btn" onClick={() => setMentionOpen((v) => !v)} title="提及成员">@ 提及</button>
                <button className="act-tool-btn" onClick={() => { setPickerTab('emoji'); setPickerOpen(true); }} title="表情/表情包">😊 表情</button>
                <span className="act-composer-spacer" />
                <button className="btn primary" onClick={send} disabled={!draft.trim()}>发送</button>
              </div>

              {mentionOpen && (
                <div className="act-mention-pop">
                  {filteredMembers.length === 0 && <div className="act-mention-empty">无匹配成员</div>}
                  {filteredMembers.map((mem) => (
                    <button key={mem.userId} className="act-mention-item" onClick={() => pickMention(mem)}>
                      <span>{mem.avatar}</span>
                      <span className="act-mention-name">{mem.userName}</span>
                      {mem.isAdmin && <span className="act-admin-badge">管理员</span>}
                      {isOnline(mem.userId) && <span className="act-online-text">在线</span>}
                    </button>
                  ))}
                </div>
              )}

              {pickerOpen && (
                <div className="act-sticker-drawer">
                  <div className="act-sticker-tabs">
                    <button className={pickerTab === 'emoji' ? 'active' : ''} onClick={() => setPickerTab('emoji')}>系统 emoji</button>
                    <button className={pickerTab === 'mine' ? 'active' : ''} onClick={() => setPickerTab('mine')}>我的表情包</button>
                    <button className={pickerTab === 'upload' ? 'active' : ''} onClick={() => setPickerTab('upload')}>上传</button>
                    <button className="act-sticker-close" onClick={() => setPickerOpen(false)}>×</button>
                  </div>
                  {pickerTab === 'emoji' && (
                    <div className="act-emoji-grid">
                      {SYSTEM_EMOJIS.map((e) => <button key={e} onClick={() => sendText(e)}>{e}</button>)}
                    </div>
                  )}
                  {pickerTab === 'mine' && (
                    <div className="act-sticker-grid">
                      {stickers.length === 0 && <div className="act-mention-empty">暂无表情包，去「上传」添加</div>}
                      {stickers.map((s) => <img key={s.id} src={s.url} alt="表情包" onClick={() => sendSticker(s.url)} />)}
                    </div>
                  )}
                  {pickerTab === 'upload' && (
                    <div className="act-upload">
                      <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => upload(e.target.files?.[0])} />
                      {uploading && <div className="act-upload-msg">上传中…</div>}
                      {uploadMsg && <div className="act-upload-msg">{uploadMsg}</div>}
                      <div className="act-upload-hint">支持 png/jpg/gif/webp，单张 ≤ 2MB，每人最多 50 张</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* 表情回应选择 */}
      {reactFor && (
        <div className="act-pop-overlay" onClick={() => setReactFor(null)}>
          <div className="act-react-pop" onClick={(e) => e.stopPropagation()}>
            {PRESET_EMOJIS.map((e) => {
              const m = messages.find((x) => x.id === reactFor);
              return (
                <button key={e} onClick={() => { react(m, e); setReactFor(null); }}>{e}</button>
              );
            })}
          </div>
        </div>
      )}

      {/* 已读名单 */}
      {readListFor && (
        <div className="act-pop-overlay" onClick={() => setReadListFor(null)}>
          <div className="act-reads-card" onClick={(e) => e.stopPropagation()}>
            <div className="act-reads-head">已读成员 <button onClick={() => setReadListFor(null)}>×</button></div>
            {readListLoading && <div className="act-mention-empty">加载中…</div>}
            {!readListLoading && readList.length === 0 && <div className="act-mention-empty">暂无已读</div>}
            {readList.map((r) => <div key={r.id} className="act-reads-item">{r.avatar} {r.nickname}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
