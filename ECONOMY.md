# 经验 / 金币经济说明书

> 本文档说明「经验与金币」两个账户的定位，以及每日签到、二手市场、奖池抽奖三个玩法。
> 面向使用者与后续维护者；电脑端、手机端共用同一套接口。

---

## 一、核心概念：两个账户

把「经验」和「金币」彻底分开，是这套经济系统最重要的一条约定。

| 账户 | 方向 | 作用 | 来源 |
|---|---|---|---|
| **经验 `exp`** | 只增不减 | 决定等级 `level = floor(exp / 100) + 1` | 完成私密备忘 / 公开任务（行为经验）、未来剧情节点 |
| **金币 `coin`** | 可花、可托管、可转移 | 任务赏金、市场交易、抽奖 | 每日签到、剧情、赏金任务、成就、管理员发放 |

两个账户都挂在 `users` 表上：

- `exp` —— 累计经验（等级）
- `coin` —— 金币余额
- `frozen_coin` —— 冻结金币（公开任务赏金托管中）

> 为什么分开：经验代表「成长」，金币代表「货币」。混在一起就会出现"我完成任务怎么经验反而变少了（被冻结当赏金）"这种困惑。分开后各自只做一件事。

---

## 二、金币经济闭环

金币要健康，必须同时有**进水口、流通、出水口**，否则只会通胀。

```
  进水口（造币）          流通（守恒）          出水口（回收）
  签到 / 剧情 / 赏金      任务赏金托管转移 /      市场交易手续费（→ 奖池）
  成就 / 管理员发放        市场买卖 /            抽奖花费（sink）
```

- **造币（mint）**：系统向用户发金币（签到、赏金、管理员）。
- **回收（sink）**：用户金币被销毁（市场买家付款、抽奖花费）。
- **托管（freeze/refund/transfer）**：发布赏金时 `coin → frozen_coin`，验收时 `frozen_coin(发布者) → coin(接取者)`，取消/过期退回。
- **手续费**：市场每笔成交按 `coin.tradeFeeRate` 抽成，抽成进入**公共奖池**（`treasury`），用于抽奖支出。

所有金币增减都走 `server/coin.js`（`mintCoin / freezeCoin / transferCoin / refundCoin / sinkCoin`），带幂等键 + 流水表 `coin_transactions`，禁止直接改字段。

---

## 三、每日签到

### 3.1 玩法

- 每天可签到一次，领金币。
- **连续签到**天数越久，奖励越高（连击）。
- 断签（昨天没签）则连击重置为 1。

### 3.2 奖励公式

```
奖励 = base + min((连击 - 1) × streakBonus, streakMaxBonus)
```

默认（`server/config.js` 的 `signin`）：

| 配置 | 默认 | 说明 |
|---|---|---|
| `base` | 10 | 首日基础金币 |
| `streakBonus` | 2 | 每连续一天 +2 |
| `streakMaxBonus` | 20 | 连击奖励封顶 |

### 3.3 实现

- 表 `sign_ins`：`(user_id, date)` 主键，`streak`、`reward_coin`。
- 签到即 `mintCoin`，幂等键 `signin:{userId}:{date}`，重复签到不重复发。
- 入口：地图 HUD 快捷栏「签到」按钮 → `/signin`。

---

## 四、市场（二手集市）

### 4.1 玩法

- 用户**上架**闲置物品（标题 + 描述 + 金币价格），**认证为学员**（`student`/`admin`）后才可买卖。
- 他人**购买**：直接成交，买家付全额，卖家收净额，**手续费进奖池**。
- 每人同时在售挂单有上限（`market.maxActiveListings`，默认 20）。

### 4.2 成交与手续费

```
价格 price → 买家付 price（sink）
            → 卖家收 net = price - fee（mint）
            → 奖池 += fee（fee = floor(price × coin.tradeFeeRate)）
```

`coin.tradeFeeRate` 默认 `0.05`（5%）。

### 4.3 实现

- 表 `market_listings`（挂单：`active` / `sold` / `removed`）、`market_orders`（订单，记录 `fee_coin`）。
- 入口：HUD 快捷栏「市场」按钮 → `/market`。

---

## 五、奖池 + 抽奖

### 5.1 奖池（treasury）

