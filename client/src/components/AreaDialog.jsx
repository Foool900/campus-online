import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { socket } from '../socket.js';
import { useUser } from '../UserContext.jsx';
import PostEditor from './PostEditor.jsx';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

const STATUS_LABELS = { draft: '草稿', open: '报名中', ongoing: '进行中', ended: '已结束', cancelled: '已取消' };

export default function AreaDialog({ area, onClose }) {
  const { user } = useUser();
  const navigate = useNavigate();
  const [zone, setZone] = useState('activity');
  const [channel, setChannel] = useState(null);
  const [showEditor, setShowEditor] = useState(false);

  // 聊天区状态
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(true);
  const [sendError, setSendError] = useState('');

  // 活动区状态
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(true);

  const channelRef = useRef(null);
  const listRef = useRef(null);

  // 加载频道 + 历史消息 + 加入 socket 房间
  useEffect(() => {
    let active = true;
    channelRef.current = null;
    setMessages([]);
    setChatLoading(true);
    setSendError('');

    (async () => {
      try {
        const chans = await api.channels(area.id);
        if (!chans.length) {
          if (active) setChatLoading(false);
          return;
        }
        const ch = chans[0];
        if (!active) return;
        setChannel(ch);
        channelRef.current = ch.id;

        const msgs = await api.messages(ch.id);
        if (!active) return;
        setMessages(msgs);
        setChatLoading(false);
        socket.emit('join:channel', { channelId: ch.id });
      } catch (e) {
        if (active) setChatLoading(false);
      }
    })();

    const onNew = (payload) => {
      if (payload && payload.channelId === channelRef.current) {
        setMessages((prev) =>
          prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]
        );
      }
    };
    socket.on('message:new', onNew);

    return () => {
      active = false;
      socket.off('message:new', onNew);
      if (channelRef.current) socket.emit('leave:channel', { channelId: channelRef.current });
    };
  }, [area.id]);

  // 加载活动帖（带 userId 获取卡片聚合：在线数/未读数/@我/回复我）
  useEffect(() => {
    if (!channel) return;
    setPostsLoading(true);
    api
      .posts(channel.id, user?.id)
      .then(setPosts)
      .catch(() => {})
      .finally(() => setPostsLoading(false));
  }, [channel?.id, user?.id]);

  // 聊天自动滚到底部
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, zone]);

  const send = () => {
    const text = input.trim();
    if (!text || !user || !channel) return;
    setSendError('');
    if (socket.connected) {
      socket.emit('message:send', { channelId: channel.id, userId: user.id, content: text }, (ack) => {
        if (ack && !ack.ok) setSendError(ack.error || '发送失败');
      });
    } else {
      api
        .sendMessage(channel.id, { userId: user.id, content: text })
        .then((m) => setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m])))
        .catch((e) => setSendError(e.message || '发送失败'));
    }
    setInput('');
  };

  const handlePublished = (post) => {
    setPosts((prev) => [post, ...prev]);
    setShowEditor(false);
  };

  return (
    <div className="chat-drawer area-dialog">
      <div className="chat-header">
        <div>
          <h3>
            {area.emoji} {area.name} · {channel ? channel.name : '加载中…'}
          </h3>
          <p className="chat-desc">{area.description}</p>
        </div>
        <button className="chat-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <div className="zone-tabs">
        <button className={'zone-tab' + (zone === 'activity' ? ' active' : '')} onClick={() => setZone('activity')}>
          📌 活动区
        </button>
        <button className={'zone-tab' + (zone === 'chat' ? ' active' : '')} onClick={() => setZone('chat')}>
          💬 聊天区
        </button>
      </div>

      {zone === 'activity' ? (
        <div className="zone-body activity-zone">
          {postsLoading && <div className="chat-empty">加载中…</div>}
          {!postsLoading && posts.length === 0 && (
            <div className="chat-empty">还没有活动帖，点右下角「+」发布第一篇～</div>
          )}
          {posts.map((p) => (
            <div
              key={p.id}
              className="post-card post-card-link"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/activity/${p.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/activity/${p.id}`);
                }
              }}
              title="查看活动详情"
            >
              <div className="post-head">
                <span className="post-category">{p.category}</span>
                <span className="post-title">{p.title}</span>
                {p.status && <span className={'status-badge status-' + p.status}>{STATUS_LABELS[p.status] || p.status}</span>}
                <span className="post-card-arrow">›</span>
              </div>
              {p.content && <div className="post-content">{p.content}</div>}
              {p.recentMessages?.length > 0 && (
                <div className="post-recent">
                  {p.recentMessages.map((rm, i) => (
                    <div key={i} className="post-recent-line">
                      <span className="post-recent-nick">{rm.nickname}</span>：{rm.content}
                    </div>
                  ))}
                </div>
              )}
              <div className="post-meta">
                <span>
                  {p.avatar || '🎓'} {p.nickname}
                </span>
                {p.userId === user?.id && <span className="act-admin-badge">管理员</span>}
                <span>{formatTime(p.createdAt)}</span>
                <span className="post-meta-spacer" />
                {p.onlineCount > 0 && <span className="post-online">● {p.onlineCount} 在线</span>}
                {p.unreadCount > 0 && <span className="post-unread">{p.unreadCount} 未读</span>}
                {(p.hasMentionMe || p.hasReplyMe) && <span className="post-dot" title={p.hasMentionMe ? '有人 @ 我' : '有人回复我'} />}
              </div>
            </div>
          ))}
          <button className="fab" onClick={() => setShowEditor(true)} aria-label="发布活动帖">
            ＋
          </button>
        </div>
      ) : (
        <div className="zone-body chat-zone">
          <div className="chat-messages" ref={listRef}>
            {chatLoading && <div className="chat-empty">加载中…</div>}
            {!chatLoading && messages.length === 0 && <div className="chat-empty">还没有消息，来抢沙发吧～</div>}
            {messages.map((m) => (
              <div key={m.id} className={'msg' + (m.userId === user?.id ? ' mine' : '')}>
                <div className="msg-avatar">{m.avatar || '🎓'}</div>
                <div className="msg-body">
                  <div className="msg-meta">
                    <span className="msg-nick">{m.nickname}</span>
                    <span className="msg-time">{formatTime(m.createdAt)}</span>
                  </div>
                  <div className="msg-content">{m.content}</div>
                </div>
              </div>
            ))}
          </div>
          {sendError && <div className="chat-send-error">{sendError}</div>}
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`在「${area.name}」频道说点什么…`}
              maxLength={500}
            />
            <button type="submit" className="btn primary" disabled={!input.trim()}>
              发送
            </button>
          </form>
        </div>
      )}

      {showEditor && channel && (
        <PostEditor channel={channel} onClose={() => setShowEditor(false)} onPublished={handlePublished} />
      )}
    </div>
  );
}
