# treasury 真实账户化迁移记录

## 1. 迁移原因

旧 treasury 是「账面数字」（单行表 `balance_coin`），与真实金币脱节：

- 手续费 / 租金 / 喇叭费：金币被 `sink` 销毁，同时 `addTreasury` 账面 `+N` —— 金币凭空减少、账面凭空增加；
- 抽奖奖金：`spendTreasury` 账面 `−N`，同时 `mint` 铸造金币 —— 金币凭空增加、账面凭空减少。

账务不闭合、无法审计，故迁移为「SYSTEM 真实金币账户」。

## 2. SYSTEM 账户语义

- SYSTEM 是 `users` 表里的一条真实用户行（`nickname='SYS'`、`role='system'`）。
- 它是**唯一奖池**：手续费、摊位费 50%、租金 50%、喇叭费、秒杀收入都进它的 `coin`；抽奖奖金从它的 `coin` 出。
- 不参与交易（`requireRole('student','admin')` 天然拦截），`frozen_coin` 恒 0。
- 从用户列表 / 排行榜 / 搜索中被排除。

## 3. 各 Step commit

| commit | 内容 |
|---|---|
| 6aeb565 | Step 1：coin.js `pay` 直接划转 + SYSTEM 真实账户 + 市场/用户接口 SYSTEM 保护 |
| 2cac724 | Step 2：官方秒杀迁移（cost_coin + pay 到 SYSTEM + budget_spend 纯记账） |
| 1e2b188 | Step 3-A：交易手续费迁移 pay(buyer→SYSTEM) + fee_treasury ledger |
| 438ff84 | Step 3-A.1：手续费纯 A（transfer(buyer→SYSTEM) 单笔，删 refund+pay） |
| 58872c4 | Step 3-B：店铺租金 50/50 拆分 + 喇叭费 pay 进 SYSTEM |
| d5be10f | Step 4：抽奖迁移 pay(SYSTEM→winner) + lottery_draws |
| 889208a | Step 5-A：audit 口径更新（读 SYSTEM 账户） |
| a829e68 | Step 5-B-3a：修 market.js 2 处 treasuryBalance 漏网 |
| 0337269 | Step 5-B-3b-1：删旧 treasury 账面函数 |
| （本次） | Step 5-B-3b-2：删 treasury 表 + 迁移文档，milestone 1 完成 |

## 4. 抽奖余额不足规则

- 入口：`pool = SYSTEM.coin`，`pool < minPrize` → 409（不落 lottery_draws、不扣任何钱）。
- 事务内：`prize = min(配置随机, pool)`（clamp 到 SYSTEM 余额），保证「付了 cost 一定有奖」，且 `prize ≤ pool` 不会透支。

## 5. sink 幂等键 TODO

抽奖费 `sink(cost)` 幂等键是 `lottery:{userId}:{randomUUID}`，每抽新 uuid，**无请求级幂等**。
TODO：后续加客户端 `client_request_id`，防网络重试重复扣 cost。

## 6. −30 历史项

v0 迁移把旧 `available_exp` 回填为 `coin`（约 30），但未写对应 `mint` 流水，导致账本少记 30。
已在 audit 白名单中标注，不视为账务异常。

## 7. audit 公式

```
SUM(users.coin + frozen_coin) = mint − sink + 30
```

- `mint` / `sink` 从 `coin_transactions` 按 type 求和；
- `pay` / `transfer` / `freeze` / `refund` 守恒，不计入；
- 30 为历史回填白名单；目标 `unexplained = 0`。

## 8. 迁移遗漏记录

`treasuryBalance` 在 `market.js` 的 2 处调用（`buyOfficialFlashSale` 返回 + `GET /market/session`）在 Step 2/3 迁移时漏查，导致「奖池」字段读旧表恒 0。`a829e68` 已修为读 SYSTEM 账户 coin。

## 9. 教训

迁移时 grep 要覆盖：**函数名 + 字段名 + import + CREATE 语句 + 表名**，不能只查函数调用。
