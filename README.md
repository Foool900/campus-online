# 🎓 Campus Online · 河南大学校园游戏化社交原型

Campus Online 是一个**轻量级前后端分离**的校园地图游戏化社交原型，面向河南大学。包含**明伦、金明两个校区**的卡通手绘示意地图，每个地点用 emoji 符号标注，点击进入该区域的对话框（分「活动区」发帖 +「聊天区」多人实时聊天）；同时提供任务/备忘、每日签到、二手市场与奖池抽奖、经验值与等级、金币、排行榜、成就、个人页等游戏化功能。

> 原型定位：纯本地运行，所有数据存储在本地 SQLite。不做实名、不做支付、不复制真实地图、不使用官方校徽等受版权保护素材。

## 功能导览（新手指南）

### 快速开始

1. 打开网址，首次进入会弹出昵称框——输入**昵称**和**学院**即可（匿名登录，无需注册）。
2. 进入后是一张**校园大地图**，含明伦、金明两个校区，可切换。
3. 点地图上任意**地点标记**（图书馆、操场、食堂……）即可进入该地点的「频道」。

### 核心功能

**🗺️ 校园地图**
- 拖动浏览校园，手机端双指捏合缩放。
- 左上角小地图切换校区；小地图右下角按钮切换横屏 / 竖屏布局。

**🌐 世界频道**
- 屏幕底部的公共聊天室，全校同学实时可见。

**📌 活动（核心玩法）**
- 每个地点的「活动区」可发布活动（约自习 / 约跑 / 分享资料……）。
- 点活动卡片进入「活动详情页」，详情页 = **活动信息区 + 专属聊天频道**。

**💬 频道里能玩什么**
- 发消息：Enter 发送、Shift+Enter 换行；失败可重试。
- @ 提及：输入 `@` 弹出成员列表（在线优先）。
- 回复：悬停消息（手机长按）点「↩️」，带引用条并自动 @ 对方。
- 表情回应：给消息加表情（👍❤️😂🎉…），重复点取消。
- 撤回：自己消息 2 分钟内可撤；管理员不限时且可撤他人。
- 已读：自己消息显示「已读 N 人」，可展开名单。
- 在线成员：头像右下角绿点；顶部「在线 N 人」可展开。
- 表情包：发系统 emoji，或上传自定义表情包（png/jpg/gif/webp，≤2MB，每人 50 张）。

**👑 角色与权限**

| 角色 | 能力 |
| --- | --- |
| 发起人（管理员） | 改活动状态、写备注、撤回任何消息 |
| 参与者（报名后） | 发言、表情、@、回复、撤回自己的消息 |
| 访客（未报名） | 只读围观（输入框禁用并提示） |

**🔁 活动状态**

```
报名中 → 进行中 → 已结束 / 已取消
```

- 仅「报名中」可报名；终态（已结束 / 已取消）全员只读。

**✅ 任务 / 🏆 排行榜 / 成就 / 👤 个人页**
- 任务：完成私密备忘 / 公开任务赚经验（等级）；公开任务赏金用金币托管。
- 排行榜：按经验值全校排名。
- 成就：发帖、聊天、跑图、升级解锁徽章。
- 个人页：改昵称 / 学院，查看等级、经验与金币余额。

**📅 签到 / 🏪 市场 / 🎰 奖池**
- 签到：每日签到领金币，连续签到奖励递增。
- 市场：二手集市，上架闲置物品、金币成交，交易手续费流入奖池。
- 奖池：用金币抽奖，奖金从奖池（手续费累积）支出。

**📱 手机端**
- 横竖屏自动适配，横屏为「手游 HUD」风格。
- 活动卡片展示状态徽章、在线数、未读数、@我 / 回复我红点。
- 输入框吸底并避开安全区，键盘弹起时消息流自动上推。

## 功能截图（占位）

| 校园地图 | 频道聊天 | 任务 | 排行榜 |
| --- | --- | --- | --- |
| ![校园地图](docs/screenshots/map.png) | ![频道聊天](docs/screenshots/chat.png) | ![任务](docs/screenshots/tasks.png) | ![排行榜](docs/screenshots/leaderboard.png) |

> 上述为占位图。运行后自行截图，放入 `docs/screenshots/` 目录即可。

## 技术栈

- **前端**：React 19 + Vite 8 + React Router 7 + 手写 CSS（图标用 emoji / 内联 SVG，不用 Tailwind）
- **后端**：Node.js + Express 5 + Socket.IO 4
- **数据库**：SQLite（better-sqlite3 13），文件位于 `server/data/campus.db`
- **进程管理**：concurrently（一键同时启动前后端）
- **环境要求**：Node.js >= 22（better-sqlite3 13 依赖 Node 22 的预编译二进制）

