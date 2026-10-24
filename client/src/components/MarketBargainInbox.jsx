import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
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

// 卖家砍价收件箱：列出自己商品的 pending 砍价，接受（两步确认）/ 拒绝
export default function MarketBargainInbox({ open, sessionId, onChanged }) {
  const { user } = useUser();
  const isStudent = user && (user.role === 'student' || user.role === 'admin');

  const [bargains, setBargains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busyId, setBusyId] = useState(null); // 接受/拒绝进行中的砍价 id，防双击
  const [confirmId, setConfirmId] = useState(null); // 处于「确认接受」两步态的那条

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    api.marketBargains()
      .then(setBargains)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open || !isStudent) return;
    load();
  }, [open, sessionId, isStudent, load]);

  // 成功提示 3 秒自动清除，避免常驻
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  if (!open || !isStudent) return null;

  const accept = async (b) => {
    setBusyId(b.id); // 点击瞬间锁定，防双击
    setErr('');
    setMsg('');
    try {
      const r = await api.marketAcceptBargain(b.id);
      setMsg(`已接受，生成订单 #${r.orderId}`);
      onChanged && onChanged();
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (b) => {
    setBusyId(b.id);
    setErr('');
    setMsg('');
    try {
      await api.marketRejectBargain(b.id);
      setMsg('已拒绝，金币已退回买家');
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="tabs" style={{ margin: '12px 0 10px' }}><span style={{ fontWeight: 600 }}>🔔 待处理砍价</span></div>
      {err && <div className="form-error">{err}</div>}
      {msg && <div className="form-success">{msg}</div>}
      {loading ? (
        <div className="empty-state">&gt; 加载中...</div>
      ) : bargains.length === 0 ? (
        <div className="empty-state">&gt; 无待处理砍价</div>
      ) : (
        bargains.map((b) => {
          const busy = busyId === b.id;
          const confirming = confirmId === b.id;
          return (
            <div key={b.id} className="card" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 600 }}>{b.itemTitle}</span>
                <span className="post-category" style={{ marginLeft: 8 }}>标价 🪙{b.itemPrice}</span>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {b.buyerName} 出价 🪙{b.offerCoin}（第 {b.attemptNo} 次）· {formatTime(b.createdAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {confirming ? (
                  <>
                    <button className="btn primary" disabled={busy} onClick={() => accept(b)}>确认接受？</button>
                    <button className="btn ghost" disabled={busy} onClick={() => setConfirmId(null)}>取消</button>
                  </>
                ) : (
                  <>
                    <button className="btn primary" disabled={busy} onClick={() => setConfirmId(b.id)}>接受</button>
                    <button className="btn ghost" disabled={busy} onClick={() => reject(b)}>拒绝</button>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
