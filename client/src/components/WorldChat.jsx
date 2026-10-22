import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { socket } from '../socket.js';
import { useUser } from '../UserContext.jsx';

// 底部中央的「世界频道」：全局聊天，所有同学可见（Socket.IO 实时）
export default function WorldChat({ collapsible = false, collapsed = false, onToggleCollapse }) {
  const { user } = useUser();
  const [channel, setChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const channelRef = useRef(null);
  const listRef = useRef(null);

  // 取世界频道
  useEffect(() => {
    let active = true;
    api
      .world()
      .then(({ channel }) => {
        if (active) setChannel(channel);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // 加载历史消息 + 加入 socket 房间
  useEffect(() => {
    if (!channel) return;
    let active = true;
    channelRef.current = channel.id;
    setLoading(true);
    setMessages([]);
    setError('');

    api
      .messages(channel.id)
      .then((msgs) => {
        if (active) {
          setMessages(msgs);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    socket.emit('join:channel', { channelId: channel.id });
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
      socket.emit('leave:channel', { channelId: channel.id });
    };
  }, [channel?.id]);

  // 自动滚到底部
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text || !user || !channel) return;
    setError('');
    if (socket.connected) {
      socket.emit('message:send', { channelId: channel.id, userId: user.id, content: text }, (ack) => {
        if (ack && !ack.ok) setError(ack.error || '发送失败');
      });
    } else {
      api
        .sendMessage(channel.id, { userId: user.id, content: text })
        .then((m) => setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m])))
        .catch((e) => setError(e.message || '发送失败'));
    }
    setInput('');
  };

  const isCollapsed = collapsible && collapsed;

  return (
    <div className={'hud-panel world-chat' + (isCollapsed ? ' collapsed' : '')}>
      <div
        className="wc-head"
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? !collapsed : undefined}
        onClick={collapsible ? onToggleCollapse : undefined}
        onKeyDown={collapsible ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCollapse(); } } : undefined}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>🌐 世界频道</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>· 全校在线</span>
        {error && <span style={{ fontSize: 11, color: '#fca5a5', marginLeft: 'auto' }}>{error}</span>}
        {collapsible && <span className="wc-chevron" style={{ marginLeft: 'auto' }}>{collapsed ? '▲' : '▼'}</span>}
      </div>

      <div className="wc-messages" ref={listRef}>
        {loading && <div className="wc-line" style={{ color: 'var(--muted)' }}>加载中…</div>}
        {!loading && messages.length === 0 && (
          <div className="wc-line" style={{ color: 'var(--muted)' }}>世界频道还很安静，来打个招呼吧～</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="wc-line">
            <span className="who">{m.nickname}</span>：{m.content}
          </div>
        ))}
      </div>

      <form
        className="wc-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="和全校同学说点什么…"
          maxLength={500}
        />
        <button type="submit" className="hud-btn" disabled={!input.trim()}>发送</button>
      </form>
    </div>
  );
}
