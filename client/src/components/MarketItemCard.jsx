import { useState } from 'react';
import { api } from '../api.js';
import { CoinIcon } from './MarketIcons.jsx';

const TYPE_LABELS = { normal: '普通', blindbox: '盲盒', flash_sale: '秒杀' };

// 在售商品卡：砍价 / 购买。每张卡各自持有本地砍价输入（避免共享输入框），
// 购买进行中有本地 busy 防双击（替代原先页面级 busyBuyId，语义不变）。
export default function MarketItemCard({ item, open, isStudent, userId, onChanged, onError, onSuccess }) {
  const [offer, setOffer] = useState('');       // 本卡砍价输入串
  const [busy, setBusy] = useState(false);       // 购买进行中，防双击

  const buy = async () => {
    setBusy(true);
    try {
      const r = await api.marketBuy(item.id);
      onSuccess && onSuccess(`已购买，订单 #${r.orderId}（已冻结 ${r.price} 金币）`);
      await onChanged(); // 刷新（内部已 catch，不会抛），刷新完成再放行，防双击
    } catch (e) { onError && onError(e.message); }
    finally { setBusy(false); }
  };

  const bargain = async () => {
    const o = Number(offer);
    if (!Number.isInteger(o) || o <= 0 || o >= item.priceCoin) return onError && onError('砍价金额需为正整数且低于标价');
    try {
      await api.marketBargain(item.id, o);
      setOffer('');
      onChanged && onChanged();
      onSuccess && onSuccess('砍价已提交（金币已冻结）');
    } catch (e) { onError && onError(e.message); }
  };

  return (
    <div className="card mk-item">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontWeight: 600 }}>{item.title}</span>
          <span className="post-category" style={{ marginLeft: 8 }}>{TYPE_LABELS[item.type]}</span>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.sellerName} · 库存 {item.soldCount}/{item.stock}</div>
          {item.description && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.description}</div>}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="reward-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CoinIcon size={13} /> {item.priceCoin}</div>
          {item.sellerId !== userId && open && isStudent && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
              <input type="number" placeholder="砍价" value={offer} onChange={(e) => setOffer(e.target.value)} style={{ width: 80 }} />
              <button className="hud-btn" onClick={bargain}>砍价</button>
              <button className="btn primary" onClick={buy} disabled={busy}>
                {busy ? '购买中…' : '购买'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
