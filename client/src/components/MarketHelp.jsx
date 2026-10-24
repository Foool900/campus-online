import { useState } from 'react';

const TABS = [
  { key: 'play', label: '玩法' },
  { key: 'rules', label: '规则' },
  { key: 'tour', label: '页面导览' },
];

const RULES = [
  ['期次节奏', '报名 = 开市前 60～5 分钟；开市持续 4 小时'],
  ['流动地摊', '30 个 · 摆摊 30 分钟 · 押金 5 金币（可退）· 上架 3 件'],
  ['固定店铺', '5 家 · 每周竞拍 · 上架 20 件 · 租金 50% 进奖池'],
  ['交易手续费', '成交价的 5%，进奖池'],
  ['砍价', '出价需低于标价；卖家接受后 24 小时内支付'],
  ['盲盒', '上架冻结 80% 保证金 · 保底 10% 标价 · 开盒后 24 小时举报期'],
  ['全服喇叭', '每期每人 3 条'],
  ['纠纷举报', '每月 3 次配额'],
  ['评价', '成交后 30 天内评 1-5 星，影响卖家信誉'],
];

const TOUR = [
  ['逛市场', '浏览在售商品，直接「购买」或填价「砍价」'],
  ['我的摊位', '抢摊 / 确认占位 → 上架 → 处理砍价 → 交付订单'],
  ['我的订单', '买家侧：支付、开盲盒、确认收货'],
  ['店铺竞拍', '每周对 5 家固定店铺出价，价高者得'],
  ['纠纷举报', '开盒 24h 内举报盲盒，查看本月配额与记录'],
  ['喇叭', '全服广播（每期 3 条）'],
  ['夜市管理', '仅管理员：开局、发布秒杀、判定纠纷'],
];

function Sec({ title, children }) {
  return (
    <div className="mk-help-sec">
      <div className="mk-help-sec-title">{title}</div>
      {children}
    </div>
  );
}

function Line({ children }) {
  return <div className="mk-help-line">{children}</div>;
}

function Row({ k, v }) {
  return (
    <div className="mk-help-row">
      <span className="mk-help-k">{k}</span>
      <span className="mk-help-v">{v}</span>
    </div>
  );
}

function Step({ n, children }) {
  return (
    <div className="mk-help-step">
      <span className="mk-help-step-n">{n}</span>
      <span className="mk-help-step-t">{children}</span>
    </div>
  );
}

function Note({ children }) {
  return <div className="mk-help-note">{children}</div>;
}

function Play() {
  return (
    <>
      <Sec title="前提准备">
        <Line>金币来源：完成公开任务赏金、每日签到、市场卖出所得</Line>
        <Line>会员（未认证）只能逛 / 买 / 看；卖、竞拍、举报需 student 及以上角色</Line>
      </Sec>

      <Sec title="开市节奏">
        <Line>每晚默认 19:00 开市，持续 4 小时；顶部倒计时显示开 / 闭市剩余时间</Line>
        <Line>报名时段 = 开市前 60 分钟 ～ 前 5 分钟，过后可抢余位</Line>
      </Sec>

      <Sec title="卖东西 · 流动地摊">
        <Step n="1">报名抽签（开市前）或开市后点「抢摊位」先到先得</Step>
        <Step n="2">中签 / 抢到后摊位是「预留」，需 15 分钟内点「确认占位」</Step>
        <Step n="3">确认占位冻结 5 金币押金，摊位变「营业」</Step>
        <Step n="4">营业中上架商品（普通 / 盲盒）</Step>
        <Step n="5">摆摊限时 30 分钟，到期自动下架并退押金</Step>
        <Step n="6">买家付款后，去「我卖出的」点「交付」</Step>
        <Note>每期每人最多 1 摊；每摊最多上架 3 件；押金可退。</Note>
      </Sec>

      <Sec title="卖东西 · 固定店铺（每周竞拍）">
        <Step n="1">全服 5 家固定店铺，每周竞价一次，价高者得</Step>
        <Step n="2">出价只冻结「加价差额」，不是全额</Step>
        <Step n="3">截止后中标者下周可上架 20 件；未中标全额退款</Step>
        <Step n="4">中标租金 50% 进奖池、50% 销毁</Step>
      </Sec>

      <Sec title="上架商品：普通 vs 盲盒">
        <Line><b>普通</b>：标价自由、可多库存</Line>
        <Line><b>盲盒</b>：库存强制 1 件；上架冻结 80% 标价作保证金、承诺保底 10% 价值；开盒后 24 小时为举报期</Line>
      </Sec>

      <Sec title="买东西 · 直接购买">
        <Step n="1">逛市场选商品点「购买」，金币进入托管冻结</Step>
        <Step n="2">卖家「交付」后，你点「确认收货」</Step>
        <Step n="3">确认收货才拆账：卖家拿「标价 − 5% 手续费」，5% 手续费进奖池</Step>
      </Sec>

      <Sec title="买东西 · 砍价">
        <Step n="1">在商品卡填一个「低于标价」的金额点「砍价」，该金额先冻结</Step>
        <Step n="2">卖家「接受」（生成待支付订单）或「拒绝」（退款给你）</Step>
        <Step n="3">接受后 24 小时内到「我的订单」点「支付」，超时自动退款、商品回架</Step>
      </Sec>

      <Sec title="盲盒怎么玩">
        <Step n="1">买到盲盒 → 订单里点「开盒」，立即看结果</Step>
        <Step n="2">开盒即成交，直接拆账，无需确认收货</Step>
        <Step n="3">货不对板？开盒后 24 小时内去「纠纷举报」举报，买家胜诉由卖家保证金赔付</Step>
      </Sec>

      <Sec title="成交后 · 评价与信誉">
        <Line>成交后 30 天内可给卖家评 1-5 星</Line>
        <Line>信誉等级 new → regular → trusted → veteran，低分 / 败诉会掉到 risky</Line>
      </Sec>
    </>
  );
}

function Rules() {
  return (
    <>
      {RULES.map(([k, v]) => <Row key={k} k={k} v={v} />)}
    </>
  );
}

function Tour() {
  return (
    <>
      {TOUR.map(([k, v]) => <Row key={k} k={k} v={v} />)}
      <Sec title="提示">
        <Line>会员（未认证）只能逛市场、看订单、看喇叭；卖 / 竞拍 / 举报需 student 及以上角色。</Line>
      </Sec>
    </>
  );
}

// 夜市帮助：标题右下角「？」触发，弹窗内分「玩法 / 规则 / 页面导览」三页。
// 自持开关与分页状态，不依赖外部数据；纯前端展示，禁原生 alert/confirm。
export default function MarketHelp() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('play');

  return (
    <>
      <button
        type="button"
        className="mk-help-trigger"
        title="夜市帮助"
        aria-label="夜市帮助"
        onClick={() => setOpen(true)}
      >?</button>

      {open && (
        <div className="mk-help-overlay" onClick={() => setOpen(false)}>
          <div className="mk-help-card" onClick={(e) => e.stopPropagation()}>
            <div className="mk-help-head">
              <span className="mk-help-title">校园夜市 · 帮助</span>
              <button type="button" className="mk-help-close" aria-label="关闭" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="mk-help-tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={'mk-help-tab' + (tab === t.key ? ' active' : '')}
                  onClick={() => setTab(t.key)}
                >{t.label}</button>
              ))}
            </div>

            <div className="mk-help-body">
              {tab === 'play' && <Play />}
              {tab === 'rules' && <Rules />}
              {tab === 'tour' && <Tour />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
