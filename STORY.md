# 剧情系统（STORY）规格

剧情 = 一条「章节模板」（策划导入） + 每个玩家一份「进度实例」（打卡节点推进）。
**内容（stories/story_nodes）与玩家进度（player_*）彻底分离**，策划改内容不影响玩家进度。

## 核心模型（`server/db.js`）

| 表 | 作用 |
| --- | --- |
| `stories` | 章节模板。`code` 唯一，导入幂等靠它 |
| `story_nodes` | 打卡节点。`seq` 1..N，`UNIQUE(story_id, seq)` |
| `player_stories` | 玩家进度实例。`UNIQUE(user_id, story_id)` 一人一章一份 |
| `player_story_checkins` | 节点打卡。`UNIQUE(user_id, node_id)` 一人一节点一次 |
| `player_story_meta` | 玩家剧情元信息：`first_story_at`（1 周年锚点）+ 计数 |
| `story_pools` | 剧情奖池：`code` 唯一，`draw_cost_coin` 单抽费用 |
| `story_pool_entries` | 奖池条目：`weight` 加权，`UNIQUE(pool_id, story_id)` |
| `story_gacha_draws` | 抽奖记录（审计 / 防刷） |
| `story_timelines` | 时间线故事书定稿快照，`UNIQUE(user_id, period_start_at)` |

奖励**不新建流水表**，复用现有三套账本：
- 经验 → `exp_transactions`（`source='story'`）
- 金币 → `coin_transactions`（`related_type='story'`，`type='mint'` 造币）
- 物品 → `inventory_items`（`source='story'`，`source_ref_id = player_stories.id`）

## 获取方式 `obtain_mode` × 限定时段 `availability`

| `obtain_mode` | 含义 | 状态 |
| --- | --- | --- |
| `claim` | 直接领取 | ✅ 已实现 |
| `task` | 完成指定公开任务后自动发放 | ✅ 已实现（任务表加 `story_id`，仅 admin 可设，验收时发放） |
| `gacha` | 从剧情奖池抽取 | ✅ 已实现（`story_pools` 加权抽取，排除已拥有） |

| `availability` | 含义 |
| --- | --- |
| `permanent` | 常驻，随时可获取 |
| `festival` | 节日限定，受 `window_start_at/window_end_at` 约束；窗口外不可领取 |

规则：
- **节日过期后**：未获得的不可再领取；已获得的永久保留。
- **`timeboxed=1` 的节日剧情**：打卡也受窗口约束，窗口结束未完成 → `player_stories.status='expired'`（终态）。

## 打卡节点

- 状态机：`player_stories.status = in_progress → completed | expired`。
- `sequential`（默认 1）：顺序打卡，前一节点未完成则当前不可打卡；0 表示可乱序。
- `checkin_type`：`none` 纯打卡 | `text` 写文字 | `photo` 传图 | `link` 附链接；凭证复用任务 `proof = { text, imageUrl, link }`。
- `choices_json`：伪分支选择项（只记录、不影响走向），选中值存 `player_story_checkins.choice`，进时间线故事书。

## 完成奖励

打满整章触发一次 `in_progress → completed` 状态迁移，在**同一事务**内发三样奖励，幂等靠「单次状态迁移」+ exp/coin 幂等键（`story:run:{playerStoriesId}:complete:*`）双保险：

```
rewards_json = { exp, coin, items: [{ kind, name, icon, rarity, description }] }
```

`kind` 预留（v1 仅 `emoji`），未来接功能二「虚拟角色」的 `wardrobe` 装扮。

## 时间线故事书

- 锚点：`player_story_meta.first_story_at`（首次获得剧情）。
- 满 `config.story.anniversaryDays`（365）天 → `isAnniversary` 解锁定稿。
- 内容 = 剧情主干（完成章节 / 打卡数 / 选择聚合 / 剧情物品）+ 全站足迹（发言、帖子、任务、签到、成就、市场、好友、经验金币累计）。
- 实时预览：`GET /api/stories/timeline`（未满周年也能看）。
- 定稿：`finalizeDueTimelines()` 扫描（boot + 每 60s），满周年时把实时内容快照进 `story_timelines` 并发一枚「时间线故事书」纪念物品（epic，可橱窗展示/交易），幂等。

## 策划导入（仅 admin）

`POST /api/stories/import`，body 为章节数组（或单个），按 `code` **upsert**，节点整章替换（全量快照，幂等）：

```json
{
  "code": "freshman-week",
  "title": "新生周打卡",
  "subtitle": "用七天认识你的校园",
  "cover": "🎒",
  "category": "日常",
  "obtainMode": "claim",
  "availability": "permanent",
  "timeboxed": false,
  "rewards": { "exp": 50, "coin": 100, "items": [{ "name": "开学纪念徽章", "icon": "🎖️", "rarity": "rare" }] },
  "nodes": [
    { "seq": 1, "title": "逛一圈校园", "description": "线下走一遍", "checkinType": "photo", "tips": "拍一张地标照" },
    { "seq": 2, "title": "吃一次食堂", "checkinType": "none" }
  ]
}
```

图片资源走现有 `/uploads`。`seed.js` 的 `ensureStories()` 内置 3 条演示剧情。

## API（`server/routes/stories.js`，挂载于 adminRouter 之前）

```
GET  /api/stories                 剧情大厅（含我的进度）
GET  /api/stories/mine            我的剧情库
GET  /api/stories/timeline        时间线故事书
GET  /api/stories/pools           剧情奖池列表（含我的拥有情况）
POST /api/stories/pools/import    批量导入奖池（admin）
POST /api/stories/pools/:id/draw  抽一次（student+）
POST /api/stories/upload          打卡图片上传（raw 图片，student+）
POST /api/stories/import          策划批量导入剧情（admin）
GET  /api/stories/:id             章节详情（含节点解锁状态）
POST /api/stories/:id/claim       直接领取（student+）
POST /api/stories/:id/checkin     节点打卡（body: { nodeId, proof, choice }，student+）
```

权限：浏览/详情登录即可；领取/打卡要求 `student`/`admin`（剧情发经验金币物品，属经济行为，实名后才开放）。

## 前端

- `/story`（`StoryPage.jsx` 大厅）、`/story/:id`（`StoryDetailPage.jsx` 打卡时间轴）、`/story/timeline`（`StoryBookPage.jsx` 故事书）。
- **卡池 `/lottery`（`LotteryPage.jsx`）**：统一抽卡中心，含「金币祈愿」与「剧情祈愿」两个分页；剧情祈愿即剧情奖池（`/story/pool` 已并入此处）。样式参考原神/鸣潮横幅 + 祈愿按钮 + 结果揭示动画（`gacha.css`）。
- 导航：桌面 `QuickBar`、手机 `Sidebar` 均新增「剧情」入口；剧情大厅顶部可跳转「剧情祈愿」。
- 样式 `story.css` / `gacha.css`（复用夜市深空暗黑主题变量）。

## 待办（后续阶段）

1. **打卡凭证人工审核**：当前仅敏感词过滤 + 事后举报，如需「官方认证」节点走现有 `verification` 审核链路。
