# 任务系统说明书

> 本文档说明「任务系统」的使用方式与实现细节，面向使用者和后续维护者。
> 电脑端、手机端共用同一套接口、消息组件和状态机，仅布局不同。

---

## 一、功能概览

任务系统是经验体系的核心玩法，分两类任务：

| 类型 | 可见范围 | 经验 | 说明 |
|---|---|---|---|
| **公开任务** | 所有人可见可接取 | 有（托管） | 发布时冻结经验奖励，接取者完成后由发布者验收划转；「通缉令」即高奖励+标签+截止时间+置顶展示的公开任务 |
| **私密备忘** | 仅自己可见 | 无（恒为 0） | 个人待办，可完成打卡、可设截止时间和标签 |

配套能力：

- **经验账户**：累计 / 可用 / 冻结三字段，统一托管流转。
- **任务讨论区**：每个公开任务一个独立讨论区，复用统一消息组件（文本、@、表情、表情包、回复、撤回、已读）。
- **状态机**：发布 → 接取 → 提交 → 验收/驳回/终止/过期/取消，全流程服务端校验。
- **防刷规则**：每日额度、同对往来次数、最短完成时间、凭证必填等，全部服务端强制。

---

## 二、用户使用说明

### 2.1 入口

地图 HUD 的「任务」按钮（电脑端在左上角小地图右侧，手机端在快捷栏）进入**任务中心**（`/tasks`）。

### 2.2 经验钱包

任务中心顶部展示当前账户：

- **等级** Lv.：由累计经验 `level = floor(totalExp / 100) + 1` 决定。
- **累计经验**：只增不减，决定等级。
- **可用经验**：可被托管、可支配。
- **冻结经验**：发布公开任务后被托管的部分，任务结束才会退回或划转。

### 2.3 发布任务

点「＋ 发布任务」展开表单：

1. 选**类型**：公开任务 / 私密备忘。
2. **公开任务**可设经验奖励，上限 = `min(可用经验 × 20%, 500)`，超限或余额不足会被拒绝；**选私密**时奖励输入框禁用并强制为 0。
3. 填写标题（必填）、标签（逗号分隔，最多 5 个）、描述、截止时间（可选）。
4. 发布后：
   - 公开任务：立即从「可用经验」冻结奖励额到「冻结经验」。
   - 私密备忘：直接进入待办列表，无经验流转。

### 2.4 公开任务全流程

```
发布者 A 发布（冻结奖励）→ 接取者 B 接取 → B 提交凭证 → A 验收通过（经验划转给 B）
```

- **接取**：任务状态「可接取」时，非发布者可接取；自己不能接自己的任务。
- **提交**：接取者需附**凭证**（文本 / 图片链接 / 链接至少一项）；任务发布后 10 分钟内不能提交。
- **验收**：发布者可「通过」或「驳回」。
  - 通过：冻结经验从发布者划转到接取者（累计 + 可用同增），发布者冻结清零。
  - 驳回：回到「进行中」可重新提交；累计驳回 3 次则任务**终止**，冻结经验退回发布者。
- **放弃**：接取者可放弃（回到「可接取」）。
- **取消**：发布者可取消非终态任务（冻结经验退回）。
- **过期**：到截止时间仍未完成则自动过期，冻结经验退回发布者（默认；可配置自动通过）。

### 2.5 私密备忘

- 仅自己可见，出现在「私密备忘」筛选下。
- 可「完成打卡」→「撤销完成」来回切换，无经验、无托管。

### 2.6 任务讨论区

公开任务详情页右侧是讨论区：

- **发布者与接取者可发言**，其他人只读（提示「接取任务后即可参与讨论」并可一键接取）。
- 支持文本、@ 提及（发布者/接取者）、表情、表情包、回复、撤回（发布者可撤任意，本人 2 分钟内可撤）、已读。
- 状态变更（被接取 / 提交 / 通过 / 驳回 / 取消 / 过期等）由服务端自动写入系统消息。
- 任务进入终态（通过 / 终止 / 过期 / 取消）后讨论区只读。
- 消息严格按任务隔离，不会串到其他任务或其他会话。

### 2.7 列表筛选

任务中心四个筛选：

- **公开任务**：所有公开任务。
- **我发布的**：我发布的任务（公开 + 私密）。
- **我接取的**：我接取的任务。
- **私密备忘**：我的私密备忘。

支持按截止时间排序（列表接口 `sort=deadline`）。

---

## 三、经验账户与托管规则

