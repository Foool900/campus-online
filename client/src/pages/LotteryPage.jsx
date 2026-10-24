import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function LotteryPage() {
  const [info, setInfo] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.lotteryInfo().then(setInfo).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const draw = async () => {
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const r = await api.lotteryDraw();
      setResult(r);
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>🎰 奖池抽奖</h1>
        <p>交易手续费流入奖池，抽奖奖金从奖池支出</p>
      </div>

      {info && (
        <div className="task-wallet">
          <span>[ 奖池: <span className="tw-val">{info.treasury}</span> 金币 ]</span>
          <span className="tw-sep">|</span>
          <span>[ 单抽: <span className="tw-val">{info.cost}</span> 金币 ]</span>
        </div>
      )}

      {info && (
        <div style={{ margin: '16px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {info.prizes.map((p) => (
            <span key={p} className="task-tag">🪙 {p}</span>
          ))}
        </div>
      )}

      <button className="btn primary" onClick={draw} disabled={busy || !info}>
        {busy ? '抽奖中…' : `抽一次（${info?.cost ?? 0} 金币）`}
      </button>

      {result && (
        <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 28 }}>{result.prize > 0 ? '🎉' : '😢'}</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            {result.prize > 0 ? `中了 ${result.prize} 金币！` : '谢谢参与'}
          </div>
          <div style={{ color: 'var(--muted)' }}>花费 {result.cost}，净赚 {result.net}</div>
        </div>
      )}

      {err && <div className="form-error">{err}</div>}
    </div>
  );
}
