import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { socket } from '../socket.js';
import { useUser } from '../UserContext.jsx';

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

// 会话维度的 API 抽象：activity / chat 共用同一套组件逻辑
const API_BY_TYPE = {
  activity: {
    list: (id) => api.postMessages(id),
    send: (id, body) => api.sendPostMessage(id, body),
    recall: (id, mid, body) => api.recallMessage(id, mid, body),
    react: (id, mid, body) => api.reactMessage(id, mid, body),
    reads: (id, mid) => api.messageReads(id, mid),
    markRead: (id, body) => api.markRead(id, body),
  },
  chat: {
    list: (id) => api.messages(id),
    send: (id, body) => api.sendMessage(id, body),
    recall: (id, mid, body) => api.recallChannelMessage(id, mid, body),
    react: (id, mid, body) => api.reactChannelMessage(id, mid, body),
    reads: (id, mid) => api.channelMessageReads(id, mid),
    markRead: (id, body) => api.markChannelRead(id, body),
  },
  direct: {
    list: (id) => api.conversationMessages(id),
    send: (id, body) => api.sendConversationMessage(id, body),
    recall: (id, mid, body) => api.recallConversationMessage(id, mid, body),
    react: (id, mid, body) => api.reactConversationMessage(id, mid, body),
    reads: (id, mid) => api.conversationMessageReads(id, mid),
    markRead: (id, body) => api.markConversationRead(id, body),
  },
  group: {
    list: (id) => api.conversationMessages(id),
    send: (id, body) => api.sendConversationMessage(id, body),
    recall: (id, mid, body) => api.recallConversationMessage(id, mid, body),
    react: (id, mid, body) => api.reactConversationMessage(id, mid, body),
    reads: (id, mid) => api.conversationMessageReads(id, mid),
    markRead: (id, body) => api.markConversationRead(id, body),
  },
  task: {
    list: (id) => api.taskMessages(id),
    send: (id, body) => api.sendTaskMessage(id, body),
    recall: (id, mid, body) => api.recallTaskMessage(id, mid, body),
    react: (id, mid, body) => api.reactTaskMessage(id, mid, body),
    reads: (id, mid) => api.taskMessageReads(id, mid),
    markRead: (id, body) => api.markTaskRead(id, body),
  },
};

