import { useEffect, useState } from 'react';
import { useUser } from '../UserContext.jsx';
import { useMarketData } from '../hooks/useMarketData.js';
import { BoxIcon, SendIcon } from '../components/MarketIcons.jsx';
import MarketHero from '../components/MarketHero.jsx';
import MarketStallBoard from '../components/MarketStallBoard.jsx';
import MarketListItemForm from '../components/MarketListItemForm.jsx';
import MarketItemCard from '../components/MarketItemCard.jsx';
import MarketOrderCard from '../components/MarketOrderCard.jsx';
import MarketBargainInbox from '../components/MarketBargainInbox.jsx';
import MarketShopAuction from '../components/MarketShopAuction.jsx';
import MarketBroadcastBar from '../components/MarketBroadcastBar.jsx';
import MarketDisputeReport from '../components/MarketDisputeReport.jsx';
import MarketManagePanel from '../components/MarketManagePanel.jsx';

// 侧栏线性图标（替代文字 Tab）
function NavIcon({ children }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

// 分区定义（顺序即侧栏顺序）；ROLE_GATED 里的分区仅 student/admin 可见
const SECTIONS = [
  { key: 'browse', label: '逛市场', icon: <NavIcon><path d="M4 9l1.5-4h13L20 9M5 9v10h14V9M9 19v-5h6v5" /></NavIcon> },
  { key: 'stall', label: '我的摊位', icon: <NavIcon><path d="M5 21V4M5 5l14 6-14 6" /></NavIcon> },
  { key: 'orders', label: '我的订单', icon: <NavIcon><path d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" /></NavIcon> },
  { key: 'auction', label: '店铺竞拍', icon: <NavIcon><circle cx="12" cy="9" r="5" /><path d="M9 13.5L7 21l5-2.5L17 21l-2-7.5" /></NavIcon> },
  { key: 'dispute', label: '纠纷举报', icon: <NavIcon><path d="M12 3l8 3v6c0 4.2-3.3 7-8 9-4.7-2-8-4.8-8-9V6l8-3z" /></NavIcon> },
  { key: 'broadcast', label: '喇叭', icon: <NavIcon><path d="M3 10v4l3 3 6 2V5L6 7l-3 3zM18 8a4 4 0 010 8" /></NavIcon> },
  { key: 'manage', label: '夜市管理', icon: <NavIcon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></NavIcon> },
];
const ROLE_GATED = ['stall', 'auction', 'dispute'];
const ADMIN_GATED = ['manage'];

export default function MarketPage() {
  const { user } = useUser();
  const isStudent = !!user && (user.role === 'student' || user.role === 'admin');

  const data = useMarketData();
  const {
    session, treasury, mktConfig, serverNow,
    stalls, items, orders, broadcasts, shops, disputes, adminDisputes, bargains, wallet,
    isAdmin,
    refresh,
  } = data;

  const [tab, setTab] = useState('browse');
  const [toast, setToast] = useState(null); // { kind: 'ok' | 'err', text }

  // 全局提示 3.5s 自动清除
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const onError = (text) => setToast({ kind: 'err', text });
  const onSuccess = (text) => setToast({ kind: 'ok', text });

  const open = session?.status === 'open';
  const sessionId = session?.id;
  const myStall = stalls.find((s) => s.owner_id === user?.id && (s.status === 'reserved' || s.status === 'occupied'));
  const activeItems = items.filter((i) => i.status === 'active');

  const visibleSections = SECTIONS
    .filter((s) => !ROLE_GATED.includes(s.key) || isStudent)
    .filter((s) => !ADMIN_GATED.includes(s.key) || isAdmin);

  // 角色变化导致当前分区不可见时，回退到默认
  useEffect(() => {
    if ((!isStudent && ROLE_GATED.includes(tab)) || (!isAdmin && ADMIN_GATED.includes(tab))) setTab('browse');
  }, [isStudent, isAdmin, tab]);

  return (
    <div className="page market-page">
      {/* 左侧极简玻璃导航（仅图标，选中态微光） */}
      <aside className="mk-sidebar" aria-label="市场导航">
        {visibleSections.map((s) => (
          <button
            key={s.key}
            title={s.label}
            className={'mk-nav' + (tab === s.key ? ' active' : '')}
            onClick={() => setTab(s.key)}
          >
            {s.icon}
          </button>
        ))}
      </aside>

      {/* 主列 */}
      <div className="mk-main">
        {/* 顶部数据栏（期次 + 状态 + 4 张数据卡），固定不滚动 */}
        <MarketHero session={session} treasury={treasury} serverNow={serverNow} wallet={wallet} myStall={myStall} />

        {/* 全局提示（固定） */}
        {toast && (
          <div className={toast.kind === 'ok' ? 'form-success' : 'form-error'} style={{ marginBottom: 10 }}>
            {toast.text}
          </div>
        )}

        {/* 内容区（内部滚动，外框固定） */}
        <div className="mk-content">
          {/* 逛市场：在售商品（网格画廊） */}
          {tab === 'browse' && (
            activeItems.length === 0 ? (
              <div className="mk-empty">
                <BoxIcon size={30} />
                <div className="mk-empty-title">暂无在售商品</div>
                <div className="mk-empty-sub">Awaiting Listings</div>
              </div>
            ) : (
              <div className="mk-grid">
                {activeItems.map((i) => (
                  <MarketItemCard
                    key={i.id}
                    item={i}
                    open={open}
                    isStudent={isStudent}
                    userId={user?.id}
                    onChanged={refresh}
                    onError={onError}
                    onSuccess={onSuccess}
                  />
                ))}
              </div>
            )
          )}

          {/* 我的摊位：抢摊 + 上架 + 砍价收件箱 + 我卖出的（卖家） */}
          {tab === 'stall' && (
            <>
              <MarketStallBoard
                stalls={stalls}
                myStall={myStall}
                open={open}
                isStudent={isStudent}
                sessionId={sessionId}
                onChanged={refresh}
                onError={onError}
                onSuccess={onSuccess}
              />
              <MarketListItemForm
                myStall={myStall}
                open={open}
                mktConfig={mktConfig}
                sessionId={sessionId}
                onChanged={refresh}
                onError={onError}
                onSuccess={onSuccess}
              />
              <MarketBargainInbox bargains={bargains} open={open} onChanged={refresh} />
              <div className="mk-card" style={{ marginTop: 12 }}>
                <div className="tabs" style={{ margin: '0 0 10px' }}><span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}><SendIcon size={14} /> 我卖出的</span></div>
                {orders.sold.length === 0
                  ? <div className="empty-state">&gt; 无订单</div>
                  : orders.sold.map((o) => (
                    <MarketOrderCard key={o.id} order={o} side="sold" onChanged={refresh} onError={onError} onSuccess={onSuccess} />
                  ))}
              </div>
            </>
          )}

          {/* 我的订单：我买到的（买家） */}
          {tab === 'orders' && (
            <div className="mk-card">
              <div className="tabs" style={{ margin: '0 0 10px' }}><span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}><BoxIcon size={14} /> 我买到的</span></div>
              {orders.bought.length === 0
                ? <div className="empty-state">&gt; 无订单</div>
                : orders.bought.map((o) => (
                  <MarketOrderCard key={o.id} order={o} side="bought" onChanged={refresh} onError={onError} onSuccess={onSuccess} />
                ))}
            </div>
          )}

          {/* 店铺竞拍（每周，独立于开市） */}
          {tab === 'auction' && <MarketShopAuction data={shops} coin={wallet?.coin ?? 0} serverNow={serverNow} onChanged={refresh} />}

          {/* 纠纷举报 */}
          {tab === 'dispute' && <MarketDisputeReport data={disputes} onChanged={refresh} />}

          {/* 全服喇叭 */}
          {tab === 'broadcast' && <MarketBroadcastBar data={broadcasts} open={open} sessionId={sessionId} onChanged={refresh} />}

          {/* 夜市管理（仅 admin） */}
          {tab === 'manage' && <MarketManagePanel session={session} adminDisputes={adminDisputes} onChanged={refresh} />}
        </div>
      </div>
    </div>
  );
}