### 3.1 三字段

都在 `users` 表：

| 字段 | 含义 | 规则 |
|---|---|---|
| `exp` | 累计经验（totalExp） | 只增不减，决定等级 |
| `available_exp` | 可用经验 | 可托管、可支配 |
| `frozen_exp` | 冻结经验 | 托管中 |

### 3.2 托管流转

| 操作 | 类型 | 效果 | 幂等键 |
|---|---|---|---|
| 发布公开任务 | `freeze` | 可用 → 冻结（发布者） | `task:{id}:freeze` |
| 验收通过 | `transfer` | 冻结（发布者）→ 累计+可用（接取者） | `task:{id}:approve` |
| 取消 / 过期 / 终止 | `refund` | 冻结 → 可用（发布者） | `task:{id}:refund` |
| 旧待办完成 | `grant` | 累计+可用（本人） | `todo:{id}:complete` |

- 托管（freeze/refund）**不改变累计经验**。
- 私密备忘奖励恒 0，不走托管。
- **所有经验加减都走 `server/exp.js` 统一入口**（带事务 + 幂等键），禁止在别处直接改字段。

### 3.3 等级

`level = floor(totalExp / 100) + 1`，定义在 `server/config.js` 的 `levelOf`（单一来源）。

---

## 四、任务状态机

### 私密备忘

```
todo（待办） ⇄ done（已完成，可撤销）
```

### 公开任务

```
published（可接取）→ accepted（进行中）→ submitted（待验收）→ approved（已通过）
                                   ↓ 驳回
                              accepted（可重新提交）
                                   ↓ 驳回累计 3 次
                              terminated（已终止，经验退回）
published/accepted/submitted ── 到期无人接/未验收 ──→ expired（已过期，经验退回）
published/accepted/submitted ── 发布者取消 ──→ cancelled（已取消，经验退回）
accepted ── 接取者放弃 ──→ published
```

终态（不可再流转）：`approved` / `terminated` / `expired` / `cancelled`。

每次流转都校验**操作人角色**（发布者 / 接取者 / 系统）和**当前状态**，非法流转返回明确错误码。

---

## 五、上限与防刷规则

### 5.1 上限（配置化，见 `server/config.js`）

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `reward.capRatio` | `0.2` | 单任务奖励 ≤ 可用经验 × 20% |
| `reward.capAbsolute` | `500` | 单任务奖励全局硬上限 |
| `reward.dailyPublishByLevel` | `{ '1-5': 200, '6-10': 500 }` | 每日发布经验总额（按等级分档） |
| `reward.dailyAccept` | `300` | 每日接取获得经验上限 |
| `reward.dailyPairTransfer` | `3` | 每日同一对用户经验往来次数上限 |
| `task.dailyPublishPublic` | `5` | 每日可发公开任务数 |
| `task.minCompleteMinutes` | `10` | 发布后最短提交时间（分钟） |
| `task.maxRejectCount` | `3` | 驳回 N 次后任务终止 |
| `task.expireAction` | `'autoRefund'` | 超时默认退回（可配 `autoApprove`） |

超限时返回明确错误码 + 中文文案。

### 5.2 防刷规则（服务端强制，前端只提示）

1. 不能接取自己发布的任务 → `EX_SELF_ACCEPT`
2. 最短完成时间内不能提交 → `EX_TOO_EARLY`
3. 提交必须附凭证（文本/图片/链接 ≥ 1）→ `EX_PROOF_REQUIRED`
4. 同一对用户每日往来次数受限 → `EX_DAILY_PAIR`
5. 每日发布额度 / 数量、接取获得额度受限 → `EX_DAILY_PUBLISH_EXP` / `EX_DAILY_PUBLISH_COUNT` / `EX_DAILY_ACCEPT`
6. 异常行为（同 IP、同设备、高频互评）写 `audit_logs` 打标，**第一版只记录不封禁**
7. 所有经验流转带幂等键，防止重复划转

---

## 六、技术实现（开发者）

### 6.1 数据模型（新增）

```sql
-- 任务
tasks (
  id, publisher_id, assignee_id,
  type,             -- 'private' | 'public'
  title, description, tags,      -- tags 为 JSON 字符串数组
  reward_exp,       -- private 恒 0
  status,
  min_complete_at, deadline_at,
  submitted_proof,  -- JSON { text, imageUrl, link }
  reject_count,
  created_at, accepted_at, submitted_at, finished_at
)

-- 经验流转流水（append-only，软引用不加外键，避免级联删历史）
exp_transactions (
  id, from_user_id, to_user_id, amount, task_id,
  type,             -- 'freeze' | 'transfer' | 'refund' | 'grant'
  idempotency_key UNIQUE, created_at
)

-- 审计日志（异常打标）
audit_logs (id, user_id, event, detail, ip, user_agent, created_at)
```

