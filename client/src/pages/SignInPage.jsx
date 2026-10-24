import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

const pad2 = (n) => String(n).padStart(2, '0');

export default function SignInPage() {
  const { user, setUser } = useUser();
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.signinStatus().then(setStatus).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);

  const claim = async () => {
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const r = await api.signinClaim();
      setMsg(`签到成功 +${r.reward} 金币（连续 ${r.streak} 天）`);
      load();
      if (setUser && user) setUser({ ...user, coin: r.coin });
    } catch (e) {
      setErr(e.message || '签到失败');
    } finally {
      setBusy(false);
    }
  };

  const recent = new Set(status?.recent || []);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    days.push({ key, weekday: '日一二三四五六'[d.getDay()], day: d.getDate(), signed: recent.has(key) });
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>📅 每日签到</h1>
        <p>连续签到，奖励递增</p>
      </div>

      {status && (
        <>
          <div className="task-wallet">
            <span>[ 连续签到: <span className="tw-val">{status.streak}</span> 天 ]</span>
            <span className="tw-sep">|</span>
            <span>[ 今日奖励: <span className="tw-val">+{status.reward}</span> 金币 ]</span>
          </div>

          <div style={{ display: 'flex', gap: 10, margin: '16px 0' }}>
            {days.map((d) => (
              <div
                key={d.key}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '10px 4px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,.14)',
                  background: d.signed ? 'rgba(143,211,255,.15)' : 'transparent',
                  color: d.signed ? '#8fd3ff' : 'var(--muted, #888)',
                }}
              >
                <div style={{ fontSize: 11, opacity: 0.7 }}>{d.weekday}</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{d.day}</div>
                <div style={{ fontSize: 12, height: 16 }}>{d.signed ? '✓' : ''}</div>
              </div>
            ))}
          </div>

          <button className="btn primary" onClick={claim} disabled={status.signedToday || busy}>
            {status.signedToday ? '今日已签到' : busy ? '签到中…' : `签到 +${status.reward} 金币`}
          </button>
        </>
      )}

      {!status && !err && <div className="empty-state">SYNC…</div>}
      {msg && <div className="form-success">{msg}</div>}
      {err && <div className="form-error">{err}</div>}
    </div>
  );
}
