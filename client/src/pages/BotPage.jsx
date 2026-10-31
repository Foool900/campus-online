import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

const WELCOME = '你好，我是 Ala ✨\n有想问的尽管问我，或者点左侧「新建对话」创建一个专属角色～';

const CONV_ICON = { default: '🤖', preset: '🎭', custom: '✨' };

export default function BotPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [webMode, setWebMode] = useState(false);
  const [aiConfig, setAiConfig] = useState(null);
  const [cfgBaseUrl, setCfgBaseUrl] = useState('');
  const [cfgModel, setCfgModel] = useState('');
  const [cfgKey, setCfgKey] = useState('');
  const [cfgMode, setCfgMode] = useState('local');
  const [affinity, setAffinity] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [mood, setMood] = useState('');
  const [personas, setPersonas] = useState([]);
  const [view, setView] = useState('chat'); // chat | quiz | settings

  // 多会话
  const [conversations, setConversations] = useState([]);
  const [convId, setConvId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState('default'); // default | preset | custom
  const [newPresetKey, setNewPresetKey] = useState('ruanmeng');
  const [newTitle, setNewTitle] = useState('');
  const [newPersonaText, setNewPersonaText] = useState('');

  const listRef = useRef(null);
  const idSeq = useRef(0);

  useEffect(() => {
    api.botStatus().then(setStatus).catch(() => {});
    api.aiConfig().then((c) => { setAiConfig(c); setCfgMode(c.mode || 'local'); setCfgBaseUrl(c.baseUrl || ''); setCfgModel(c.model || ''); }).catch(() => {});
    api.botAffinity().then(setAffinity).catch(() => {});
    api.botQuiz().then(setQuiz).catch(() => {});
    api.botPersona().then((p) => { setMood(p.mood); setPersonas(p.personas || []); }).catch(() => {});
    api
      .botConversations()
      .then((list) => {
        setConversations(list);
        if (list.length > 0) selectConv(list[0].id);
      })
      .catch(() => setMessages([{ id: idSeq.current++, role: 'bot', text: WELCOME }]));
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function selectConv(id) {
    setConvId(id);
    setMessages([]);
    setLoading(false);
    setError('');
    try {
      const rows = await api.botConversationMessages(id);
      const msgs = [];
      [...rows].reverse().forEach((r) => {
        msgs.push({ id: idSeq.current++, role: 'user', text: r.question });
        msgs.push({ id: idSeq.current++, role: 'bot', text: r.answer, sources: r.sources || [] });
      });
      if (msgs.length === 0) msgs.push({ id: idSeq.current++, role: 'bot', text: WELCOME });
      setMessages(msgs);
    } catch {
      setMessages([{ id: idSeq.current++, role: 'bot', text: WELCOME }]);
    }
  }

  async function send(e) {
    e?.preventDefault();
    const q = input.trim();
    if (!q || loading || !convId) return;
    setInput('');
    setMessages((m) => [...m, { id: idSeq.current++, role: 'user', text: q }]);
    setLoading(true);
    setError('');
    try {
      const r = await api.botAsk({ question: q, web: webMode, conversationId: convId });
      if (typeof r.ollamaUp === 'boolean') setStatus((s) => ({ ...(s || {}), ollamaUp: r.ollamaUp }));
      if (r.affinity) setAffinity(r.affinity);
      setMessages((m) => [
        ...m,
        { id: idSeq.current++, role: 'bot', text: r.answer, sources: r.sources || [], degraded: r.degraded },
      ]);
    } catch (err) {
      setError(err.message || '提问失败');
      setMessages((m) => [...m, { id: idSeq.current++, role: 'bot', text: '抱歉，提问失败：' + (err.message || '未知错误'), degraded: true }]);
    } finally {
      setLoading(false);
    }
  }

  async function createConv() {
    setError('');
    try {
      const body = { personaType: newType };
      if (newType === 'preset') body.personaKey = newPresetKey;
      if (newType === 'custom') { body.title = newTitle; body.personaText = newPersonaText; }
      const c = await api.createBotConversation(body);
      const list = await api.botConversations();
      setConversations(list);
      setShowNew(false);
      setNewType('default');
      setNewPresetKey('ruanmeng');
      setNewTitle('');
      setNewPersonaText('');
      selectConv(c.id);
    } catch (err) {
      setError(err.message || '创建失败');
    }
  }

  async function deleteConv(id) {
    setError('');
    try {
      await api.deleteBotConversation(id);
      const list = await api.botConversations();
      setConversations(list);
      if (convId === id && list.length > 0) selectConv(list[0].id);
    } catch (err) {
      setError(err.message || '删除失败');
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

  async function saveAiConfig() {
    setError('');
    try {
      const r = await api.saveAiConfig({ mode: cfgMode, baseUrl: cfgBaseUrl.trim(), model: cfgModel.trim(), apiKey: cfgKey.trim() });
      setAiConfig((c) => ({ ...(c || {}), mode: r.mode, baseUrl: cfgBaseUrl.trim(), model: cfgModel.trim(), hasKey: r.hasKey, apiKeyMasked: r.apiKeyMasked }));
      setCfgKey('');
    } catch (err) {
      setError(err.message || '保存失败');
    }
  }

  async function clearAiConfig() {
    setError('');
    try {
      await api.clearAiConfig();
      setAiConfig({ mode: 'local', baseUrl: '', model: '', hasKey: false, apiKeyMasked: '' });
      setCfgMode('local');
      setCfgBaseUrl('');
      setCfgModel('');
      setCfgKey('');
    } catch (err) {
      setError(err.message || '清除失败');
    }
  }

  async function submitQuiz(idx) {
    setError('');
    try {
      const r = await api.botQuizAnswer({ answer: idx });
      setQuiz((q) => ({ ...q, answered: true, correct: r.correct, explain: r.explain, reward: r.reward }));
    } catch (err) {
      setError(err.message || '作答失败');
    }
  }

  const offline = status && status.ollamaUp === false;
  const currentConv = conversations.find((c) => c.id === convId);

  return (
    <div className="ala-page">
      {/* 左侧导航栏 */}
      <aside className="ala-sidebar">
        <div className="ala-logo">
          <span className="ala-logo-icon">✨</span>
          <div>
            <div className="ala-logo-name">Ala</div>
            <div className="ala-logo-sub">你的同班同学</div>
          </div>
        </div>

        <button className="ala-new-btn" onClick={() => setShowNew(true)}>＋ 新建对话</button>

        <nav className="ala-nav ala-conv-list">
          {conversations.map((c) => (
            <div key={c.id} className={'ala-nav-item' + (c.id === convId ? ' active' : '')} onClick={() => selectConv(c.id)}>
              <span className="ala-nav-icon">{CONV_ICON[c.personaType] || '🤖'}</span>
              <span className="ala-conv-title">{c.title}</span>
              {c.id === convId && (
                <button className="ala-conv-del" title="删除" onClick={(e) => { e.stopPropagation(); deleteConv(c.id); }}>×</button>
              )}
            </div>
          ))}
        </nav>

        <div className="ala-side-foot">
          {affinity && (
            <div className="ala-affinity">
              <span className="ala-affinity-ico">💖</span>
              <div className="ala-affinity-body">
                <div className="ala-affinity-label">{affinity.label}</div>
                <div className="ala-affinity-bar"><i style={{ width: `${affinity.nextLevelAt ? affinity.affinity % 100 : 100}%` }} /></div>
              </div>
            </div>
          )}
          <button className="ala-nav-item" onClick={() => navigate('/')}>← 返回地图</button>
        </div>
      </aside>

      {/* 右侧主区 */}
      <main className="ala-main">
        <header className="ala-head">
          <div className="ala-head-title">💬 {currentConv?.title || 'Ala'}</div>
          <div className="ala-head-chips">
            {mood && <span className="ala-chip">😊 {mood}</span>}
            {status && (offline ? <span className="ala-chip warn">● 离线</span> : <span className="ala-chip ok">● 在线</span>)}
            {aiConfig && <span className="ala-chip">{aiConfig.mode === 'cloud' && aiConfig.hasKey ? '☁️ ' + aiConfig.model : '🖥️ 本地模型'}</span>}
            <button type="button" className={'ala-chip ala-chip-btn' + (webMode ? ' on' : '')} onClick={() => setWebMode((v) => !v)} title={webMode ? '联网搜索中' : '只用本地知识库'}>
              🌐 联网{webMode ? '开' : '关'}
            </button>
            <button type="button" className={'ala-chip ala-chip-btn' + (view === 'quiz' ? ' on' : '')} onClick={() => { setView(view === 'quiz' ? 'chat' : 'quiz'); if (!quiz) api.botQuiz().then(setQuiz).catch(() => {}); }}>
              🎯 每日一题
            </button>
            <button type="button" className={'ala-chip ala-chip-btn' + (view === 'settings' ? ' on' : '')} onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}>
              ⚙️ 设置
            </button>
          </div>
        </header>

        {showNew && (
          <div className="ala-panel">
            <div className="ala-panel-title">新建对话 · 选择角色类型</div>
            <div className="ala-seg">
              <button type="button" className={'ala-seg-btn' + (newType === 'default' ? ' active' : '')} onClick={() => setNewType('default')}>🤖 百科机器人</button>
              <button type="button" className={'ala-seg-btn' + (newType === 'preset' ? ' active' : '')} onClick={() => setNewType('preset')}>🎭 预设人设</button>
              <button type="button" className={'ala-seg-btn' + (newType === 'custom' ? ' active' : '')} onClick={() => setNewType('custom')}>✨ 自定义角色</button>
            </div>
            {newType === 'preset' && (
              <div className="ala-seg">
                {personas.map((p) => (
                  <button key={p.key} type="button" className={'ala-seg-btn' + (newPresetKey === p.key ? ' active' : '')} onClick={() => setNewPresetKey(p.key)}>{p.name}</button>
                ))}
              </div>
            )}
            {newType === 'custom' && (
              <>
                <div className="ala-row">
                  <label>名字</label>
                  <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="给角色取个名字" maxLength={40} />
                </div>
                <textarea className="ala-textarea" value={newPersonaText} onChange={(e) => setNewPersonaText(e.target.value)} placeholder="写一段人设，例如：你是一只傲娇的猫，说话带点小脾气，但其实很关心我……" rows={3} maxLength={500} />
              </>
            )}
            <div className="ala-actions">
              <button type="button" className="ala-btn ghost" onClick={() => setShowNew(false)}>取消</button>
              <button type="button" className="ala-btn" onClick={createConv}>创建</button>
            </div>
          </div>
        )}

        {view === 'settings' && (
          <div className="ala-panel">
            <div className="ala-panel-title">🤖 生成模型</div>
            <div className="ala-seg">
              <button type="button" className={'ala-seg-btn' + (cfgMode === 'local' ? ' active' : '')} onClick={() => setCfgMode('local')}>🖥️ 本地模型（免费·基础）</button>
              <button type="button" className={'ala-seg-btn' + (cfgMode === 'cloud' ? ' active' : '')} onClick={() => setCfgMode('cloud')}>☁️ 云模型（自带 Key）</button>
            </div>
            {cfgMode === 'cloud' && (
              <>
                <div className="ala-row">
                  <label>接口地址</label>
                  <input value={cfgBaseUrl} onChange={(e) => setCfgBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
                </div>
                <div className="ala-row">
                  <label>模型名</label>
                  <input value={cfgModel} onChange={(e) => setCfgModel(e.target.value)} placeholder="deepseek-chat" />
                </div>
                <div className="ala-row">
                  <label>API Key</label>
                  <input type="password" value={cfgKey} onChange={(e) => setCfgKey(e.target.value)} placeholder={aiConfig?.hasKey ? `已保存 ${aiConfig.apiKeyMasked}（留空则不修改）` : 'sk-...'} />
                </div>
              </>
            )}
            <div className="ala-actions">
              <button type="button" className="ala-btn" onClick={saveAiConfig}>保存</button>
              {aiConfig?.hasKey && <button type="button" className="ala-btn ghost" onClick={clearAiConfig}>清除配置</button>}
              {user?.role === 'admin' && <button type="button" className="ala-btn ghost" onClick={rebuild}>重建知识库</button>}
            </div>
          </div>
        )}

        {view === 'quiz' && quiz && (
          <div className="ala-panel">
            <div className="bot-quiz-q">
              🎯 {quiz.question} <span className="bot-quiz-hint">（答对 +{quiz.reward.exp} 经验 +{quiz.reward.coin} 金币）</span>
            </div>
            <div className="bot-quiz-opts">
              {quiz.options.map((opt, i) => (
                <button key={i} type="button" className={'ala-seg-btn bot-quiz-opt' + (quiz.answered && i === quiz.answer ? ' correct' : '')} disabled={quiz.answered} onClick={() => submitQuiz(i)}>
                  {String.fromCharCode(65 + i)}. {opt}
                </button>
              ))}
            </div>
            {quiz.answered && (
              <div className={'bot-quiz-result ' + (quiz.correct ? 'ok' : 'no')}>
                {quiz.correct ? '✅ 答对啦！' : '❌ 答错了'} {quiz.explain}
                {quiz.correct && <span className="bot-quiz-reward"> +{quiz.reward?.exp || 0} 经验 +{quiz.reward?.coin || 0} 金币</span>}
              </div>
            )}
          </div>
        )}

        {error && <div className="ala-error">{error}</div>}

        <div className="bot-messages" ref={listRef}>
          {messages.map((m) => (
            <div key={m.id} className={'bot-msg ' + m.role}>
              <div className="bot-msg-role">{m.role === 'user' ? '你' : (currentConv?.title || 'Ala')}</div>
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
              <div className="bot-msg-role">{currentConv?.title || 'Ala'}</div>
              <div className="bot-msg-text bot-thinking">思考中…</div>
            </div>
          )}
        </div>

        <form className="bot-input" onSubmit={send}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="问点社区里的事，或随便聊聊…"
            maxLength={500}
            disabled={loading || !convId}
          />
          <button type="submit" className="ala-send" disabled={loading || !input.trim() || !convId}>
            发送
          </button>
        </form>
      </main>
    </div>
  );
}
