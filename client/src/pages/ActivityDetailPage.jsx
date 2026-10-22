import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { socket } from '../socket.js';
import { useUser } from '../UserContext.jsx';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

// 用服务端真实消息替换本地乐观插入的临时消息（按 clientId 匹配）
function replaceTemp(prev, clientId, message) {
  const idx = prev.findIndex((m) => m.clientId === clientId);
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = message;
    return next;
  }
  return prev.some((m) => m.id === message.id) ? prev : [...prev, message];
}

// 合并实时消息：去重（自己已确认的消息不再重复渲染）+ 用真实消息替换自己的临时消息
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

export default function ActivityDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();

  const [post, setPost] = useState(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [isJoined, setIsJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const [draft, setDraft] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);

  const listRef = useRef(null);
  const nearBottomRef = useRef(true);
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

  // 拉取活动详情（含参与者 + 当前用户是否已加入）
  useEffect(() => {
    let active = true;
    setError('');
    api
      .post(id, user?.id)
      .then((detail) => {
        if (!active) return;
        setPost(detail.post);
        setParticipantCount(detail.participantCount || 0);
        setIsJoined(!!detail.isJoined);
      })
      .catch((e) => {
        if (active) setError(e.message || '加载失败');
      });
    return () => {
      active = false;
    };
  }, [id, user?.id]);

  // 拉取历史消息 + 加入活动房间 + 实时接收
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
    socket.on('message:new', onNew);

    return () => {
      active = false;
      socket.off('message:new', onNew);
      socket.emit('leave:post', { postId: id });
    };
  }, [id]);

  // 初次加载完成后滚到底部
  useEffect(() => {
    if (!loading) scrollToBottom(true);
  }, [loading]);

  // 新消息到达：仅在接近底部时跟随（向上翻历史时不强制拉回）
  useEffect(() => {
    if (!loading && messages.length > 0) scrollToBottom(false);
  }, [messages.length, loading]);

  const sendContent = (text, clientId) => {
    if (!user || !post) return;
    const temp = {
      clientId,
      pending: 'sending',
      content: text,
      userId: user.id,
      nickname: user.nickname,
      avatar: user.avatar,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, temp]);
    scrollToBottom(true);

    const payload = { postId: post.id, channelId: post.channelId, userId: user.id, content: text };
    const ok = (msg) => setMessages((prev) => replaceTemp(prev, clientId, msg));
    const fail = () =>
      setMessages((prev) => prev.map((m) => (m.clientId === clientId ? { ...m, pending: 'failed' } : m)));

    if (socket.connected) {
      socket.emit('message:send', payload, (ack) => {
        if (ack && ack.ok && ack.message) ok(ack.message);
        else fail();
      });
    } else {
      api.sendPostMessage(post.id, { userId: user.id, content: text }).then(ok).catch(fail);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    sendContent(text, `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  };

  const retry = (msg) => {
    setMessages((prev) => prev.filter((m) => m.clientId !== msg.clientId));
    sendContent(msg.content, `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  };

  const onKeyDown = (e) => {
    // Enter 发送；Shift+Enter 交给默认行为换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const join = async () => {
    if (!user || !post) return;
    setJoinLoading(true);
    try {
      const r = await api.joinPost(post.id, { userId: user.id });
      setIsJoined(true);
      setParticipantCount(r.participantCount);
    } catch (e) {
      setError(e.message || '加入失败');
    } finally {
      setJoinLoading(false);
    }
  };

  const isAuthor = post ? post.userId === user?.id : false;
  const canSpeak = !!(user && (isAuthor || isJoined));

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
        {/* A. 活动信息区（可折叠，避免挤占频道区） */}
        <aside className={'act-info' + (infoCollapsed ? ' collapsed' : '')}>
          {infoCollapsed ? (
            <button className="act-info-summary" onClick={() => setInfoCollapsed(false)} title="展开活动信息">
              <span className="act-info-chevron">▸</span>
              <span className="act-info-title">{post?.title || '…'}</span>
              <span className="act-info-count">👥 {participantCount}</span>
            </button>
          ) : (
            <>
              <div className="act-info-head">
                {post?.category && <span className="post-category">{post.category}</span>}
                <button
                  className="act-info-collapse"
                  onClick={() => setInfoCollapsed(true)}
                  title="收起信息"
                  aria-label="收起信息"
                >
                  ▾
                </button>
              </div>
              <h2 className="act-info-title">{post?.title}</h2>
              <div className="act-info-meta">
                <div className="act-info-row"><span className="act-info-label">发起人</span><span>{post?.avatar || '🎓'} {post?.nickname}</span></div>
                <div className="act-info-row"><span className="act-info-label">时间</span><span>{formatTime(post?.createdAt)}</span></div>
                <div className="act-info-row"><span className="act-info-label">形式</span><span>{post?.category || '未分类'}</span></div>
                <div className="act-info-row"><span className="act-info-label">参与</span><span>{participantCount} 人</span></div>
              </div>
              {post?.content && <p className="act-info-desc">{post.content}</p>}
              <div className="act-info-join">
                {isAuthor ? (
                  <span className="act-info-status">✅ 我是发起人</span>
                ) : isJoined ? (
                  <span className="act-info-status">✅ 已加入，可参与讨论</span>
                ) : (
                  <button className="btn primary" onClick={join} disabled={joinLoading || !user}>
                    {joinLoading ? '加入中…' : '报名 / 加入'}
                  </button>
                )}
              </div>
            </>
          )}
        </aside>

        {/* B. 频道区（消息流，主体） */}
        <section className="act-channel">
          <div className="act-messages" ref={listRef} onScroll={onListScroll}>
            {loading && <div className="act-empty">加载中…</div>}
            {!loading && messages.length === 0 && (
              <div className="act-empty">频道还很安静，来发第一条消息吧～</div>
            )}
            {messages.map((m) => {
              const mine = m.userId === user?.id;
              const author = post && m.userId === post.userId;
              return (
                <div
                  key={m.clientId || m.id}
                  className={'act-msg' + (mine ? ' mine' : '') + (m.pending === 'failed' ? ' failed' : '')}
                >
                  <div className="act-msg-avatar">{m.avatar || '🎓'}</div>
                  <div className="act-msg-main">
                    <div className="act-msg-meta">
                      <span className="act-msg-nick">{m.nickname}</span>
                      {author && <span className="act-msg-badge">发起人</span>}
                      <span className="act-msg-time">{formatTime(m.createdAt)}</span>
                    </div>
                    <div className="act-msg-content">{m.content}</div>
                    {m.pending === 'sending' && <span className="act-msg-pending">发送中…</span>}
                    {m.pending === 'failed' && (
                      <button className="act-msg-retry" onClick={() => retry(m)}>发送失败，点击重试</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 输入区（吸底）：参与者可发言，其他人只读 */}
          {!user ? (
            <div className="act-composer-lock">请先登录后加入活动发言</div>
          ) : !canSpeak ? (
            <div className="act-composer-lock">
              <span>加入活动后即可发言</span>
              <button className="btn primary" onClick={join} disabled={joinLoading}>
                {joinLoading ? '加入中…' : '报名 / 加入'}
              </button>
            </div>
          ) : (
            <div className="act-composer">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"
                maxLength={500}
                rows={1}
              />
              <button className="btn primary" onClick={send} disabled={!draft.trim()}>发送</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