## 目录结构

```
campus-online/
├── package.json            # 根脚本：dev / build / start
├── .gitignore              # 忽略 node_modules、dist、server/data、*.db、.env
├── README.md
├── ecosystem.config.cjs    # PM2 部署配置
├── render.yaml             # Render 一键部署配置
├── DEPLOY.md               # 部署指南
├── server/                 # 后端
│   ├── index.js            # Express + Socket.IO 入口（含在线成员 presence）
│   ├── db.js               # SQLite 连接、建表、迁移
│   ├── seed.js             # 种子数据
│   ├── presence.js         # 在线成员内存集合
│   ├── exp.js              # 经验发放（只发不扣）
│   ├── coin.js             # 金币流转（唯一写入入口）
│   ├── treasury.js         # 公共奖池
│   ├── data/               # campus.db 与上传文件（已 gitignore）
│   └── routes/
│       ├── areas.js        # 区域
│       ├── channels.js     # 频道
│       ├── messages.js     # 频道消息 + 活动消息（回复/提及/回应/已读/撤回）
│       ├── posts.js        # 活动帖 + 详情/加入/状态机/备注
│       ├── stickers.js     # 自定义表情包上传/列表/删除
│       ├── tasks.js        # 任务（公开/私密 + 讨论区）
│       ├── coin.js         # 金币钱包 / 配置 / 流水
│       ├── signin.js       # 每日签到
│       ├── market.js       # 二手市场（挂单/购买）
│       ├── lottery.js      # 奖池抽奖
│       ├── users.js        # 用户 / 排行榜
│       ├── campuses.js     # 校区
│       ├── achievements.js # 成就
│       └── world.js        # 世界频道
└── client/                 # 前端
    ├── package.json
    ├── index.html
    ├── vite.config.js      # 5173，proxy /api 与 /socket.io → 3001
    └── src/
        ├── main.jsx
        ├── App.jsx         # 路由 + 用户状态 + 首登弹窗
        ├── api.js          # fetch 封装
        ├── socket.js       # socket.io-client 单例
        ├── UserContext.jsx # 用户上下文
        ├── colleges.js     # 学院列表
        ├── styles.css      # 浅色主题
        ├── hud.css         # 游戏 HUD 主题（覆盖样式）
        ├── components/
        │   ├── Layout.jsx           # HUD 外壳（全屏地图 + 悬浮面板）
        │   ├── HeDaMap.jsx          # 卡通校园 SVG 地图（分校区）
        │   ├── AreaDialog.jsx       # 区域对话框（活动区 + 聊天区）
        │   ├── PostEditor.jsx       # 活动帖发布编辑器
        │   ├── MobileHud.jsx        # 手机端 HUD（横竖屏）
        │   ├── WorldChat.jsx        # 世界频道
        │   ├── HudPanels.jsx        # HUD 悬浮面板集合
        │   ├── HudOverlay.jsx       # 覆盖式页面面板
        │   └── NicknameModal.jsx    # 首登弹窗
        └── pages/
            ├── MapPage.jsx           # 地图页（legacy，未启用）
            ├── TasksPage.jsx         # 任务页
            ├── LeaderboardPage.jsx   # 排行榜
            ├── AchievementsPage.jsx  # 成就页
            ├── ProfilePage.jsx       # 个人页
            ├── SignInPage.jsx        # 每日签到
            ├── MarketPage.jsx        # 二手市场
            ├── LotteryPage.jsx       # 奖池抽奖
            └── ActivityDetailPage.jsx# 活动详情页（信息区 + 频道）
```

## 安装与启动

```bash
# 1. 安装全部依赖（根 + server + client）
npm run install:all

# 2. 同时启动前后端
npm run dev
```

启动后浏览器打开 **http://localhost:5173**，首次进入会要求填写昵称和学院。

也可以分开启动：

```bash
npm run server   # 仅后端（http://localhost:3001）
npm run client   # 仅前端（http://localhost:5173）
```

## 默认端口

| 服务 | 地址 |
| --- | --- |
| 前端（Vite） | http://localhost:5173 |
| 后端（Express + Socket.IO） | http://localhost:3001 |

前端通过 Vite 代理把 `/api` 和 `/socket.io` 转发到后端 3001，因此浏览器只需访问 5173。

