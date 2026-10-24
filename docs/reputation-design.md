# 信誉分（Reputation）设计文档

卖家信誉分是「校园夜市」的卖家信用聚合：从订单状态与评价事件实时算出 `score`（0–100）与 `level`（new / regular / trusted / veteran / risky），落库在 `market_reputations`，供前端展示、后续竞拍加权与店铺门槛使用。

核心实现：`server/routes/market.js` 的 `recomputeReputation(sellerId)`（聚合计算）与 `rateOrder(...)`（评价入口），事件表 `market_reputation_events`（append-only）。

---

## a. 四个维度的数据源

| 维度 | 数据源 | 口径 |
| --- | --- | --- |
| `completion_rate` / `cancel_rate` / `order_count` | `market_orders`（按 `status` 计数） | `completed` / `cancelled` / `refunded` |
| `good_rate` | `market_reputation_events`（`rating` 事件） | 好评 = `rating >= 4`，评价数 = 全部 `rating` 事件 |
| `dispute_lost_rate` | 分子 `market_reputation_events`（`dispute_lost` 事件）；分母 `market_orders` 的 `completed` 数 | |

- `order_count = completed` 数（不含 `cancelled`/`refunded`，量级只认真正成交的单）。
- 三个 rate 的分子分母都是「当次重算时全历史」聚合，不是增量字段。

---

## b. 公式

```js
good_rate         = (好评数 + 5) / (评价数 + 10)          // Laplace 平滑，0 评价 = 0.5
completion_rate   = completed / (completed + cancelled + refunded)   // 分母 0 取 1（还没违约过）
cancel_rate       = cancelled / (completed + cancelled + refunded)   // 分母 0 取 0（v1 恒 0，v2 启用）
dispute_lost_rate = dispute_lost数 / completed数                     // 分母 0 取 0
protected_orders  = MAX(0, 5 - order_count)              // 公式算，不用字段递减

score = protected_orders > 0
  ? 70
  : Math.round(clamp(
      70 + (good_rate - 0.5) * 40
         - cancel_rate * 30
         - dispute_lost_rate * 50
         + Math.min(order_count, 40) * 0.5,
      0, 100))
```

- `good_rate`/`completion_rate`/`cancel_rate`/`dispute_lost_rate` 存 REAL，**不提前取整**，只在最终 `score` 做一次 `Math.round`。
- `order_count` 的量级加成 `Math.min(order_count, 40) * 0.5` 封顶在 40 单（+20 分）。

---

## c. 前 5 单保护时序

- 前 5 单（`order_count < 5`）时 `protected_orders > 0`，`score` 固定 **70**，但 `good_rate` 等 rates **照算照存**（只是不参与 score）。
- 第 5 单完成时 `protected_orders` 由 1 → 0，公式首次生效（例：5 单全好评 → `good_rate = 10/15 = 0.667` → score **79**，不是 70）。
- 第 6 单起：`protected_orders = 0`，score 对**全历史**回溯重算，非只算新单。

---

## d. level 判定顺序（顺序不能错）

```js
function reputeLevel(orderCount, score) {
  if (orderCount < 5)                      return 'new';      // 先判量级门槛
  if (score >= 90 && orderCount >= 20)     return 'veteran';  // 老手要同时满足分+量
  if (score >= 80)                         return 'trusted';
  if (score >= 60)                         return 'regular';
  return 'risky';                                              // < 60
}
```

- `veteran` 必须在 `trusted` 之前判：`score >= 90 && order_count >= 20`，缺任一条件都落回 `trusted`。
- `new` 只看 `order_count < 5`，优先级最高（即便 score 已 90 也仍是 `new`）。

---

## e. 已知 trade-off（产品有意为之）

- **沉默订单偏差**：买家不评价不影响 score（只进 `completion`，不进 `good_rate` 分母）。因此 40 单只被评 5 单全好评时 `good_rate = 10/15 = 0.667`、老手加成 +20 → 仍可能到 `veteran`。这是「量大即老字号」的有意选择，v2 考虑用评价覆盖率修正。
- **cancel 维度 v1 恒 0**：当前无卖家主动取消流程，`cancel_rate` 公式保留但实际恒 0，注释标明 v2 启用。
- **risky 等级 v1 仅展示**：只用于前端红色标签，v2 再接入竞拍加权 / 店铺门槛。
- **dispute_lost 触发条件**：`resolved_buyer`（买家胜诉 = 卖家败诉）才写 `dispute_lost`，`resolved_seller` 不写。

---

## f. 边界场景

| 场景 | 行为 |
| --- | --- |
| 同一订单重复评价 | `rateOrder` 幂等：`UNIQUE(order_id, event, user_id)` 冲突 → **409 ALREADY_RATED**，不重复重算 |
| 买家不评价 | 不影响 score：只进 `completion` 事件，不进 `good_rate` 分母 |
| 纠纷败诉（dispute_lost） | 永久扣分，不回滚（事件 append-only） |
| 卖家删除 | `users` 行删除后 `market_reputations`/`market_reputation_events` 行被 `ON DELETE CASCADE` 级联删除 |
| 时间衰减 | v1 不做，v2 考虑 90 天加权 |
