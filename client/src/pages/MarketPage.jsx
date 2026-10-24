import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import MarketBargainInbox from '../components/MarketBargainInbox.jsx';
import MarketShopAuction from '../components/MarketShopAuction.jsx';
import MarketBroadcastBar from '../components/MarketBroadcastBar.jsx';

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

// 盲盒保证金/保底：与后端 listItem 同一公式、同一 ratio（缺省 0.8 / 0.1）
function blindboxAmounts(priceNum, cfg) {
  const deposit = Math.max(1, Math.floor(priceNum * (cfg?.blindboxDepositRatio ?? 0.8)));
  const minValue = Math.max(1, Math.floor(priceNum * (cfg?.blindboxMinValueRatio ?? 0.1)));
  return { deposit, minValue };
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
  const [description, setDescription] = useState('');
  const [boxContent, setBoxContent] = useState('');
  const [mktConfig, setMktConfig] = useState(null);

  const isStudent = user && (user.role === 'student' || user.role === 'admin');

  const load = useCallback(() => {
    api.marketSession().then((r) => {
      setSession(r.session);
      setMktConfig(r.config ?? null);
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
  const activeItems = items.filter((i) => i.status === 'active');
  const priceNum = Number(price);
  const blindboxPreview = type === 'blindbox' && mktConfig && Number.isInteger(priceNum) && priceNum > 0
    ? blindboxAmounts(priceNum, mktConfig)
    : null;

  const reload = () => { load(); };

  const grab = async () => {
    setErr(''); setMsg('');
    try { await api.marketGrabStall(sessionId); reload(); } catch (e) { setErr(e.message); }
  };
  const confirmStall = async () => {
    if (!myStall) return;
    setErr(''); setMsg('');
    try { await api.marketConfirmStall(myStall.id); reload(); setMsg('已确认摊位（押金已冻结）'); } catch (e) { setErr(e.message); }
  };
  const createItem = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    const p = Number(price);
    if (!title.trim() || !Number.isInteger(p) || p <= 0) return setErr('请填写标题和正整数价格');

    const body = { sessionId, title: title.trim(), priceCoin: p, type };
    if (description.trim()) body.description = description.trim();
    if (type === 'blindbox') {
      body.stock = 1; // 盲盒强制单件
      if (boxContent.trim()) body.contentJson = { text: boxContent.trim() }; // 留空不传
    }
    const amounts = type === 'blindbox' ? blindboxAmounts(p, mktConfig) : null;

    let itemId = null;
    try {
      const r = await api.marketCreateItem(body);
      itemId = r.itemId;
      await api.marketListItem(itemId, { stallId: myStall.id });
      setTitle(''); setPrice(''); setDescription(''); setBoxContent(''); setType('normal');
      reload();
      setMsg(type === 'blindbox' ? `盲盒已上架（已冻结保证金 ${amounts.deposit} 金币）` : '已上架');
    } catch (e) {
      // listItem 失败（如保证金不足）：best-effort 清掉刚建的 draft，一次尝试、静默失败
      if (itemId) { try { await api.marketRemoveItem(itemId); } catch { /* 忽略 */ } }
      if (e.code === 'COIN_INSUFFICIENT') setErr(`金币不足：上架盲盒需冻结保证金 ${amounts.deposit} 金币，当前余额不够`);
      else if (e.code === 'SENSITIVE_CONTENT') setErr('内容包含违规词，请修改');
      else setErr(e.message);
    }
  };
  const buy = async (item) => {
    setErr(''); setMsg('');
    try { const r = await api.marketBuy(item.id); reload(); setMsg(`已购买，订单 #${r.orderId}（已冻结 ${r.price} 金币）`); } catch (e) { setErr(e.message); }
  };
  const bargain = async (item) => {
    setErr(''); setMsg('');
    const o = Number(offer);
    if (!Number.isInteger(o) || o <= 0 || o >= item.priceCoin) return setErr('砍价金额需为正整数且低于标价');
    try { await api.marketBargain(item.id, o); reload(); setMsg('砍价已提交（金币已冻结）'); } catch (e) { setErr(e.message); }
  };
  const pay = async (o) => { setErr(''); setMsg(''); try { await api.marketPayOrder(o.id); reload(); setMsg('已支付'); } catch (e) { setErr(e.message); } };
  const confirmOrder = async (o) => { setErr(''); setMsg(''); try { await api.marketConfirmOrder(o.id); reload(); setMsg('已确认收货'); } catch (e) { setErr(e.message); } };
  const openBox = async (o) => { setErr(''); setMsg(''); try { await api.marketOpenBlindbox(o.id); reload(); setMsg('已开盒 🎁'); } catch (e) { setErr(e.message); } };

  return (
    <div className="page">
      <div className="page-head">
        <h1>🏮 校园夜市</h1>
        <p>限时开市 · 抢摊位 · 淘好物</p>
      </div>

      {/* 全服喇叭（per-session，滚动条 + composer） */}
      <MarketBroadcastBar open={open} sessionId={sessionId} />

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

      {/* 店铺竞拍（每周，独立于开市） */}
      <MarketShopAuction />

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
          <div className="field" style={{ marginTop: 8 }}>
            <label>商品描述</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="补充描述（可选）" style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          {type === 'blindbox' && (
            <div className="field" style={{ marginTop: 8 }}>
              <label>盲盒内容</label>
              <textarea value={boxContent} onChange={(e) => setBoxContent(e.target.value)} rows={2} placeholder="盒子里装什么？（留空则默认惊喜）" style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
          )}
          {type === 'blindbox' && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              {blindboxPreview
                ? `上架将冻结 🪙${blindboxPreview.deposit} 金币保证金，保底价值 🪙${blindboxPreview.minValue} 金币`
                : mktConfig ? '请输入正整数价格查看保证金预览' : '上架将按标价比例计算保证金与保底价值'}
            </div>
          )}
          <button type="submit" className="btn primary">＋ 上架</button>
        </form>
      )}

      {/* 商品列表 */}
      <div className="tabs" style={{ margin: '10px 0' }}><span style={{ fontWeight: 600 }}>🛍️ 在售商品</span></div>
      {activeItems.length === 0 && <div className="empty-state">&gt; NO LISTINGS</div>}
      {activeItems.map((i) => (
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
      <MarketBargainInbox open={open} sessionId={sessionId} onChanged={reload} />

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
