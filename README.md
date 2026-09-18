# BubbleFortune

26 箱单人开箱谈判游戏。React / Vite / R3F 负责舞台与界面，Node.js / Colyseus 服务端负责隐藏金额、报价、超时与结算。所有金额均为虚拟分数。

## 本地启动

在项目根目录执行：

```powershell
npm install
npm run dev
```

打开 http://localhost:3000 。`dev` 同时启动前端 3000 和游戏服务端 2567，按 Ctrl+C 一起停止。浏览器通过 `/game` 和 `/api` 同源代理通信；不要只运行 `dev:web` 后期待完整游戏可用。端口被占用时先关闭自己已启动的旧进程，再重新启动。

如果 `.env.local` 配置了 `DATABASE_URL`，推荐使用一键本地启动：

```powershell
npm run dev:all
```

该命令会先启动 Docker PostgreSQL，再启动前端和游戏服务端；需要先启动 Docker Desktop。若只调试不依赖战绩数据库的核心游戏，可暂时移除 `.env.local` 中的 `DATABASE_URL`，继续使用 `npm run dev`。

需要分别启动或排查时，使用两个终端：

```powershell
npm run dev:server
```

```powershell
npm run dev:web
```

构建前端使用 `npm run build`；`npm run preview` 预览构建产物时也需要另一个终端保持 `npm run dev:server` 运行。静态前端构建不包含游戏服务端。

### 本地数据库（可选，用于游客战绩）

服务端支持未配置DB的可选模式（游戏正常进行，战绩接口返回 disabled），已配置失败不回退，保障战绩一致性。本地开发环境复用 Docker 容器：

项目结构与运行关系：

- `src/`：React/Vite 前端、Three.js/R3F 舞台、页面、UI 和客户端 API。
- `apps/game-server/src/`：Node.js/Colyseus 权威服务端、房间、规则引擎、结算、鉴权和持久化。
- `packages/protocol/`：前后端共享的公开协议和类型，不包含隐藏金额、种子或报价内部参数。
- `apps/game-server/src/persistence/`：PostgreSQL 迁移、游客历史和 Durable Outbox。
- `public/`、`art/`：公开运行资源和资产制作资料；生产构建输出到 `dist/`。
- `docker-compose.yml`：PostgreSQL、游戏服务端、静态 Web 和 HTTP 代理；生产覆盖文件增加 HTTPS/TLS。

浏览器访问前端后，`/api` 和 `/game` 由代理转发到游戏服务端；服务端按需访问 PostgreSQL。服务端负责秘密数据和最终裁决，前端只接收授权快照。

```powershell
# 启动本地 PostgreSQL 容器（PostgreSQL 16，默认端口 15434）
npm run db:up

# 或直接通过 Docker CLI 启动已有容器
docker start bubble-fortune-postgres
```

数据库连接配置由根目录 `.env.local` 中的 `DATABASE_URL` 提供（参考 `.env.example`，不要将真实凭据提交至 Git）。
- 启动与恢复：配置了 `DATABASE_URL` 时，启动时会初始化数据库 schema 与 durable outbox。若数据库未启动，启动将明确报错退出；启动后若数据库发生临时中断，服务以 503 `DATABASE_UNAVAILABLE`（附带 `Cache-Control: no-store`）优雅降级，终局对局记录将持久化在 `.data/history-outbox/` 并在数据库恢复后自动重试入库。
- 生产环境安全：当 `NODE_ENV=production` 时，游客 Cookie 强制启用 `Secure` 属性（需要 HTTPS 传输）；本地或局域网开发环境无需设置 `NODE_ENV=production`。
 
### 生产部署 (Docker Compose)

生产环境使用多阶段 Dockerfile 与 Docker Compose 编排生产服务栈，包含 web 静态服务、game-server、PostgreSQL 与反向代理网关：

```powershell
# 1. 配置生产环境变量与高熵强密码（参考 .env.production.example，设置 chmod 600）
cp .env.production.example .env.production

# 2. 一键构建并启动生产服务栈
docker compose --env-file .env.production up -d --build

# 3. 检查各服务健康状态（postgres, game-server, web, proxy 均应为 healthy）
docker compose ps
```

详细迁移顺序、启停管理、Durable Outbox 持久卷、健康检查与灾备恢复流程请参阅 [生产部署与运维手册](docs/ops/deployment.md)。

## 玩法与恢复

- 唯一玩法为 26 箱；先选个人箱，再按 6 / 5 / 4 / 3 / 2 / 1 / 1 / 1 / 1 开其他箱子。开满 24 箱后选择保留或交换。
- 每次开箱先由服务器确认，动画期间锁定其他箱子；动画结束后对应金额和已开箱记录才更新，报价与最终选择也等待揭晓。
- 快速设置只加速动画。服务端选箱、开箱、报价决策与最终选择限时分别为 30 / 20 / 30 / 30 秒。
- 内存会话与重连：进行中对局保留 120 秒断线席位，期间倒计时继续，通过重连令牌恢复且公平承诺保持稳定；服务端进程重启不存档进行中对局。
- 设置包含自动/标准/节能画质、声音、快速动画、降低动态、大字和成交二次确认，保存于本机；不改变服务器截止时间。设置内有性能采样与 JSON 导出。
- 新局可选保守型、激进型或冷血型 AI，整局固定。结束后可校验开局承诺、完整箱子映射与事件链；未保留开局承诺的浏览器只能验证证据自洽，旧局没有证明时明确显示不支持。
- 大厅和游戏内的战绩入口可查看本浏览器游客历史、最高报价、原始/最终箱与决策时间线。身份采用 HttpOnly Cookie，终局保存于 PostgreSQL；写入失败通过持久 outbox 重试，损坏/冲突记录隔离。
- 结算或历史详情中可主动生成公开分享摘要，再复制链接或调用系统分享。公开页不提供游客凭据、私人战绩或完整事件。
- 生产构建提供 PWA 安装、静态缓存和更新提示；对局结束后才可更新。游戏、战绩与分享结果查询仍需联网，API/会话/身份响应不进缓存。需要 HTTPS 或本机 localhost/127.0.0.1 安全上下文；普通局域网 HTTP 不具备安装保证。开发模式不注册缓存并注销本应用遗留的预览 worker，切回开发后刷新页面即可。

## 验证与开发文档

```powershell
npm run check:server
npm run test:server
npm run test:database
npm run test:web
npm run build
npm run test:pwa
```

- `check:server`：服务端 TypeScript 严格类型检查。
- `test:server`：服务端核心引擎单元测试与 Colyseus 网络集成测试（无 DB 依赖基线）。
- `test:database`：基于真实 PostgreSQL 实例的游客隔离、终局持久化、去重、重启恢复、outbox 空队列/并发/故障重试与分享隐私集成测试（使用独立随机 `test_schema_`，运行后严格自动清理）。
- `test:web`：67 项前端表现、偏好、采样、DTO、防串局公平校验与游客预检测试，包含原 `test:presentation` 的 15 项。
- `test:pwa`：5 项缓存隔离、离线壳、更新、分享白名单及实际构建资源检查；需要先 build。

当前完成状态与实际验收证据见 [ROADMAP](docs/ROADMAP.md)，规则和恢复约定见 [技术设计](docs/TECH_DESIGN.md)，产品需求见 [GDD](GDD_V2.0.md)，视觉和资产分别见 [DESIGN](DESIGN.md) 与 [ASSETS](docs/ASSETS.md)。
