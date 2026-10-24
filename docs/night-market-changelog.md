# 校园夜市 变更记录

> 本文档记录 `db668af`（市场机制初步）这一回滚基线所包含的内容，以及当前已知缺口。

## 回滚基线

- **commit**：`db668af`（`db668af450054649d0c17fe40dcc2a69eeb4da7e`）
- **状态**：51/51 服务端测试通过、客户端 `vite build` 成功、工作区干净。

## 包含内容

### Phase 1 —— 经验 / 金币重构

- 经验 `exp` 只发不扣（决定等级），唯一入口 `server/exp.js`（`grantExp` / `applyExpRaw`），`exp_transactions` 只记 `grant` + `source`。
- 金币账户 `coin` / `frozen_coin`，唯一入口 `server/coin.js`（`mint/freeze/transfer/refund/sink`），流水 `coin_transactions`。
- 删除旧经验资产树（`exp_categories` / `user_exp` / `exp_admin_logs`）与旧待办（`todos` / `routes/todos.js` / `TodoCard.jsx`）。
- 任务系统赏金由经验改为金币，完成行为发经验（每日上限 + 幂等）。
- 管理端改为「金币发放」，权限 `EXP_*` → `COIN_*`。

### Phase 2/3 —— 签到 / 市场 / 奖池

- 每日签到：`sign_ins` + `routes/signin.js` + `SignInPage.jsx`（连击递增）。
- 公共奖池：`treasury` + `server/treasury.js`；抽奖 `routes/lottery.js` + `LotteryPage.jsx`。

### 校园夜市主体

- **17 张表**：`market_sessions / market_stalls / market_stall_signups / market_shops / market_shop_terms / market_shop_bids / market_items / market_blindbox_configs / market_blindbox_opens / market_orders / market_bargains / market_reputations / market_reputation_events / market_broadcasts / market_disputes / market_configs / market_ledger`。
- **后端** `routes/market.js`（约 990 行）：期次 / 抽签（commit-reveal + HMAC）/ 抢摊 / 确认 / 商品 / 购买（escrow）/ 订单 / 砍价 / 盲盒 / 店铺竞拍 / 喇叭 / 纠纷 / 秒杀 / 结算。
- **生命周期定时** `index.js` `tickMarket`（每 30s）：抽签 → 开市 → 闭市 → 结算。
- **前端** `MarketPage.jsx`（夜市界面：倒计时 / 九宫格摊位 / 抢摊 / 上架 / 购买 / 砍价 / 订单）。

## 已知缺口

1. **官方秒杀补贴**：`createFlashSale` 已建 `is_official` 商品，但 `buyItem` 未做 `treasury_out` 差价补贴 + `flash_sale_budget` 上限校验。
2. **定时任务不完整**：地摊 30min 到期释放、砍价 24h 支付超时、盲盒保证金 24h `held→released`、店铺每周 `settleShopTerms` 尚未挂入 `tickMarket`。
3. **信誉聚合**：只写了 `completion` 事件，`market_reputations` 的 score/rates 计算与 `rate` 评级接口未实现。
4. **前端不完整**：卖家接受砍价、盲盒内容提交、店铺竞拍、喇叭、纠纷界面未做。
5. **举报限流 / 敏感词** 未做。
