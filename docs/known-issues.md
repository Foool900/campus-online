# 已知问题 / 后续待办（Known Issues）

记录校园夜市模块中已确认、但因涉及产品/资金决策而暂缓修复的问题。
**修复前，勿在用户文档（帮助说明）中承诺相关能力。**

## #4 已付款订单无超时、无买家退款（`refundOrder` 未接线）

- 现状：`buyItem`（`server/routes/market.js`）对普通商品直接生成 `paid_escrow` 订单（全额冻结），
  但 `cancelOrder` 只能取消 `pending_payment`，`confirmOrder` 无期限；
  `refundOrder`（`market.js:579`）已实现但**没有任何路由调用**（死代码）。
- 后果：买家拍下不确认收货 → 单件商品锁在 `reserved`、买家资金长期冻结、卖家收不到款，永不自动释放。
  盲盒同理：买了不拆永远停在 `paid_escrow`。
- 涉及资金流向，需产品决策。建议方向（最低风险）：买家申请退款 → 卖家同意才退 → 不同意走纠纷举报。
- 文档约束：**不写「买家可申请退款」**，现状只能靠纠纷举报。

## #8b 配置定义了但未强制（`roamingItemSlots` / `shopItemSlots` / `removeCooldownMin`）

- 现状：`server/config.js` 定义了
  - `roamingItemSlots: 3`（地摊上架上限，`config.js:49`）
  - `removeCooldownMin: 10`（上架后下架冷却，`config.js:51`）
  - `shopItemSlots: 20`（店铺上架上限，`config.js:54`）
  但 `createItem` / `listItem` / `removeItem` 均未读取、未强制。
- 后果：地摊/店铺可上架任意多件；且前端本就没有「下架」按钮，冷却更无从谈起。
- 定性：补全已有设计（config 写了规则，代码没执行），不是新功能。修前先确认各上限的确切语义与错误码。