用户表 `users` 新增 `available_exp`、`frozen_exp` 两列，`exp` 保留为累计经验。

**迁移**：老用户回填 `available_exp = exp`（历史累计经验全部视为可用），`frozen_exp = 0`，最安全不坑老玩家。

### 6.2 接口清单

**经验**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/exp/wallet` | 我的账户（totalExp/availableExp/frozenExp/level） |
| GET | `/api/exp/config` | 上限配置 |

**任务**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/tasks?filter=&status=&sort=` | 列表（filter: public/mine/assigned/private） |
| POST | `/api/tasks` | 发布（type/title/description/tags/rewardExp/deadlineAt） |
| GET | `/api/tasks/:id` | 详情（含我的角色） |
| POST | `/api/tasks/:id/accept` | 接取 |
| POST | `/api/tasks/:id/submit` | 提交（proof: {text,imageUrl,link}） |
| POST | `/api/tasks/:id/approve` | 验收通过 |
| POST | `/api/tasks/:id/reject` | 驳回 |
| POST | `/api/tasks/:id/cancel` | 发布者取消 |
| POST | `/api/tasks/:id/abandon` | 接取者放弃 |
| PATCH | `/api/tasks/:id/toggle-done` | 私密备忘打卡/撤销 |

**任务讨论区**（复用统一消息模型，`conversation_type = 'task'`）

| 方法 | 路径 |
|---|---|
| GET/POST | `/api/tasks/:id/messages` |
| POST | `/api/tasks/:id/messages/:mid/recall` |
| POST | `/api/tasks/:id/messages/:mid/react` |
| GET | `/api/tasks/:id/messages/:mid/reads` |
| POST | `/api/tasks/:id/read` |

**Socket**：`join:conv` / `leave:conv` / `message:send` 通用（`type='task'`），另广播 `task:status` 同步状态。

### 6.3 配置项

集中在 `server/config.js`（默认值见 5.1），修改位置即该文件。前端展示以服务端 `GET /api/exp/config` 返回为准。

### 6.4 关键实现要点

- **经验统一入口** `server/exp.js`：`applyExpTransaction`（事务版）/ `applyExpRaw`（供外部事务内组合，如旧待办完成），带幂等键 + UNIQUE 兜底。
- **业务函数可测**：`server/routes/tasks.js` 导出 `publishTask` / `acceptTask` / `submitTask` / `approveTask` / `rejectTask` / `cancelTask` / `abandonTask` / `toggleTaskDone` / `listTasks` / `getTaskDetail` / `expireOverdueTasks`，路由层只做权限 + 入参 + socket 推送薄包装。
- **超时扫描**：`index.js` 启动即扫一次，之后每 60s 扫一次 `expireOverdueTasks(io)`。
- **讨论区权限**：发布者 + 接取者可发言，终态只读，私密无讨论区；`messages.js` 新增 `task` 分支。
- **presence**：`task` 在线计数，发布者标记为管理员。
- **前端**：任务中心 `TasksPage.jsx`，任务详情 `TaskDetailPage.jsx`（复用 `ChatChannel`，`API_BY_TYPE` 加 `task` 分支）；`HudOverlay` 对 `/task/`（带斜杠）走全屏渲染，`/tasks` 仍走玻璃面板。

### 6.5 测试

`server/test/`，运行 `npm --prefix server test`（Node 22 内置 `node:test`，零新依赖）：

- `exp.test.js`：经验账户 + 托管事务 + 幂等（15 项）
- `tasks.test.js`：任务状态机 + 上限防刷（15 项）
- `task-messages.test.js`：讨论区隔离/权限（3 项）
- `regression.test.js`：旧会话类型回归（6 项）

---

## 七、部署与迁移说明

- 老库升级：服务重启时 `initDb()` 自动 `ALTER` 补列 + 回填 + 建表，幂等安全，无需手工操作。
- 重置任务数据：删 `server/data/campus.db*` 后重启（会连校园/频道/成就一起重建，注意备份）。
- 部署流程同 `DEPLOY.md`：`git pull && npm run build && pm2 restart campus-online`。
