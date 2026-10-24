import { useState } from 'react';

// 金币 SVG 图标（替代 emoji）
function CoinIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
    </svg>
  );
}

const STATUS_TEXT = { leading: '领先', outbid: '已被超过', none: '未出价' };

/*
 * 店铺竞拍卡片：单店展示 + 出价交互。
 * 受控输入实时计算冻结差额；金额非法 / 不高于最高价 / 余额不足时禁用按钮并给错误态。
 *
 * 对应 TypeScript 接口（项目为 JSX，此处仅作参考）：
 * interface AuctionCardProps {
 *   shopName: string;               // 店铺名
 *   shopNumber: number;             // 编号
 *   currentPrice: number;           // 当前最高价
 *   myPrice: number | null;         // 我的出价（null = 未出价）
 *   status: 'leading' | 'outbid' | 'none'; // 状态枚举
 *   bidCount: number;               // 出价次数
 *   currentOwner: string;           // 当前租主（展示文案）
 *   coin: number;                   // 可用余额
 *   ended: boolean;                 // 是否已截止
 *   busy: boolean;                  // 本店出价请求进行中（防双击）
 *   onBid: (amount: number) => Promise<void>; // 提交出价；成功 resolve，失败 reject
 * }
 */
export default function MarketAuctionCard({
  shopName, shopNumber, currentPrice, myPrice, status, bidCount, currentOwner,
  coin, ended, busy, onBid,
}) {
  const [raw, setRaw] = useState(''); // 本店出价输入串（每卡独立，避免共享输入框）

  const amount = Number(raw);
  const amountValid = raw.trim() !== '' && Number.isInteger(amount) && amount > 0;
  // 冻结差额：首次出价全额；加价只补差额（新出价 - 我的历史出价）
  const required = amountValid ? (myPrice === null ? amount : amount - myPrice) : null;
  // 校验：须高于当前最高价（无人出价时最高价为 0，等价于 > 0）
  const tooLow = amountValid && amount <= currentPrice;
  const insufficient = required !== null && required > coin;
  const invalid = raw.trim() !== '' && !amountValid;

  const disabled = ended || busy || !amountValid || tooLow || insufficient;

  // 底部提示（优先级：非法 → 过低 → 不足 → 正常冻结说明）
  let hint = null;
  if (raw.trim() === '') {
    hint = null;
  } else if (invalid) {
    hint = { text: '请输入正整数出价', error: true };
  } else if (tooLow) {
    hint = { text: '出价必须高于当前最高价', error: true };
  } else if (insufficient) {
    hint = { text: `金币不足：需冻结 ${required}，当前余额 ${coin}`, error: true };
  } else {
    hint = {
      text: myPrice === null
        ? `需冻结 ${amount}（首次出价全额冻结）`
        : `需补冻结 ${required}（= ${amount} − ${myPrice}）`,
      error: false,
    };
  }

  const submit = async () => {
    if (disabled) return;
    try {
      await onBid(amount);
      setRaw(''); // 成功后清空，便于下一次出价
    } catch {
      // 失败保留输入（错误已由父级提示），让用户直接修改
    }
  };

  return (
    <article className="mk-au-card" style={{ marginBottom: 16 }}>
      {/* 顶部：店名 + 编号 + 租主（左），状态胶囊（右） */}
      <div className="mk-au-head">
        <div>
          <span className="mk-au-name">{shopName}</span>
          <span className="mk-au-no">{shopNumber} 号</span>
          <div className="mk-au-owner">当前租主：{currentOwner}</div>
        </div>
        <span className={'mk-au-pill ' + status}>{STATUS_TEXT[status]}</span>
      </div>

      {/* 当前最高价 */}
      <div className="mk-au-price-row">
        <div>
          <div className="mk-au-price-label">当前最高价</div>
          <div className="mk-au-price">
            {bidCount > 0 ? (
              <>
                <span className="num">{currentPrice}</span>
                <span className="unit">金币</span>
              </>
            ) : (
              <span className="num empty">暂无出价</span>
            )}
          </div>
        </div>
        <span className="mk-au-bidcount">{bidCount} 次出价</span>
      </div>

      {/* 我的出价 */}
      <div className="mk-au-mybid">
        <span className="label">我的出价</span>
        {myPrice === null
          ? <span className="val none">未出价</span>
          : <span className={'val ' + status}>{myPrice} 金币</span>}
      </div>

      {/* 一体化出价容器：输入框 + 出价按钮 */}
      <div className={'mk-au-bidbox' + (hint?.error ? ' has-error' : '')}>
        <span className="coin"><CoinIcon /></span>
        <input
          type="number"
          min="1"
          className="mk-au-input"
          placeholder={myPrice === null ? '出价' : `出价须高于 ${currentPrice}`}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          disabled={ended || busy}
        />
        <button className="mk-au-btn" disabled={disabled} onClick={submit}>
          {busy ? '出价中…' : '出价'}
        </button>
      </div>

      {hint && <p className={'mk-au-hint' + (hint.error ? ' error' : '')}>{hint.text}</p>}
    </article>
  );
}
