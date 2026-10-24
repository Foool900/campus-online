import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

// 全服喇叭：顶部滚动条 + 内联 composer（仅开市 + student/admin 可发）
// 自包含：拉 GET /market/broadcasts，30s 轮询（仅页面可见时）
export default function MarketBroadcastBar({ open, sessionId }) {
  const { user } = useUser();
  const isStudent = user && (user.role === 'student' || user.role === 'admin');

  const [data, setData] = useState(null); // { fee, limit, myCount, broadcasts }
  const [content, setContent] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // load 不清 err/msg（30s 轮询不清提示），只在失败时清旧 msg 再设 err
  const load = useCallback(() => {
    if (!sessionId) return;
    api.marketBroadcasts(sessionId)
      .then(setData)
      .catch((e) => { setMsg(''); setErr(e.message); });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    load();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30000);
    return () => clearInterval(poll);
  }, [sessionId, load]);

  // 成功提示 3 秒自动清除
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  if (!sessionId) return null;

  const fee = data?.fee ?? 0;
  const limit = data?.limit ?? 0;
  const myCount = data?.myCount ?? 0;
  const atCap = !!data && myCount >= limit;
  const broadcasts = data?.broadcasts ?? [];

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    const text = content.trim();
    if (!text) return setErr('喇叭内容不能为空');
    setBusy(true);
    try {
      await api.marketBroadcast({ sessionId, content: text });
      setContent('');
      setMsg('已广播');
      load();
    } catch (e) {
      if (e.code === 'SENSITIVE_CONTENT') setErr('内容包含违规词，请修改');
      else if (e.code === 'COIN_INSUFFICIENT') setErr('金币不足：喇叭费用不足');
      else setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  // 滚动条：内容重复一份实现无缝循环，key 加前缀避免重复 key
  const renderItems = (prefix) => broadcasts.map((b) => (
    <span key={`${prefix}-${b.id}`} className="broadcast-ticker-item">
      <b>{b.nickname}</b>：{b.content}
    </span>
  ));

  return (
    <div className="card" style={{ margin: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>📢 全服喇叭</span>
      </div>

      {!data ? (
        <div className="empty-state">&gt; 加载中...</div>
      ) : broadcasts.length === 0 ? (
        <div className="empty-state">&gt; 暂无喇叭</div>
      ) : (
        <div className="broadcast-ticker">
          <div className="broadcast-ticker-track">
            {renderItems('a')}
            {renderItems('b')}
          </div>
        </div>
      )}

      {isStudent && open && (
        atCap ? (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            本期喇叭已达上限（{myCount}/{limit}）
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={100}
              placeholder="喊一嗓子（1-100 字）"
              style={{ flex: 1, minWidth: 160 }}
            />
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? '广播中...' : '广播'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {fee > 0 ? `需付 🪙${fee}` : '免费'}
            </span>
          </form>
        )
      )}

      {err && <div className="form-error">{err}</div>}
      {msg && <div className="form-success">{msg}</div>}
    </div>
  );
}
