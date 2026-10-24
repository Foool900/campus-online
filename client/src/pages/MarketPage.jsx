import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import MarketBargainInbox from '../components/MarketBargainInbox.jsx';

const TYPE_LABELS = { normal: '普通', blindbox: '盲盒', flash_sale: '秒杀' };
const STALL_STATUS = { available: '空', reserved: '预留', occupied: '营业', released: '已撤', expired: '到期' };

function fmtCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

export default function MarketPage() {
  const { user } = useUser();
  const [session, setSession] = useState(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [stalls, setStalls] = useState([]);
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState({ bought: [], sold: [] });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [now, setNow] = useState(Date.now());

  // 表单
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [type, setType] = useState('normal');
  const [offer, setOffer] = useState('');

  const isStudent = user && (user.role === 'student' || user.role === 'admin');

  const load = useCallback(() => {
    api.marketSession().then((r) => {
      setSession(r.session);
      setServerOffset(new Date(r.serverTime).getTime() - Date.now());
    }).catch((e) => setErr(e.message));
    api.marketStalls().then(setStalls).catch(() => {});
    api.marketItems().then(setItems).catch(() => {});
    api.marketMyOrders().then(setOrders).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [load]);

  // 服务端时间基准
  const serverNow = now + serverOffset;
  const open = session?.status === 'open';
  const myStall = stalls.find((s) => s.owner_id === user?.id && (s.status === 'reserved' || s.status === 'occupied'));
  const sessionId = session?.id;

  const refresh = () => { load(); setMsg(''); setErr(''); };

  const grab = async () => {
    setErr(''); setMsg('');
    try { await api.marketGrabStall(sessionId); refresh(); } catch (e) { setErr(e.message); }
  };
  const confirmStall = async () => {
    if (!myStall) return;
    try { await api.marketConfirmStall(myStall.id); setMsg('已确认摊位（押金已冻结）'); refresh(); } catch (e) { setErr(e.message); }
  };
  const createItem = async (e) => {
    e.preventDefault();
    const p = Number(price);
    if (!title.trim() || !Number.isInteger(p) || p <= 0) return setErr('请填写标题和正整数价格');
    try {
      const r = await api.marketCreateItem({ sessionId, title: title.trim(), priceCoin: p, type });
      await api.marketListItem(r.itemId, { stallId: myStall.id });
      setTitle(''); setPrice('');
      setMsg('已上架'); refresh();
    } catch (e) { setErr(e.message); }
  };
  const buy = async (item) => {
    try { const r = await api.marketBuy(item.id); setMsg(`已购买，订单 #${r.orderId}（已冻结 ${r.price} 金币）`); refresh(); } catch (e) { setErr(e.message); }
  };
  const bargain = async (item) => {
    const o = Number(offer);
    if (!Number.isInteger(o) || o <= 0 || o >= item.priceCoin) return setErr('砍价金额需为正整数且低于标价');
    try { await api.marketBargain(item.id, o); setMsg('砍价已提交（金币已冻结）'); refresh(); } catch (e) { setErr(e.message); }
  };
  const pay = async (o) => { try { await api.marketPayOrder(o.id); setMsg('已支付'); refresh(); } catch (e) { setErr(e.message); } };
  const confirmOrder = async (o) => { try { await api.marketConfirmOrder(o.id); setMsg('已确认收货'); refresh(); } catch (e) { setErr(e.message); } };
  const openBox = async (o) => { try { await api.marketOpenBlindbox(o.id); setMsg('已开盒 🎁'); refresh(); } catch (e) { setErr(e.message); } };

  return (
    <div className="page">
      <div className="page-head">
        <h1>🏮 校园夜市</h1>
        <p>限时开市 · 抢摊位 · 淘好物</p>
      </div>

      {session && (
        <div className={'task-wallet' + (open ? '' : ' closed')}>
          <span>[ 状态: <span className="tw-val">{open ? '🟢 开市中' : session.status === 'upcoming' ? '⏳ 未开市' : '🔴 已闭市'}</span> ]</span>
          <span className="tw-sep">|</span>
          <span>[ 剩余: <span className="tw-val">{open ? fmtCountdown(new Date(session.close_at).getTime() - serverNow) : '—'}</span> ]</span>
          <span className="tw-sep">|</span>
          <span>[ 奖池: <span className="tw-val">{session.treasury ?? 0}</span> 金币 ]</span>
        </div>
      )}

      {/* 摊位九宫格 */}
      {isStudent && session && (
        <div className="card" style={{ margin: '12px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>🎪 流动地摊</span>
            {!myStall && open && (
              <button className="btn primary" onClick={grab}>抢摊位</button>
            )}
            {myStall?.status === 'reserved' && (
              <button className="btn primary" onClick={confirmStall}>确认占位（冻结押金）</button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {stalls.map((s) => (
              <div key={s.id} style={{
                padding: '6px 4px', textAlign: 'center', borderRadius: 6, fontSize: 12,
                border: '1px solid rgba(255,255,255,.14)',
                background: s.owner_id === user.id ? 'rgba(143,211,255,.2)' : s.status === 'occupied' ? 'rgba(255,200,100,.12)' : 'transparent',
                color: s.owner_id === user.id ? '#8fd3ff' : 'var(--muted, #888)',
              }}>
                <div>{s.stall_no}</div>
                <div style={{ fontSize: 10 }}>{STALL_STATUS[s.status]}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 上架表单 */}
      {myStall?.status === 'occupied' && open && (
        <form className="card" onSubmit={createItem} style={{ marginBottom: 12 }}>
          <div className="row">
            <div className="field" style={{ flex: 2 }}>
              <label>商品标题 *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="卖什么？" />
            </div>
            <div className="field">
              <label>价格（金币）*</label>
              <input type="number" min="1" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="field">
              <label>类型</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="normal">普通</option>
                <option value="blindbox">盲盒</option>
              </select>
            </div>
          </div>
          <button type="submit" className="btn primary">＋ 上架</button>
        </form>
      )}

      {/* 商品列表 */}
      <div className="tabs" style={{ margin: '10px 0' }}><span style={{ fontWeight: 600 }}>🛍️ 在售商品</span></div>
      {items.length === 0 && <div className="empty-state">&gt; NO LISTINGS</div>}
      {items.map((i) => (
        <div key={i.id} className="card" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontWeight: 600 }}>{i.title}</span>
            <span className="post-category" style={{ marginLeft: 8 }}>{TYPE_LABELS[i.type]}</span>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{i.sellerName} · 库存 {i.soldCount}/{i.stock}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="reward-chip">🪙 {i.priceCoin}</div>
            {i.sellerId !== user?.id && open && isStudent && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <input type="number" placeholder="砍价" value={offer} onChange={(e) => setOffer(e.target.value)} style={{ width: 80 }} />
                <button className="hud-btn" onClick={() => bargain(i)}>砍价</button>
                <button className="btn primary" onClick={() => buy(i)}>购买</button>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* 卖家砍价收件箱 */}
      <MarketBargainInbox open={open} sessionId={sessionId} onChanged={refresh} />

      {/* 我的订单 */}
      <div className="tabs" style={{ margin: '12px 0 10px' }}><span style={{ fontWeight: 600 }}>📦 我买到的</span></div>
      {orders.bought.length === 0 && <div className="empty-state">&gt; 无订单</div>}
      {orders.bought.map((o) => (
        <div key={o.id} className="card" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontWeight: 600 }}>{o.title}</span>
            <span className={'status-badge status-' + o.status} style={{ marginLeft: 8 }}>{o.status}</span>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>🪙 {o.price_coin}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {o.status === 'pending_payment' && <button className="btn primary" onClick={() => pay(o)}>支付</button>}
            {o.status === 'paid_escrow' && o.item_type === 'blindbox' && <button className="btn primary" onClick={() => openBox(o)}>开盒</button>}
            {['paid_escrow', 'delivered'].includes(o.status) && o.item_type !== 'blindbox' && <button className="btn primary" onClick={() => confirmOrder(o)}>确认收货</button>}
          </div>
        </div>
      ))}

      {msg && <div className="form-success">{msg}</div>}
      {err && <div className="form-error">{err}</div>}
    </div>
  );
}