export default function ChatChannel({
  conversationType = 'activity',
  conversationId,
  canSpeak,
  lockMessage,
  onJoin,
  members = [],
  authorUserId,
  isAdmin = false,
}) {
  const { user } = useUser();

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [online, setOnline] = useState([]);
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
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [ctxMenu, setCtxMenu] = useState(null);

  const listRef = useRef(null);
  const nearBottomRef = useRef(true);
  const textareaRef = useRef(null);
  const longPressTimer = useRef(null);
  const userRef = useRef(user);
  userRef.current = user;

  const apiFor = API_BY_TYPE[conversationType] || API_BY_TYPE.activity;
  const isActivity = conversationType === 'activity';

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

  // 我的表情包
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    api.stickers(user.id).then((s) => active && setStickers(s || [])).catch(() => {});
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

    apiFor
      .list(conversationId)
      .then((msgs) => active && setMessages(msgs || []))
      .catch(() => active && setMessages([]))
      .finally(() => active && setLoading(false));

    // 加入会话房间（presence 由下方按 user 单独加入）
    socket.emit('join:conv', { conversationType, conversationId });

    const onNew = (payload) => {
      if (!active) return;
      if (payload && payload.conversationType === conversationType && Number(payload.conversationId) === Number(conversationId) && payload.message) {
        setMessages((prev) => mergeIncoming(prev, payload.message, userRef.current?.id));
      }
    };
    const onReaction = (payload) => {
      if (active && payload && payload.conversationType === conversationType && Number(payload.conversationId) === Number(conversationId)) {
        setMessages((prev) => mergeReaction(prev, payload.messageId, payload.reactions));
      }
    };
    const onRecalled = (payload) => {
      if (active && payload && payload.conversationType === conversationType && Number(payload.conversationId) === Number(conversationId)) {
        setMessages((prev) => mergeRecalled(prev, payload.messageId));
      }
    };
    const onPresence = (payload) => {
      if (!active) return;
      const pid = payload?.conversationId ?? payload?.postId ?? payload?.channelId;
      if (Number(pid) === Number(conversationId)) setOnline(payload.online || []);
    };

    socket.on('message:new', onNew);
    socket.on('message:reaction', onReaction);
    socket.on('message:recalled', onRecalled);
    socket.on('presence:update', onPresence);

    return () => {
      active = false;
      socket.off('message:new', onNew);
      socket.off('message:reaction', onReaction);
      socket.off('message:recalled', onRecalled);
      socket.off('presence:update', onPresence);
      socket.emit('leave:conv', { conversationType, conversationId });
    };
  }, [conversationType, conversationId]);

  // 在线成员：以 userId 加入房间（presence 追踪）
  useEffect(() => {
    if (!user?.id) return undefined;
    socket.emit('join:conv', { conversationType, conversationId });
    return () => {
      socket.emit('leave:conv', { conversationType, conversationId });
    };
  }, [conversationType, conversationId, user?.id]);

  // 初次加载后滚到底
  useEffect(() => {
    if (!loading) scrollToBottom(true);
  }, [loading]);

  // 新消息到达：仅接近底部时跟随
  useEffect(() => {
    if (!loading && messages.length > 0) scrollToBottom(false);
  }, [messages.length, loading]);

  // 标记已读：接近底部时把最后一条（含之前）标为已读（服务端校验权限，访客 403 静默忽略）
  useEffect(() => {
    if (loading || !user || !nearBottomRef.current) return;
    const lastWithId = [...messages].reverse().find((m) => m.id != null);
    if (!lastWithId) return;
    apiFor.markRead(conversationId, { userId: user.id, upToMessageId: lastWithId.id }).catch(() => {});
  }, [messages.length, loading, conversationType, conversationId, user?.id]);

  const sendContent = (text, clientId, opts = {}) => {
    if (!user) return;
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
      userId: user.id,
      content: text,
      type: opts.type || 'text',
      replyTo: opts.replyTo || null,
      mentions: opts.mentions || [],
      conversationType,
      conversationId,
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
      apiFor.send(conversationId, { userId: user.id, content: text, type: opts.type, replyTo: opts.replyTo, mentions: opts.mentions }).then(ok).catch(fail);
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
      await apiFor.recall(conversationId, m.id, { userId: user.id });
      setMessages((prev) => mergeRecalled(prev, m.id));
    } catch (e) {
      setError(e.message || '撤回失败');
    }
  };

  const react = async (m, emoji) => {
    if (!user || !m.id) return;
    try {
      const r = await apiFor.react(conversationId, m.id, { userId: user.id, emoji });
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
      setReadList((await apiFor.reads(conversationId, m.id)) || []);
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

  const isOnline = (userId) => online.some((o) => o.userId === userId);
  // @ 列表：有成员列表（活动）用成员列表；否则（聊天）回退到在线成员
  const mentionMembers = members.length > 0 ? members : online;
  const filteredMembers = mentionOpen
    ? mentionMembers.filter((m) => !mentionQuery || m.userName.includes(mentionQuery)).sort((a, b) => Number(isOnline(b.userId)) - Number(isOnline(a.userId)))
    : [];

  // 撤回权限：管理员不限时且可撤他人；自己 2 分钟内可撤
  const isRecallable = (m) =>
    !!(m && !m.pending && m.type !== 'recalled' && m.type !== 'system' &&
      (isAdmin || (m.userId === user?.id && Date.now() - new Date(m.createdAt).getTime() < 2 * 60 * 1000)));

  const copyMessage = async (m) => {
    try {
      await navigator.clipboard.writeText(m.content || '');
    } catch {
      /* 忽略剪贴板失败 */
    }
  };

  const openCtxMenu = (m, x, y) => {
    if (!m || m.pending || m.type === 'recalled' || m.type === 'system') return;
    setCtxMenu({ messageId: m.id, x, y });
  };

  return (
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
          const author = authorUserId != null && m.userId === authorUserId;
          const recalled = m.type === 'recalled';
          const isTemp = !!m.pending;
          const mentionsMe = m.mentions?.some((x) => x.userId === user?.id);
          const canRecall = !isTemp && !recalled && (isAdmin || (mine && Date.now() - new Date(m.createdAt).getTime() < 2 * 60 * 1000));

          return (
            <div
              key={m.clientId || m.id}
              id={m.id != null ? `msg-${m.id}` : undefined}
              className={'act-msg' + (mine ? ' mine' : '') + (mentionsMe ? ' mention-me' : '') + (m.pending === 'failed' ? ' failed' : '')}
              onDoubleClick={(e) => {
                e.preventDefault();
                if (!recalled && !isTemp && canSpeak) startReply(m);
              }}
              onContextMenu={(e) => { e.preventDefault(); openCtxMenu(m, e.clientX, e.clientY); }}
              onTouchStart={(e) => { longPressTimer.current = setTimeout(() => openCtxMenu(m, e.touches[0].clientX, e.touches[0].clientY), 500); }}
              onTouchEnd={() => clearTimeout(longPressTimer.current)}
              onTouchMove={() => clearTimeout(longPressTimer.current)}
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

                {canSpeak && !isTemp && !recalled && (
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
        <div className="act-composer-lock">请先登录后发言</div>
      ) : !canSpeak ? (
        <div className="act-composer-lock">
          <span>{lockMessage || '暂无发言权限'}</span>
          {onJoin && <button className="btn primary" onClick={onJoin}>报名 / 加入</button>}
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

      {/* 表情回应选择 */}
      {reactFor && (
        <div className="act-pop-overlay" onClick={() => setReactFor(null)}>
          <div className="act-react-pop" onClick={(e) => e.stopPropagation()}>
            {PRESET_EMOJIS.map((e) => {
              const m = messages.find((x) => x.id === reactFor);
              return <button key={e} onClick={() => { if (m) react(m, e); setReactFor(null); }}>{e}</button>;
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

      {/* 长按 / 右键操作面板 */}
      {ctxMenu && (
        <div className="act-ctx-overlay" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}>
          <div className="act-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setReactFor(ctxMenu.messageId); setCtxMenu(null); }}>😀 回应</button>
            <button onClick={() => { const m = messages.find((x) => x.id === ctxMenu.messageId); if (m) startReply(m); setCtxMenu(null); }}>↩️ 回复</button>
            {(() => { const m = messages.find((x) => x.id === ctxMenu.messageId); return isRecallable(m) ? <button onClick={() => { if (m) recall(m); setCtxMenu(null); }}>🗑️ 撤回</button> : null; })()}
            <button onClick={() => { const m = messages.find((x) => x.id === ctxMenu.messageId); if (m) copyMessage(m); setCtxMenu(null); }}>📋 复制</button>
          </div>
        </div>
      )}
    </section>
  );
}