- 单行表 `treasury`（`id = 1`，`balance_coin`）。
- 资金来源：**市场交易手续费**。
- 资金去向：**抽奖奖金**。

### 5.2 抽奖

- 每次抽奖花费 `lottery.cost`（默认 50）金币，费用 `sink` 销毁。
- 奖金从 `lottery.prizes`（默认 `[5, 10, 20, 50, 100, 200]`）随机，并从**奖池**支出。
- 奖池余额不足（低于最低奖金）时拒绝抽奖，提示等待手续费补充。

### 5.3 实现

- 入口：地图右侧 **GACHA** 按钮 → `/lottery`。

---

## 六、数据表

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | exp, coin, frozen_coin | 经验（等级）+ 金币账户 |
| `exp_transactions` | to_user_id, amount, type, source, idempotency_key | 经验发放流水（只发不扣） |
| `coin_transactions` | from_user_id, to_user_id, amount, type, related_type, related_id, note, idempotency_key | 金币流水（mint/freeze/transfer/refund/sink） |
| `sign_ins` | user_id, date, streak, reward_coin | 每日签到（user_id + date 主键） |
| `market_listings` | seller_id, type, title, description, price_coin, status | 市场挂单 |
| `market_orders` | listing_id, buyer_id, seller_id, price_coin, fee_coin, status | 市场订单 |
| `treasury` | id(=1), balance_coin | 公共奖池 |

---

## 七、API 清单

**钱包 / 配置**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/coin/wallet` | 我的账户（exp/level/coin/frozenCoin） |
| GET | `/api/coin/config` | 金币经济配置 |
| GET | `/api/coin/transactions` | 我的金币流水 |

**签到**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/signin` | 签到状态（连击/今日奖励/近 7 天） |
| POST | `/api/signin` | 签到领金币 |

**市场**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/market` | 在售挂单 |
| GET | `/api/market/mine` | 我的挂单 + 买入/卖出 |
| POST | `/api/market` | 发布挂单 |
| DELETE | `/api/market/:id` | 下架我的挂单 |
| POST | `/api/market/:id/buy` | 购买 |

**奖池 / 抽奖**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/lottery` | 奖池余额 + 抽奖配置 |
| POST | `/api/lottery/draw` | 抽奖 |

---

## 八、配置项（`server/config.js`）

| 分组 | 配置 | 默认 | 说明 |
|---|---|---|---|
| `coin` | `capRatio` | 0.2 | 单任务赏金 ≤ 金币 × 20% |
| `coin` | `capAbsolute` | 500 | 单任务赏金硬上限 |
| `coin` | `dailyAccept` | 300 | 每日接取获得金币上限 |
| `coin` | `dailyPairTransfer` | 3 | 每日同对用户金币往来上限 |
| `coin` | `tradeFeeRate` | 0.05 | 市场交易手续费率 |
| `exp` | `todoComplete` / `taskComplete` | 10 | 完成备忘/任务的行为经验 |
| `exp` | `dailyCap` | 300 | 每日行为经验上限 |
| `signin` | `base` / `streakBonus` / `streakMaxBonus` | 10 / 2 / 20 | 签到奖励 |
| `market` | `maxActiveListings` | 20 | 每人同时在售上限 |
| `lottery` | `cost` / `prizes` | 50 / [5,10,20,50,100,200] | 抽奖花费与奖金 |

---

## 九、防刷与治理

1. **签到**：`user_id + date` 主键 + 幂等键，一天最多一次。
2. **市场**：买卖需 `student`/`admin` 认证（`member` 不能刷交易）；不能买自己的挂单；在售上限。
3. **任务赏金**：每日发放/往来上限（见 `TASKS.md`）。
4. **行为经验**：每日上限 `exp.dailyCap`，完成行为幂等（每任务只发一次）。
5. **审计**：异常行为写 `audit_logs` 打标（当前只记录不封禁）。

---

## 十、后续可扩展（已留接口）

- **剧情**：编辑接入后，节点完成调用 `grantExp(uid, n, { source: 'story' })` 和 `mintCoin(uid, n, { source: 'story' })` 发奖励即可。
- **商铺**：`market_listings.type` 已预留 `'shop'`，可加 `shops` 表（租金/保证金）。
- **有趣机制**：地图打卡签到、成就发币、赏金加急置顶、集市活动（奖池抽盲盒/拍卖）。
