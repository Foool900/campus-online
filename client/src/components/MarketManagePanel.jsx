import { useState } from 'react';
import { api } from '../api.js';
import { ShieldIcon, StoreIcon, FlagIcon } from './MarketIcons.jsx';

const SESSION_LABELS = { upcoming: '待开市', open: '开市中', closed: '已闭市', settled: '已结算' };

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

// 开局：创建期次（openAt → ISO）。期次不存在时市场恒「未开市」。
function CreateSession({ session, onChanged }) {
  const [openAt, setOpenAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    if (!openAt) return setErr('请选择开市时间');
    setBusy(true);
    try {
      await api.marketCreateSession({ openAt: new Date(openAt).toISOString() });
      setMsg('期次已创建');
      setOpenAt('');
      onChanged && onChanged();
    } catch (e2) {
      setErr(e2.message || '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}><FlagIcon size={15} /> 开局（创建期次）</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          当前：{session ? SESSION_LABELS[session.status] || session.status : '未创建'}
        </span>
      </div>
      <form onSubmit={submit}>
        <div className="field">
          <label>开市时间</label>
          <input type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0' }}>
          报名 = 开市前 60 分钟～前 5 分钟，开市持续 4 小时；请设在未来至少 60 分钟后。
        </div>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? '创建中...' : '创建期次'}</button>
      </form>
      {msg && <div className="form-success">{msg}</div>}
      {err && <div className="form-error">{err}</div>}
    </div>
  );
}

// 官方秒杀：SYSTEM 当卖家，差价补贴走 flashSaleBudget（每期上限）。
function FlashSale({ session, onChanged }) {
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [stock, setStock] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const sessionId = session?.id;

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    if (!sessionId) return setErr('当前无期次，请先开局');
    const p = Number(price);
    const c = Number(cost);
    const s = Number(stock);
    if (!title.trim()) return setErr('请填写标题');
    if (!Number.isInteger(p) || p <= 0) return setErr('秒杀价需为正整数');
    if (!Number.isInteger(c) || c <= p) return setErr('原价需为正整数且高于秒杀价');
    if (!Number.isInteger(s) || s <= 0) return setErr('库存需为正整数');
    setBusy(true);
    try {
      await api.marketFlash({ sessionId, title: title.trim(), priceCoin: p, costCoin: c, stock: s });
      setMsg('秒杀商品已上架');
      setTitle(''); setPrice(''); setCost(''); setStock('');
      onChanged && onChanged();
    } catch (e2) {
      setErr(e2.message || '发布失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}><StoreIcon size={15} /> 官方秒杀</span>
        {!sessionId && <span style={{ fontSize: 12, color: 'var(--muted)' }}>需先开局</span>}
      </div>
      <form onSubmit={submit}>
        <div className="field"><label>标题</label><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} style={{ width: '100%', boxSizing: 'border-box' }} /></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="field" style={{ flex: 1 }}><label>秒杀价（金币）</label><input type="number" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} /></div>
          <div className="field" style={{ flex: 1 }}><label>原价（金币）</label><input type="number" value={cost} onChange={(e) => setCost(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} /></div>
          <div className="field" style={{ flex: 1 }}><label>库存</label><input type="number" value={stock} onChange={(e) => setStock(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} /></div>
        </div>
        <button className="btn primary" type="submit" disabled={busy || !sessionId}>{busy ? '发布中...' : '发布秒杀'}</button>
      </form>
      {msg && <div className="form-success">{msg}</div>}
      {err && <div className="form-error">{err}</div>}
    </div>
  );
}

// 判纠纷：管理员对待判纠纷逐一判定（买家胜诉 / 卖家胜诉 / 驳回）。
function ResolveDisputes({ disputes, onChanged }) {
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const resolve = async (id, outcome) => {
    setErr(''); setMsg('');
    setBusyId(id);
    try {
      await api.marketResolveDispute(id, outcome);
      setMsg('已判定');
      onChanged && onChanged();
    } catch (e2) {
      setErr(e2.message || '判定失败');
    } finally {
      setBusyId(null);
    }
  };

  const list = disputes ?? null;

  return (
    <div className="card">
      <div style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <ShieldIcon size={15} /> 判纠纷{list ? `（${list.length}）` : ''}
      </div>
      {list === null ? (
        <div className="empty-state">&gt; 加载中...</div>
      ) : list.length === 0 ? (
        <div className="empty-state">&gt; 暂无待判纠纷</div>
      ) : list.map((d) => (
        <div key={d.id} className="card" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>#{d.id}</strong>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtTime(d.createdAt)}</span>
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            商品：{d.itemTitle || '—'}<span className="post-category" style={{ marginLeft: 8 }}>{d.type}</span>
          </div>
          <div style={{ fontSize: 13, marginTop: 2 }}>
            举报方 {d.reporter?.nickname || '—'} · 卖家 {d.seller?.nickname || '—'}
          </div>
          <div style={{ fontSize: 13, marginTop: 2 }}>原因：{d.reason}</div>
          {d.evidenceJson && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>证据：{d.evidenceJson}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="btn success" disabled={busyId === d.id} onClick={() => resolve(d.id, 'resolved_buyer')}>买家胜诉</button>
            <button className="btn primary" disabled={busyId === d.id} onClick={() => resolve(d.id, 'resolved_seller')}>卖家胜诉</button>
            <button className="btn ghost" disabled={busyId === d.id} onClick={() => resolve(d.id, 'dismissed')}>驳回</button>
          </div>
        </div>
      ))}
      {err && <div className="form-error">{err}</div>}
      {msg && <div className="form-success">{msg}</div>}
    </div>
  );
}

export default function MarketManagePanel({ session, adminDisputes, onChanged }) {
  return (
    <>
      <CreateSession session={session} onChanged={onChanged} />
      <FlashSale session={session} onChanged={onChanged} />
      <ResolveDisputes disputes={adminDisputes} onChanged={onChanged} />
    </>
  );
}
