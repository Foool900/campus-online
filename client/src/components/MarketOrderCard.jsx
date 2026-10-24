import { useState } from 'react';
import { api } from '../api.js';
import { BoxIcon, CoinIcon } from './MarketIcons.jsx';

const ORDER_STATUS = {
  pending_payment: '待支付',
  paid_escrow: '已付款',
  delivered: '已交付',
  completed: '已完成',
  cancelled: '已取消',
  refunded: '已退款',
  disputed: '纠纷中',
};
// 订单状态本身无专属 .status-* 色系，就近复用已有徽章色，保证有配色而不新增 CSS
const ORDER_STATUS_CLASS = {
  pending_payment: 'status-accepted',
  paid_escrow: 'status-published',
  delivered: 'status-submitted',
  completed: 'status-done',
  cancelled: 'status-cancelled',
  refunded: 'status-cancelled',
  disputed: 'status-terminated',
};

// 盲盒开盒结果文案：优先 .text，surprise:true → 惊喜盲盒，其余对象 → 原始 JSON
function boxResultText(result) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    if (result.text) return String(result.text);
    if (result.surprise === true) return '惊喜盲盒';
    return JSON.stringify(result);
  }
  return result ? String(result) : '惊喜盲盒';
}

// 订单卡：买（支付/开盒/确认收货）/ 卖（交付）两用。
// 受控组件：订单数据由 MarketPage 传入，动作后回调 onChanged 刷新；本地 busy 防双击（替代页面级 busyBoxId）。
export default function MarketOrderCard({ order, side, onChanged, onError, onSuccess }) {
  const [busy, setBusy] = useState(false);       // 当前订单动作进行中，防双击
  const [boxResult, setBoxResult] = useState(null); // 开盒结果（弹窗）

  // 通用动作：执行 fn → 提示 okText → 刷新完成再放行
  const run = async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      if (okText) onSuccess && onSuccess(okText);
      await onChanged();
    } catch (e) { onError && onError(e.message); }
    finally { setBusy(false); }
  };

  const pay = () => run(() => api.marketPayOrder(order.id), '已支付');
  const confirmOrder = () => run(() => api.marketConfirmOrder(order.id), '已确认收货');
  const deliver = () => run(() => api.marketDeliverOrder(order.id), '已交付');

  const openBox = async () => {
    setBusy(true);
    try {
      const r = await api.marketOpenBlindbox(order.id);
      setBoxResult(r?.result ?? null);
      await onChanged();
    } catch (e) { onError && onError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <span style={{ fontWeight: 600 }}>{order.title}</span>
          <span className={'status-badge ' + (ORDER_STATUS_CLASS[order.status] || 'status-draft')} style={{ marginLeft: 8 }}>
            {ORDER_STATUS[order.status] || order.status}
          </span>
          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><CoinIcon size={12} /> {order.price_coin}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {side === 'bought' && order.status === 'pending_payment' && (
            <button className="btn primary" disabled={busy} onClick={pay}>支付</button>
          )}
          {side === 'bought' && order.status === 'paid_escrow' && order.item_type === 'blindbox' && (
            <button className="btn primary" disabled={busy} onClick={openBox}>{busy ? '开盒中…' : '开盒'}</button>
          )}
          {side === 'bought' && ['paid_escrow', 'delivered'].includes(order.status) && order.item_type !== 'blindbox' && (
            <button className="btn primary" disabled={busy} onClick={confirmOrder}>确认收货</button>
          )}
          {side === 'sold' && order.status === 'paid_escrow' && order.item_type !== 'blindbox' && (
            <button className="btn primary" disabled={busy} onClick={deliver}>交付</button>
          )}
        </div>
      </div>

      {/* 开盒结果弹窗（单层遮罩，点遮罩或「收下」关闭） */}
      {boxResult !== null && (
        <div className="modal-overlay" onClick={() => setBoxResult(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><BoxIcon size={18} /> 开盒</h3>
            <p className="modal-sub">{boxResultText(boxResult)}</p>
            <div className="form-actions">
              <button className="btn primary" onClick={() => setBoxResult(null)}>收下</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
