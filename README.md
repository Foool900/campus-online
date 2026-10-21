# 🎓 Campus Online · 河南大学校园游戏化社交原型

Campus Online 是一个**轻量级前后端分离**的校园地图游戏化社交原型，面向河南大学。包含**明伦、金明两个校区**的卡通手绘示意地图，每个地点用 emoji 符号标注，点击进入该区域的对话框（分「活动区」发帖 +「聊天区」多人实时聊天）；同时提供任务/待办、经验值与等级、排行榜、成就、个人页等游戏化功能。

> 原型定位：纯本地运行，所有数据存储在本地 SQLite。不做实名、不做支付、不复制真实地图、不使用官方校徽等受版权保护素材。

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
- **环境要求**：Node.js >= 18（本项目在 Node 24 上开发验证通过）

## 目录结构

```
campus-online/
├── package.json            # 根脚本：dev / install:all
├── .gitignore              # 忽略 node_modules、dist、server/data、*.db、.env
├── README.md
├── server/                 # 后端
│   ├── package.json
│   ├── index.js            # Express + Socket.IO 入口
│   ├── db.js               # SQLite 连接与建表
│   ├── seed.js             # 种子数据（区域/频道/示例消息/示例任务）
│   ├── data/               # campus.db 所在目录（已 gitignore）
│   └── routes/
│       ├── areas.js        # 区域（可按校区过滤）
│       ├── channels.js     # 频道
│       ├── messages.js     # 消息（REST + Socket.IO 共用 insertMessage）
│       ├── posts.js        # 活动帖
│       ├── todos.js        # 待办
│       ├── users.js        # 用户 / 排行榜
│       ├── campuses.js     # 校区
│       └── achievements.js # 成就
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
        ├── styles.css      # 全部样式
        ├── components/
        │   ├── Layout.jsx        # 顶部导航
        │   ├── NicknameModal.jsx # 首登弹窗
        │   ├── HeDaMap.jsx       # 卡通校园 SVG 地图（分校区）
        │   ├── AreaDialog.jsx    # 区域对话框（活动区 + 聊天区）
        │   ├── PostEditor.jsx    # 活动帖发布编辑器
        │   └── TodoCard.jsx      # 待办卡片
        └── pages/
            ├── MapPage.jsx         # 地图页（校区切换）
            ├── TasksPage.jsx       # 任务页
            ├── LeaderboardPage.jsx # 排行榜
            ├── AchievementsPage.jsx# 成就页
            └── ProfilePage.jsx     # 个人页
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
| GET | `/api/areas/:areaId/channels` | 某区域下的频道 |
| GET | `/api/channels/:channelId/messages` | 频道历史消息 |
| POST | `/api/channels/:channelId/messages` | 发送消息（`{ userId, content }`，REST 兜底） |
| GET | `/api/channels/:channelId/posts` | 活动区帖子列表 |
| POST | `/api/channels/:channelId/posts` | 发布活动帖（`{ userId, title, content, category }`） |
| GET | `/api/achievements?userId=...` | 成就列表（含当前进度与解锁状态） |
| GET | `/api/todos?userId=...` | 某用户待办列表 |
| POST | `/api/todos` | 创建待办（`{ userId, title, description, dueDate, areaId, expReward }`） |
| PATCH | `/api/todos/:id/complete` | 完成任务（`{ userId }`，幂等，加 `exp_reward` 经验） |
| GET | `/api/users/:id` | 单个用户信息 |
| PATCH | `/api/users/:id` | 修改昵称/学院（`{ nickname?, college? }`） |
| GET | `/api/leaderboard` | 按经验值降序排行榜 |
| POST | `/api/users` | 首次创建/复用用户（`{ nickname, college }`） |

### Socket.IO 事件（实时聊天）

- 房间名：`channel:{channelId}`
- 客户端 → 服务端：`join:channel` / `leave:channel`（`{ channelId }`）
- 客户端 → 服务端：`message:send`（`{ channelId, userId, content }`，带 ack 回调）
- 服务端 → 客户端：`message:new`（`{ channelId, message }`，广播到同频道）

## 数据模型

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `users` | id, nickname, college, avatar, exp, created_at | 用户与经验值 |
| `campuses` | id, name, slug | 校区（明伦 / 金明） |
| `areas` | id, campus_id, name, slug, description, x, y, color, emoji | 地图地点（x/y 为画布坐标，emoji 为标注符号） |
| `channels` | id, area_id, name | 每个地点一个独立频道 |
| `messages` | id, channel_id, user_id, content, created_at | 聊天消息 |
| `posts` | id, channel_id, user_id, title, content, category, created_at | 活动帖 |
| `todos` | id, user_id, title, description, due_date, status, exp_reward, area_id, created_at, completed_at | 待办任务 |
| `achievements` | id, code, name, description, icon, metric, threshold | 成就定义（进度由现有数据动态计算） |

- `status`：`pending`（待办）/ `completed`（已完成）
- 等级规则：`level = floor(exp / 100) + 1`
- 完成任务默认加 `exp_reward`（默认 10）经验值；已完成任务不能重复加分（后端幂等保护）

## 已知限制

- 本仓库为**原型**，数据全部保存在本地 SQLite，重启/重置后历史数据不保留（除非备份 `server/data/campus.db`）。
- **无实名、无登录**：以 localStorage 中的 `campus_user` 标识匿名用户，同名用户会被复用。
- **地图为手绘示意 SVG**：不复制官方地图素材与校徽；地点名称来自用户提供的两校区地点清单。
- 聊天内容仅做**基础过滤**（空消息拦截、长度限制、前端安全渲染，不渲染 HTML），无敏感词过滤与图片。
- 无私聊、群聊管理、图片上传、复杂权限与支付。

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

1. 确保 Node 版本 >= 18（推荐 20/22/24，均有预编译二进制）。
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
