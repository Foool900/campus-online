import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

// 剩余时间格式：>= 24h 显示天数，否则 HH:MM:SS；ms<=0 兜底 00:00:00
function fmtCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = String(Math.floor((totalSec % 86400) / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return (d > 0 ? `${d}d ` : '') + `${h}:${m}:${s}`;
}

// 固定店铺每周竞拍：价高者得，本期 = 下周一 00:00 UTC 所在周
// 自包含：拉 /market/shops + /coin/wallet，1s 倒计时 + 30s 轮询（仅页面可见时）
export default function MarketShopAuction() {
  const { user } = useUser();
  const isStudent = user && (user.role === 'student' || user.role === 'admin');

  const [data, setData] = useState(null);       // { termWeek, deadlineAt, serverTime, shops }
  const [coin, setCoin] = useState(0);          // 当前可用余额（wallet 实时拉取）
  const [serverOffset, setServerOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busyShopId, setBusyShopId] = useState(null); // 出价请求中的店铺 id，只锁当前店
  const [bids, setBids] = useState({});         // shopId -> 输入串

  // load 不清 err/msg（30s 轮询不清提示），只在失败时清旧 msg 再设 err
  const load = useCallback(() => {
    api.marketShops()
      .then((r) => {
        setData(r);
        setServerOffset(new Date(r.serverTime).getTime() - Date.now());
      })
      .catch((e) => { setMsg(''); setErr(e.message); });
    api.wallet().then((w) => setCoin(w.coin)).catch(() => {});
  }, []);

  // 首次加载 + 1s 倒计时 tick + 30s 轮询（仅 document 可见时）
  useEffect(() => {
    if (!isStudent) return;
    load();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [isStudent, load]);

  // 成功提示 3 秒自动清除
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  if (!isStudent) return null;

  const deadlineMs = data ? new Date(data.deadlineAt).getTime() : 0;
  const remaining = deadlineMs - (now + serverOffset);
  const ended = !!data && remaining <= 0;

  const submitBid = async (shop) => {
    setErr(''); setMsg('');
    setBusyShopId(shop.id);
    try {
      await api.marketShopBid(shop.id, { termWeek: data.termWeek, amountCoin: Number(bids[shop.id]) });
      setBids((b) => { const n = { ...b }; delete n[shop.id]; return n; });
      setMsg(`已对「${shop.name}」出价 🪙${bids[shop.id]}`);
      load();
    } catch (e) {
      if (e.code === 'COIN_INSUFFICIENT') setErr('金币不足：冻结差额不足');
      else setErr(e.message);
    } finally {
      setBusyShopId(null);
    }
  };

  return (
    <div className="card" style={{ margin: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontWeight: 600 }}>
          🏪 店铺竞拍{data ? ` · ${data.termWeek}` : ''}
        </span>
        {data && (
          <span style={{
            fontSize: 12, fontWeight: 600, fontFamily: 'Consolas, Menlo, monospace',
            color: ended ? 'var(--muted)' : 'var(--red)',
          }}>
            {ended ? '竞拍已结束' : `截止 ${fmtCountdown(remaining)}`}
          </span>
        )}
      </div>

      {err && <div className="form-error">{err}</div>}
      {msg && <div className="form-success">{msg}</div>}

      {!data ? (
        <div className="empty-state">&gt; 加载中...</div>
      ) : (
        <>
          {ended && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              竞拍已结束，等待结算（每 30s 自动刷新）
            </div>
          )}
          {data.shops.map((s) => {
            const raw = bids[s.id] ?? '';
            const amount = Number(raw);
            const amountValid = raw.trim() !== '' && Number.isInteger(amount) && amount > 0;
            const myBid = s.myBid;
            const overbid = myBid !== null && s.highestBid > myBid;
            // 需冻结 = 首次出价全额；加价只补差额
            const required = amountValid ? (myBid === null ? amount : amount - myBid) : null;
            const tooLow = myBid !== null && amountValid && amount <= myBid;
            const insufficient = required !== null && required > coin;
            const disabled = ended || busyShopId === s.id || !amountValid || tooLow || insufficient;

            return (
              <div key={s.id} style={{
                marginBottom: 8, padding: '10px 12px', borderRadius: 6,
                border: '1px solid rgba(255,255,255,.12)',
                background: myBid !== null ? 'rgba(143,211,255,.06)' : 'transparent',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{s.name}</span>
                    <span className="post-category" style={{ marginLeft: 8 }}>{s.shop_no} 号</span>
                    {s.term && (
                      <span className="post-category" style={{ marginLeft: 8 }}>
                        当前租主{s.term.owner_id === user.id ? '（你）' : ''}
                      </span>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {s.bidCount > 0
                        ? <>当前最高价 <span className="reward-chip" style={{ margin: '0 4px' }}>🪙 {s.highestBid}</span>· {s.bidCount} 次出价</>
                        : '暂无出价'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {myBid === null ? (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>未出价</span>
                    ) : (
                      <>
                        <div className="reward-chip">我的出价 🪙 {myBid}</div>
                        {overbid && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>已被超过</div>}
                      </>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    min="1"
                    placeholder={myBid === null ? '出价' : `高于 ${myBid}`}
                    value={raw}
                    onChange={(e) => setBids((b) => ({ ...b, [s.id]: e.target.value }))}
                    disabled={ended || busyShopId === s.id}
                    style={{ width: 120 }}
                  />
                  <button className="btn primary" disabled={disabled} onClick={() => submitBid(s)}>
                    {busyShopId === s.id ? '出价中...' : '出价'}
                  </button>
                  {amountValid && (
                    tooLow ? (
                      <span style={{ fontSize: 12, color: 'var(--red)' }}>出价须高于当前出价</span>
                    ) : insufficient ? (
                      <span style={{ fontSize: 12, color: 'var(--red)' }}>金币不足 🪙{coin} / 需 🪙{required}</span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {myBid === null
                          ? `需冻结 🪙${amount}`
                          : `需补冻结 🪙${required}（= ${amount} - ${myBid}）`}
                      </span>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
