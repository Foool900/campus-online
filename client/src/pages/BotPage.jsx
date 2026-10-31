import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

const WELCOME = '你好呀，我是 Ala ✨\n我会从社区的精华帖、常见问题和规则里帮你找答案，不会瞎编～\n也可以跟我随便聊聊哦。';

export default function BotPage() {
  const { user } = useUser();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [webMode, setWebMode] = useState(false);
  const listRef = useRef(null);
  const idSeq = useRef(0);

  useEffect(() => {
    api.botStatus().then(setStatus).catch(() => {});
    api
      .botHistory()
      .then((rows) => {
        const msgs = [];
        [...rows].reverse().forEach((r) => {
          msgs.push({ id: idSeq.current++, role: 'user', text: r.question });
          msgs.push({ id: idSeq.current++, role: 'bot', text: r.answer, sources: r.sources || [] });
        });
        if (msgs.length === 0) msgs.push({ id: idSeq.current++, role: 'bot', text: WELCOME });
        setMessages(msgs);
      })
      .catch(() => setMessages([{ id: idSeq.current++, role: 'bot', text: WELCOME }]));
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function send(e) {
    e?.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setMessages((m) => [...m, { id: idSeq.current++, role: 'user', text: q }]);
    setLoading(true);
    setError('');
    try {
      const r = await api.botAsk({ question: q, web: webMode });
      if (typeof r.ollamaUp === 'boolean') setStatus((s) => ({ ...(s || {}), ollamaUp: r.ollamaUp }));
      setMessages((m) => [
        ...m,
        { id: idSeq.current++, role: 'bot', text: r.answer, sources: r.sources || [], degraded: r.degraded },
      ]);
    } catch (err) {
      setError(err.message || '提问失败');
      setMessages((m) => [
        ...m,
        { id: idSeq.current++, role: 'bot', text: '抱歉，提问失败：' + (err.message || '未知错误'), degraded: true },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function rebuild() {
    setError('');
    try {
      const r = await api.botRebuild();
      setStatus((s) => ({ ...(s || {}), chunks: r.chunks }));
    } catch (err) {
      setError(err.message || '重建失败');
    }
  }

  const offline = status && status.ollamaUp === false;

  return (
    <div className="page bot-page">
      <div className="page-head bot-head">
        <h1>✨ Ala</h1>
        <p>校园里的小助手 · 社区问题帮你查，也能陪你聊天</p>
        {status && (
          <div className="bot-meta">
            {offline ? <span className="bot-offline">● 本地模型离线</span> : <span className="bot-online">● 知识库在线</span>}
            {status.chunks > 0 && <span>· {status.chunks} 条资料</span>}
            {user?.role === 'admin' && (
              <button type="button" className="hud-btn bot-rebuild" onClick={rebuild}>
                重建知识库
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="bot-messages" ref={listRef}>
        {messages.map((m) => (
          <div key={m.id} className={'bot-msg ' + m.role}>
            <div className="bot-msg-role">{m.role === 'user' ? '你' : 'Ala'}</div>
            <div className="bot-msg-text">{m.text}</div>
            {m.sources && m.sources.length > 0 && (
              <div className="bot-sources">
                {m.sources.map((s, i) => {
                  if (s.sourceType === 'post') {
                    return (
                      <Link key={i} className="bot-source" to={`/activity/${s.sourceRef}`}>
                        [来源{i + 1}] {s.title}
                      </Link>
                    );
                  }
                  if (s.sourceType === 'web' && s.url) {
                    return (
                      <a key={i} className="bot-source" href={s.url} target="_blank" rel="noopener noreferrer">
                        [来源{i + 1}] {s.title}
                      </a>
                    );
                  }
                  return (
                    <span key={i} className="bot-source">
                      [来源{i + 1}] {s.title}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="bot-msg bot">
            <div className="bot-msg-role">Ala</div>
            <div className="bot-msg-text bot-thinking">思考中…</div>
          </div>
        )}
      </div>

      <form className="bot-input" onSubmit={send}>
        <button
          type="button"
          className={'hud-btn bot-web-toggle' + (webMode ? ' active' : '')}
          onClick={() => setWebMode((v) => !v)}
          title={webMode ? '联网搜索：从网上搜答案' : '本地知识库：只从社区资料回答'}
        >
          🌐 联网搜索
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="问点社区里的事，例如：如何重置数据库？"
          maxLength={500}
          disabled={loading}
        />
        <button type="submit" className="hud-btn" disabled={loading || !input.trim()}>
          发送
        </button>
      </form>
    </div>
  );
}
