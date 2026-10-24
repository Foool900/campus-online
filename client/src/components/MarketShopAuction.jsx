import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import MarketAuctionCard from './MarketAuctionCard.jsx';

// 剩余时间格式：>= 24h 显示天数，否则 HH:MM:SS；ms<=0 兜底 00:00:00
function fmtCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = String(Math.floor((totalSec % 86400) / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return (d > 0 ? `${d}d ` : '') + `${h}:${m}:${s}`;
}

// 店铺 SVG 图标（替代 emoji）
function StoreIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9l1.5-4h13L20 9M5 9v10h14V9M9 19v-5h6v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 固定店铺每周竞拍：价高者得。受控组件：shops 数据、可用余额 coin、服务端时间 serverNow
// 均由 useMarketData 传入（serverNow 与服务端同源），组件不再自行轮询/计时。
export default function MarketShopAuction({ data, coin, serverNow, onChanged }) {
  const { user } = useUser();
  const isStudent = user && (user.role === 'student' || user.role === 'admin');

  const [busyShopId, setBusyShopId] = useState(null); // 出价请求中的店铺 id，只锁当前店
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // 成功提示 3 秒自动清除
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  if (!isStudent) return null;

  const deadlineMs = data ? new Date(data.deadlineAt).getTime() : 0;
  const remaining = deadlineMs - serverNow;
  const ended = !!data && remaining <= 0;

  const submitBid = async (shop, amount) => {
    setErr(''); setMsg('');
    setBusyShopId(shop.id);
    try {
      await api.marketShopBid(shop.id, { termWeek: data.termWeek, amountCoin: amount });
      setMsg(`已对「${shop.name}」出价 ${amount}`);
      onChanged && onChanged();
    } catch (e) {
      if (e.code === 'COIN_INSUFFICIENT') setErr('金币不足：冻结差额不足');
      else if (e.code === 'AUCTION_TERM_CLOSED') { onChanged && onChanged(); setErr(e.message || '该期竞拍已截止'); } // 时钟偏移：先刷新让倒计时归零、按钮 disabled，再补提示
      else setErr(e.message);
      throw e; // 重新抛出，让卡片知道失败、保留输入
    } finally {
      setBusyShopId(null);
    }
  };

  return (
    <div className="mk-auction">
      {/* 头部：标题 + 期次（左），倒计时（右） */}
      <div className="mk-au-header">
        <div className="mk-au-title">
          <span className="ico"><StoreIcon /></span>
          <h2>店铺竞拍</h2>
          {data && <span className="term">· {data.termWeek}</span>}
        </div>
        {data && (
          <div className="mk-au-countdown">
            <div className="label">{ended ? '状态' : '截止时间'}</div>
            <div className={'time' + (ended ? ' ended' : '')}>{ended ? '已结束' : fmtCountdown(remaining)}</div>
          </div>
        )}
      </div>

      {err && <div className="form-error">{err}</div>}
      {msg && <div className="form-success">{msg}</div>}

      {!data ? (
        <div className="empty-state">&gt; 加载中...</div>
      ) : (
        <>
          {ended && <div className="mk-au-ended">竞拍已结束，等待结算（每 30s 自动刷新）</div>}
          {data.shops.map((s) => {
            const myBid = s.myBid;
            const status = myBid === null ? 'none' : (s.highestBid > myBid ? 'outbid' : 'leading');
            const currentOwner = s.term ? (s.term.owner_id === user.id ? '你' : '已出租') : '本期空置';
            return (
              <MarketAuctionCard
                key={s.id}
                shopName={s.name}
                shopNumber={s.shop_no}
                currentPrice={s.highestBid}
                myPrice={myBid}
                status={status}
                bidCount={s.bidCount}
                currentOwner={currentOwner}
                coin={coin}
                ended={ended}
                busy={busyShopId === s.id}
                onBid={(amount) => submitBid(s, amount)}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
