import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import { FlagIcon } from './MarketIcons.jsx';

const STALL_STATUS = { available: '空', reserved: '预留', occupied: '营业', released: '已撤', expired: '到期' };

// 流动地摊九宫格：抢摊 + 确认占位（确认即冻结押金）。
// 受控组件：stalls/myStall/open 由 MarketPage 传入，动作后回调 onChanged 刷新。
export default function MarketStallBoard({ stalls, myStall, open, isStudent, sessionId, onChanged, onError, onSuccess }) {
  const { user } = useUser();

  const grab = async () => {
    try {
      await api.marketGrabStall(sessionId);
      onChanged && onChanged();
    } catch (e) { onError && onError(e.message); }
  };

  const confirmStall = async () => {
    if (!myStall) return;
    try {
      await api.marketConfirmStall(myStall.id);
      onChanged && onChanged();
      onSuccess && onSuccess('已确认摊位（押金已冻结）');
    } catch (e) { onError && onError(e.message); }
  };

  return (
    <div className="card" style={{ margin: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}><FlagIcon size={15} /> 流动地摊</span>
        {!myStall && open && isStudent && (
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
            background: s.owner_id === user?.id ? 'rgba(143,211,255,.2)' : s.status === 'occupied' ? 'rgba(255,200,100,.12)' : 'transparent',
            color: s.owner_id === user?.id ? '#8fd3ff' : 'var(--muted, #888)',
          }}>
            <div>{s.stall_no}</div>
            <div style={{ fontSize: 10 }}>{STALL_STATUS[s.status]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