## API 列表

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/campuses` | 列出所有校区 |
| GET | `/api/areas` | 列出所有区域（可加 `?campusId=` 按校区过滤） |
| PATCH | `/api/areas/:id` | 更新区域坐标（编辑模式拖拽） |
| GET | `/api/areas/:areaId/channels` | 某区域下的频道 |
| GET | `/api/channels/:channelId/messages` | 频道历史消息 |
| POST | `/api/channels/:channelId/messages` | 发送频道消息（`{ userId, content }`） |
| GET | `/api/channels/:channelId/posts` | 活动帖列表（`?userId=` 附带在线/未读/@我 卡片聚合） |
| POST | `/api/channels/:channelId/posts` | 发布活动帖（`{ userId, title, content, category }`） |
| GET | `/api/posts/:id` | 活动详情（`?userId=` 返回 role/状态/参与者） |
| POST | `/api/posts/:id/join` | 报名/加入（仅「报名中」状态） |
| PATCH | `/api/posts/:id/status` | 管理员改状态（写系统消息 + 操作日志） |
| GET | `/api/posts/:id/notes` | 活动备注（按角色过滤可见性） |
| POST | `/api/posts/:id/notes` | 管理员加备注 |
| GET | `/api/posts/:id/messages` | 活动讨论区历史消息 |
| POST | `/api/posts/:id/messages` | 发活动消息（`{ userId, type, content, replyTo, mentions }`） |
| POST | `/api/posts/:id/messages/:mid/recall` | 撤回消息（自己 2min 内 / 管理员） |
| POST | `/api/posts/:id/messages/:mid/react` | 表情回应（toggle） |
| GET | `/api/posts/:id/messages/:mid/reads` | 已读名单（懒加载） |
| POST | `/api/posts/:id/read` | 标记已读（`{ userId, upToMessageId }`） |
| GET | `/api/stickers` | 我的表情包（`?userId=`） |
| POST | `/api/stickers` | 上传表情包（raw 二进制，≤2MB，png/jpg/gif/webp） |
| DELETE | `/api/stickers/:id` | 删除表情包 |
| GET | `/api/achievements?userId=...` | 成就列表（含当前进度与解锁状态） |
| GET | `/api/coin/wallet` | 我的账户（exp/level/coin/frozenCoin） |
| GET | `/api/coin/config` | 金币经济配置（上限等） |
| GET | `/api/signin` | 签到状态（连击/今日奖励） |
| POST | `/api/signin` | 签到领金币（幂等） |
| GET | `/api/market` | 在售挂单列表 |
| GET | `/api/market/mine` | 我的挂单 + 买入/卖出记录 |
| POST | `/api/market` | 发布挂单（`{ title, description, priceCoin }`） |
| DELETE | `/api/market/:id` | 下架我的挂单 |
| POST | `/api/market/:id/buy` | 购买（手续费进奖池） |
| GET | `/api/lottery` | 奖池余额 + 抽奖配置 |
| POST | `/api/lottery/draw` | 抽奖（奖金从奖池支出） |
| GET | `/api/users/:id` | 单个用户信息 |
| PATCH | `/api/users/:id` | 修改昵称/学院（`{ nickname?, college? }`） |
| GET | `/api/leaderboard` | 按经验值降序排行榜 |
| POST | `/api/users` | 首次创建/复用用户（`{ nickname, college }`） |

### Socket.IO 事件（实时聊天）

- 房间名：`channel:{channelId}`（世界/区域聊天）、`post:{postId}`（活动讨论区）
- 客户端 → 服务端：`join:channel` / `leave:channel`（`{ channelId }`）
- 客户端 → 服务端：`join:post` / `leave:post`（`{ postId, userId }`，带在线成员追踪）
- 客户端 → 服务端：`message:send`（`{ channelId, postId, userId, content, type, replyTo, mentions }`，带 ack 回调）
- 服务端 → 客户端：`message:new`（新消息）、`message:reaction`（回应变更）、`message:recalled`（撤回）、`presence:update`（在线成员）、`post:status`（活动状态变更）

## 数据模型

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `users` | id, nickname, college, avatar, exp, coin, frozen_coin, role, created_at | 用户 / 经验等级 / 金币 |
| `campuses` | id, name, slug | 校区（明伦 / 金明） |
| `areas` | id, campus_id, name, slug, description, x, y, color, emoji, hidden | 地图地点（hidden 用于隐藏世界频道区域） |
| `channels` | id, area_id, name | 每个地点一个频道 |
| `messages` | id, channel_id, user_id, post_id, type, content, reply_to, mentions, recalled_at, recalled_by, created_at | 消息（`post_id` 区分活动讨论；`type` = text/sticker/system/recalled） |
| `posts` | id, channel_id, user_id, title, content, category, status, created_at | 活动帖（`status` = draft/open/ongoing/ended/cancelled） |
| `post_participants` | post_id, user_id, created_at | 活动参与者（发起人默认参与者，不重复入库） |
| `post_notes` | id, post_id, content, created_by, created_at, visible_to_participants | 活动备注 |
| `post_operation_logs` | id, post_id, operator_id, action, old_value, new_value, created_at | 操作日志（状态变更等） |
| `message_reactions` | message_id, emoji, user_id, created_at | 消息表情回应（同一用户同一 emoji 只计一次） |
| `message_reads` | message_id, user_id, read_at | 消息已读 |
| `stickers` | id, user_id, url, created_at | 自定义表情包（按用户隔离，每人 ≤50） |
| `tasks` | id, publisher_id, assignee_id, type, title, description, tags, reward_coin, status, ... | 任务（公开赏金 / 私密备忘） |
| `exp_transactions` | id, to_user_id, amount, type, source, idempotency_key, created_at | 经验发放流水（只发不扣） |
| `coin_transactions` | id, from_user_id, to_user_id, amount, type, related_type, related_id, note, idempotency_key, created_at | 金币流水（mint/freeze/transfer/refund/sink） |
| `sign_ins` | user_id, date, streak, reward_coin, created_at | 每日签到记录（user_id + date 主键） |
| `market_listings` | id, seller_id, type, title, description, price_coin, status, ... | 市场挂单（二手） |
| `market_orders` | id, listing_id, buyer_id, seller_id, price_coin, fee_coin, status, ... | 市场订单（记录手续费） |
| `treasury` | id(=1), balance_coin | 公共奖池（手续费流入） |
| `achievements` | id, code, name, description, icon, metric, threshold | 成就定义（进度由现有数据动态计算） |

- 活动状态：`draft(草稿)` / `open(报名中)` / `ongoing(进行中)` / `ended(已结束)` / `cancelled(已取消)`；终态不可再变。
- 角色：`admin`（发起人，不可转让）/ `participant`（已加入）/ `guest`（访客）；服务端每个写接口独立鉴权。
- 任务状态见 `TASKS.md`：私密 `todo`/`done`，公开 `published → accepted → submitted → approved` 等。
- 等级规则：`level = floor(exp / 100) + 1`；完成私密备忘 / 公开任务加行为经验（默认 10，幂等保护）；公开任务赏金为金币。

## 已知限制

- 本仓库为**原型**，数据保存在本地 SQLite（部署环境需备份 `server/data/campus.db` 持久化）。
- **无实名、无登录**：以 localStorage 中的 `campus_user` 标识匿名用户，同名用户会被复用。
- **地图为手绘示意 SVG**：不复制官方地图素材与校徽；地点名称来自两校区地点清单。
- 聊天内容仅做**基础过滤**（空消息拦截、长度限制、前端安全渲染，不渲染 HTML），无敏感词过滤。
- **在线成员为内存态**：服务重启即清空；已读人数非实时推送（进入页面 / 新消息时落库）。
- 无私聊、群聊管理、支付；表情包上传为本地磁盘存储，无 CDN。

## 常见问题

### 1. 端口被占用

```bash
# Windows：查看占用 3001 / 5173 的进程
netstat -ano | findstr 3001
netstat -ano | findstr 5173

# 结束对应 PID
taskkill /F /PID <PID>
```

也可以在 `server/index.js` 修改后端端口（默认 3001），或在 `client/vite.config.js` 修改前端端口（默认 5173），并同步更新代理 `target`。

### 2. better-sqlite3 安装失败

better-sqlite3 是原生模块，一般会下载预编译二进制。若安装报编译错误，请按以下顺序尝试：

1. 确保 Node 版本 >= 22（better-sqlite3 13 依赖 Node 22 的预编译二进制）。
2. 安装 Windows 构建工具（需要 C++ 编译器和 Python）：
   ```bash
   npm install -g windows-build-tools
   ```
3. 手动指定一个与你 Node 版本匹配的版本：
   ```bash
   cd server && npm install better-sqlite3@13
   ```

### 3. 如何重置数据库

直接删除数据库文件，下次启动会自动重新写入种子数据：

```bash
# Windows（Git Bash）
rm -f server/data/campus.db server/data/campus.db-wal server/data/campus.db-shm
```

### 4. 首次打开提示昵称已存在 / 想换个新账号

本原型按昵称复用用户。想重新开始：清除浏览器 localStorage（`campus_user` 键）并重置数据库即可。
