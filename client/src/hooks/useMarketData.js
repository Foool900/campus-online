import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

// 统一市场数据层：把原先散落在 MarketPage / MarketBroadcastBar / MarketShopAuction /
// MarketDisputeReport 的 4 处轮询，收敛成「一个 30s 轮询 + 一个 1s 倒计时 tick」。
// 子组件全部改为受控（props 传入数据、动作完成后回调 refresh），不再各自轮询。
export function useMarketData() {
  const { user } = useUser();
  const isStudent = !!user && (user.role === 'student' || user.role === 'admin');
  const isAdmin = user?.role === 'admin';

  const [session, setSession] = useState(null);
  const [treasury, setTreasury] = useState(0);
  const [mktConfig, setMktConfig] = useState(null);   // 市场配置（盲盒保证金/保底比例等）
  const [coinConfig, setCoinConfig] = useState(null);  // 金币经济配置（独立于市场配置）
  const [serverOffset, setServerOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [stalls, setStalls] = useState([]);
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState({ bought: [], sold: [] });
  const [broadcasts, setBroadcasts] = useState(null);
  const [shops, setShops] = useState(null);
  const [disputes, setDisputes] = useState(null);
  const [adminDisputes, setAdminDisputes] = useState(null);
  const [bargains, setBargains] = useState(null);
  const [wallet, setWallet] = useState(null);

  // 喇叭读取按 session 过滤，用 ref 拿最新期次 id，避免每次轮询都依赖 session state。
  const sessionIdRef = useRef(null);
  useEffect(() => { sessionIdRef.current = session?.id ?? null; }, [session]);

  const refresh = useCallback(() => {
    const jobs = [
      // 常驻（所有角色都拉）：会话 / 摊位 / 商品 / 订单 / 喇叭 / 钱包 / 金币配置
      api.marketSession().then((r) => {
        setSession(r.session);
        setTreasury(r.treasury ?? 0);
        setMktConfig(r.config ?? null);
        setServerOffset(new Date(r.serverTime).getTime() - Date.now());
        // 砍价收件箱：仅学生且开市才拉。挂在 session 回调里，用「本次」的状态而非陈旧 open，
        // 保证刚进页面且市场开着时也能立刻拉到，不用等下一轮 30s。
        if (isStudent && r.session?.status === 'open') {
          api.marketBargains().then(setBargains).catch(() => {});
        }
      }).catch(() => {}),
      api.marketStalls().then(setStalls).catch(() => {}),
      api.marketItems().then(setItems).catch(() => {}),
      api.marketMyOrders().then(setOrders).catch(() => {}),
      api.marketBroadcasts(sessionIdRef.current).then(setBroadcasts).catch(() => {}),
      api.wallet().then(setWallet).catch(() => {}),
      api.coinConfig().then(setCoinConfig).catch(() => {}),
    ];

    // 懒加载：店铺竞拍 / 纠纷举报仅学生/admin 可见（纠纷接口本身也 gate student/admin）
    if (isStudent) {
      jobs.push(api.marketShops().then(setShops).catch(() => {}));
      jobs.push(api.marketDisputes().then(setDisputes).catch(() => {}));
    }
    // 夜市管理：管理员拉待判纠纷列表
    if (isAdmin) {
      jobs.push(api.marketAdminDisputes('pending').then(setAdminDisputes).catch(() => {}));
    }

    // 返回 Promise（各子请求均已 catch，不会 reject），供子组件 `await onChanged()` 防双击。
    return Promise.all(jobs);
  }, [isStudent, isAdmin]);

  useEffect(() => {
    refresh();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    // 30s 轮询（仅页面可见时），同步开市/闭市、他人抢摊/上架、竞拍/喇叭/纠纷等状态。
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 30000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [refresh]);

  // serverNow 是派生值：客户端 now + 由 serverTime 算出的偏移，非接口字段。
  const serverNow = now + serverOffset;

  return {
    session, treasury, mktConfig, coinConfig, serverNow,
    stalls, items, orders, broadcasts, shops, disputes, adminDisputes, bargains, wallet,
    isAdmin,
    refresh,
  };
}
