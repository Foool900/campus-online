# 部署指南（阿里云学生机 · 白嫖版）

> 目标：0 元申请一台阿里云服务器，把 Campus Online 部署成公网网址，同学打开就能实时聊天。

## 第一步：学生认证，0 元领服务器（约 10 分钟）

1. 注册阿里云账号并完成**个人实名认证**（身份证 / 支付宝）。
2. 打开 <https://university.aliyun.com/> →「国内学生认证」→ 支付宝扫码 → 自动调**学信网**学籍校验。
3. 认证通过后 **300 元无门槛代金券**自动到账（费用中心 - 卡券管理可查）。
4. 进入「学生用券中心」<https://university.aliyun.com/buycenter/>，选 **1核2G / 40G SSD** 配置，系统自动勾券，**订单 0 元**后购买。
   - 地域选离你近的（如华北、华东）。
   - **镜像务必选纯系统镜像 Ubuntu 22.04**（不要选带应用的 LNMP/WordPress 镜像）。
   - 设置 root 密码，记好。
5. 购买后在控制台看到你的**公网 IP**。

## 第二步：放行端口

- ECS：控制台 → 安全组 → 入方向 → 放行 **80**（TCP）。
- 轻量应用服务器：控制台 → 防火墙 → 添加规则 → **80**（TCP）。

## 第三步：SSH 连上服务器，粘贴以下命令

```bash
# 1. 装 Node 22 + git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git
node -v    # 应显示 v22.x

# 2. 拉代码
cd /opt
git clone https://github.com/Foool900/campus-online.git
cd campus-online

# 3. 装依赖 + 打包前端（一次性，约 2~3 分钟）
npm install
npm run build

# 4. 用 PM2 常驻，监听 80 端口（崩溃自动重启）
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # 复制它输出的最后一行命令执行，实现开机自启
```

## 第四步：访问

浏览器打开：**http://你的公网IP/** —— 就是给同学访问的网址。

## 第五步：安装 Ollama 本地模型（知识库助手，可选）

知识库助手依赖本机 Ollama 提供两个本地模型（零成本、离线、不调用外部 API）：

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:1.5b        # 对话模型（约 1GB）
ollama pull nomic-embed-text     # 向量模型（约 274MB）
systemctl enable --now ollama    # 开机自启
```

- Ollama 默认监听 `127.0.0.1:11434`，与后端同机，无需额外配置。
- **2G 内存提示**：建议给 Ollama 设 `OLLAMA_NUM_PARALLEL=1`、`OLLAMA_MAX_LOADED_MODELS=1`，避免同时加载两个模型导致 OOM。可在 `/etc/systemd/system/ollama.service` 的 `[Service]` 段加 `Environment=OLLAMA_NUM_PARALLEL=1` 等配置。
- Ollama 未启动时助手会自动降级（返回「服务未启动」提示），不影响其它功能。

## 常见问题

- **想换端口**：把 `ecosystem.config.cjs` 里的 `PORT: 80` 改掉，并在安全组放行对应端口，然后 `pm2 restart campus-online`。
- **改了代码要更新**：`cd /opt/campus-online && git pull && npm run build && pm2 restart campus-online`。
- **备份聊天数据**：SQLite 文件在 `server/data/campus.db`，直接下载该文件即可。
- **助手提示「服务未启动」**：服务器上的 Ollama 没跑或没拉模型，见「第五步」。本地开发时先在电脑上 `ollama serve` 并 `ollama pull` 两个模型。
- **Render 免费版跑不了 Ollama**：助手会自动降级，这是预期行为，不是 bug。
- **到期提醒**：学生免费期最长 12 个月，到期前记得续费或备份导出数据，超期资源会被回收。

## 备案说明

- 直接 `IP` 访问：**无需备案**。
- 绑定自定义域名：域名指向大陆服务器需 ICP 备案（约 2~3 周）。
