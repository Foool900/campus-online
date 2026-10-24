import { StoreIcon } from './MarketIcons.jsx';
import MarketHelp from './MarketHelp.jsx';

// 倒计时 HH:MM:SS（<=0 兜底 00:00:00）
function fmtCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

// 权威头部：期次 + 状态 + 4 张数据卡片（倒计时 / 奖池 / 我的余额 / 我的摊位）。
// 纯展示组件，数据全部由 MarketPage 从 useMarketData 传入。
export default function MarketHero({ session, treasury, serverNow, wallet, myStall }) {
  const open = session?.status === 'open';
  const upcoming = session?.status === 'upcoming';
  const statusText = open ? '开市中' : upcoming ? '未开市' : '已闭市';
  // 开市倒计时到闭市；未开市倒计时到开市；已闭市不显示倒计时
  const target = open ? session?.close_at : upcoming ? session?.open_at : null;
  const remaining = target ? new Date(target).getTime() - serverNow : null;

  return (
    <div className="market-hero">
      <div className="mk-hero-head">
        <h1 className="mk-hero-title"><span className="mk-hero-ico"><StoreIcon size={20} /></span><span className="mk-hero-text">校园夜市</span><MarketHelp /></h1>
        <span className="mk-hero-sub">第 {session?.id ?? '—'} 期 · <span className="post-category" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className={'mk-dot ' + (open ? 'open' : upcoming ? 'upcoming' : 'closed')} />{statusText}</span></span>
      </div>
      <div className="mk-stats">
        <div className="mk-stat">
          <div className="mk-stat-label">{open ? '距离闭市' : upcoming ? '距离开市' : '市场状态'}</div>
          <div className={'mk-stat-value' + (open ? ' accent' : '')}>
            {remaining !== null ? fmtCountdown(remaining) : statusText}
          </div>
        </div>
        <div className="mk-stat">
          <div className="mk-stat-label">奖池</div>
          <div className="mk-stat-value accent">{treasury}<span className="mk-stat-unit">金币</span></div>
        </div>
        <div className="mk-stat">
          <div className="mk-stat-label">我的余额</div>
          <div className="mk-stat-value accent">{wallet?.coin ?? 0}<span className="mk-stat-unit">金币</span></div>
        </div>
        <div className="mk-stat">
          <div className="mk-stat-label">我的摊位</div>
          <div className="mk-stat-value">{myStall ? `${myStall.stall_no} 号` : '未占'}</div>
        </div>
      </div>
    </div>
  );
}
