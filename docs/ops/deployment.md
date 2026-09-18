# BubbleFortune 生产环境部署与运维手册

本文档为 BubbleFortune V1.0 生产环境的标准化部署、运维管理、持久化保障、故障自愈与灾难恢复指南。

---

## 目录
1. [系统架构与服务组件](#1-系统架构与服务组件)
2. [生产 PWA 构建与静态资产](#2-生产-pwa-构建与静态资产)
3. [环境变量与密钥安全规范](#3-环境变量与密钥安全规范)
4. [数据库迁移顺序与就绪检查](#4-数据库迁移顺序与就绪检查)
5. [服务启停与生命周期管理](#5-服务启停与生命周期管理)
6. [分层健康检查机制](#6-分层健康检查机制)
7. [Durable Outbox 持久化与故障自愈](#7-durable-outbox-持久化与故障自愈)
8. [备份与灾难恢复流程](#8-备份与灾难恢复流程)
9. [日志脱敏与隐私安全底线](#9-日志脱敏与隐私安全底线)
10. [版本平滑升级与回滚策略](#10-版本平滑升级与回滚策略)

---

## 1. 系统架构与服务组件

BubbleFortune 生产环境采用全容器化微服务编排架构，通过 Docker Compose 进行服务治理，对外仅暴露反向代理统一入口：

```
                              [ 客户端浏览器 / PWA ]
                                        │
                                        ▼ (HTTP / HTTPS / WSS)
                          ┌───────────────────────────┐
                          │   bf-proxy (Nginx 网关)    │
                          │   对外端口: ${PORT:-80}   │
                          └─────────────┬─────────────┘
                                        │
                 ┌──────────────────────┴──────────────────────┐
                 │                                             │
      / (静态资源、HTML、模型)                          /api/* (HTTP) 与 /game/* (WebSocket)
                 │                                             │
                 ▼                                             ▼
    ┌─────────────────────────┐                   ┌─────────────────────────┐
    │  bf-web (静态资源服务)   │                   │  bf-game-server (服务)  │
    │  Nginx 缓存 / SPA 路由  │                   │  Node.js / Colyseus     │
    └─────────────────────────┘                   └────────────┬────────────┘
                                                               │
                                ┌──────────────────────────────┴──────────────────────────────┐
                                │                                                             │
                                ▼ (持久化存储)                                                 ▼ (本地排队)
                   ┌─────────────────────────┐                                   ┌─────────────────────────┐
                   │  bf-postgres (数据存储)  │                                   │ 命名卷 bf-outbox-data   │
                   │  PostgreSQL 16          │                                   │ /app/.data/history-outbox│
                   └─────────────────────────┘                                   └─────────────────────────┘
```

### 组件职能说明

| 容器服务名 | 技术栈 | 监听端口 | 核心职能 |
|---|---|---|---|
| `bf-proxy` | Nginx 1.25+ Alpine | `0.0.0.0:${PORT:-80}` | 反向代理、SSL 终结、请求限流、WebSocket 握手升级 (`/game`)、API 路由 (`/api`) |
| `bf-web` | Nginx Alpine | `内部 80` | 托管 Vite 构建的前端 PWA 产物、3D 运行时 GLB 资产、SPA 路由重定向、静态强缓存 |
| `bf-game-server` | Node.js 22 / Colyseus | `内部 2567` | 权威游戏逻辑、箱子金额隔离计算、AI 报价决策、游客身份验签、风控指纹计算 |
| `bf-postgres` | PostgreSQL 16 Alpine | `内部 5432` | 游客凭据哈希、终局对局记录、排位概况 (Elo)、风控封禁名单、管理员审计日志 |

---

## 2. 生产 PWA 构建与静态资产

前端采用 React + Three.js / React Three Fiber 构建，并由 PWA 离线 Service Worker (`sw.js`) 统一管理缓存。

### 2.1 生产构建脚本

在项目根目录执行（以项目实际 `package.json` 为准）：

```bash
# 完整生产构建 (TypeScript 严格类型检查 + Vite 静态打包 + PWA 资源摘要清单生成)
npm run build
```

该脚本依次执行以下阶段：
1. `tsc`：执行客户端前端代码类型检查；
2. `vite build`：生产级 Rollup 代码拆分、Tree-shaking、CSS 压缩与资产哈希命名，输出至 `dist/`；
3. `node scripts/build-pwa.mjs`：扫描 `dist/` 产物与 `public/assets/models/runtime/` 交付模型，计算 SHA-256 内容摘要并生成 `sw.js` 与 `pwa-build.json`。

### 2.2 PWA 产物验证

构建完成后执行验证：

```bash
npm run test:pwa
```

验证重点包括：
- Service Worker 严格不缓存 `/api`、`/game` 或任何跨源/POST 请求；
- 只对明确白名单的静态外壳与当前运行时 3D 模型预缓存；
- 离线仅提供轻量应用壳导航，局中绝不强行热更新破坏正在进行的对局。

---

## 3. 环境变量与密钥安全规范

生产环境必须遵循最小权限原则与零信任安全基线，绝不允许将真实密钥写入 Dockerfile 或提交至 Git 仓库。

### 3.1 环境变量清单

| 变量名 | 必填 | 适用服务 | 示例值 | 安全规范说明 |
|---|---|---|---|---|
| `NODE_ENV` | 是 | `game-server` | `production` | 强制设为 `production`。此时 `bf_guest` 与 `bf_admin` Cookie 强制增加 `Secure` 属性（需要 HTTPS）。 |
| `PORT` | 否 | `proxy` | `80` | 基础 Compose 的 HTTP 监听端口；生产 TLS 覆盖使用 `HTTP_PORT` / `HTTPS_PORT`。 |
| `HTTP_PORT` / `HTTPS_PORT` | 否 | `proxy` | `80` / `443` | 生产 Compose 覆盖的明文跳转与 TLS 监听端口。 |
| `TLS_CERT_DIR` | 否 | `proxy` | `./docker/certs` | `fullchain.pem` 与 `privkey.pem` 所在宿主机目录。 |
| `PUBLIC_ORIGIN` | 是 | `game-server` | `https://game.example.com` | 官方对外域名，用于 CORS 校验、WebSocket 升级来源白名单及公开战绩分享链接。 |
| `ALLOWED_ORIGINS` | 是 | `game-server` | `https://game.example.com` | 允许的跨源请求来源，与 `PUBLIC_ORIGIN` 保持一致或逗号分隔。 |
| `DATABASE_URL` | 是 | `game-server` | `postgresql://user:pwd@postgres:5432/bubble_fortune` | 容器内连接 PostgreSQL 服务的完整连接字符串。 |
| `POSTGRES_DB` | 是 | `postgres` | `bubble_fortune` | PostgreSQL 数据库名称。 |
| `POSTGRES_USER` | 是 | `postgres` | `bubble_fortune` | PostgreSQL 运行用户。 |
| `POSTGRES_PASSWORD` | 是 | `postgres`, `game-server` | *(随机32字节十六进制)* | 数据库连接高熵口令，由安全管理员生成。 |
| `BF_ADMIN_TOKEN` | 是 | `game-server` | *(随机32字节十六进制)* | 管理后台特权令牌，用于 `X-Admin-Token` 请求头校验及后台会话签名。 |
| `BF_RISK_SECRET` | 是 | `game-server` | *(随机32字节十六进制)* | 风控 IP 指纹脱敏盐值。计算 `SHA-256(BF_RISK_SECRET + IP)`，严禁泄露。 |

### 3.2 生产密钥生成与文件保护

生产 Compose 覆盖文件会启用 `443` TLS 监听。部署前将证书放入 `${TLS_CERT_DIR:-./docker/certs}`，文件名必须是 `fullchain.pem` 和 `privkey.pem`，并限制私钥只允许部署用户读取；没有证书时使用基础 Compose 仅适合本地开发，不得把 HTTP 端口直接作为正式公网入口。


在生产部署节点上生成高熵随机密钥：

```bash
# 复制生产环境配置文件模板
cp .env.production.example .env.production

# 生成高熵随机密码并填入 .env.production
openssl rand -hex 32

# 限制文件访问权限（仅允许宿主机 root/deployer 读写）
chmod 600 .env.production
```

---

## 4. 数据库迁移顺序与就绪检查

### 4.1 迁移执行流程

数据库迁移全部采用应用层受控自愈机制（位于 `apps/game-server/src/persistence/db.ts` 的 `DatabaseManager.init()`）：

1. **容器启动与监听**：`postgres` 容器启动并初始化基础库表存储；
2. **就绪检测**：Docker Compose 通过 `pg_isready -U bubble_fortune -d bubble_fortune` 轮询直到返回 0（就绪）；
3. **应用服务介入**：`game-server` 检测到数据库健康后启动连接，执行 `persistenceManager.init()`；
4. **幂等迁移**：
   - 自动创建 `schema_migrations` 版本追踪表；
   - 按版本顺序创建 `guests`、`completed_games`、`completed_duels`、`completed_auctions`、`completed_survivors`、`completed_tournaments`、经典/竞拍分享表、`multiplayer_shares`、`seasons`、`ranking_profiles`、`reports`、`risk_flags`、`admin_audit_logs`、`runtime_configs`、`guest_risk_signals` 与 `guest_achievements`；
   - 所有 DDL 均包含 `CREATE TABLE IF NOT EXISTS` 与 `CREATE INDEX IF NOT EXISTS`，具备幂等防重放特性；
   - 每个版本完成后写入 `schema_migrations`（当前版本为 11，包含 `analytics_events`），应用服务只在迁移成功后对外提供完整数据库能力。

### 4.2 迁移就绪探针

服务端内置数据库可用性探针（`db.isHealthy()`），通过带 2 秒超时熔断机制执行：

```sql
SELECT 1 as ok FROM schema_migrations WHERE version >= 11 ORDER BY version DESC LIMIT 1;
```

当探针返回 true 时，数据库迁移已完全生效，API 路由方可进入完全就绪服务状态。

---

## 5. 服务启停与生命周期管理

### 5.1 启动全套服务

在生产环境根目录执行：

```bash
# 注入 .env.production 配置，构建镜像并在后台守护启动
docker compose -f docker-compose.yml -f docker-compose.production.yml --env-file .env.production up -d --build
```

查看各容器健康状态：

```bash
docker compose ps
```

预期输出中所有容器的 `STATUS` 应包含 `(healthy)`：
- `bf-postgres` (healthy)
- `bf-game-server` (healthy)
- `bf-web` (healthy)
- `bf-proxy` (healthy)

### 5.2 查看运行时日志

```bash
# 跟踪游戏服务端日志
docker compose logs -f game-server

# 跟踪网关反向代理访问与错误日志
docker compose logs -f proxy
```

### 5.3 优雅停止与平滑下线

```bash
# 优雅停止所有容器服务（触发容器内 SIGTERM 优雅退出机制）
docker compose stop

# 或停止并移除容器（持久卷数据保留）
docker compose down
```

### 5.4 优雅停机内部机制

当 `game-server` 收到 `SIGTERM` 或 `SIGINT` 时，按严格顺序触发关闭链路：
1. **房间销毁（Room Disposal）**：广播房间关闭通知，允许正在结算的房间生成最终记录；
2. **Outbox 排空（Bounded Drain）**：给本地 Outbox 3 秒限时安全写入窗口；若数据库中断，则安全保留在磁盘上；
3. **连接池关闭（Pool Close）**：安全关闭 PostgreSQL 连接池，释放连接句柄；
4. **HTTP 服务终止**：停止接收新请求，进程安全退出。

---

## 6. 分层健康检查机制

系统在编排层与应用层设计了分层健康检查链：

```
[bf-postgres] (pg_isready 检查数据库端口与连接)
      ▲
      │ depends_on: condition: service_healthy
[bf-game-server] (node fetch 检查 /readyz 及底层数据库迁移状态)
      ▲
      │ depends_on: condition: service_healthy
[bf-proxy] (反向代理网关，仅在 upstream 全部健康后正式接入流量)
```

| 检查目标 | 检查方式 | 判定标准 | 降级行为 |
|---|---|---|---|
| `postgres` | `pg_isready -U <user> -d <db>` | 数据库服务接受 TCP 连接 | 未通过前阻止 `game-server` 启动 |
| `game-server` | `node -e "fetch('http://127.0.0.1:2567/readyz')"` | HTTP 200，`status=ready` 且数据库迁移达到 11 | 数据库未就绪时返回 503，阻止 proxy 接入 |
| `web` | `wget -q --spider http://127.0.0.1:80/index.html` | HTTP 200，静态资源可达 | 未就绪前 proxy 保持等待 |
| `proxy` | `wget -q --spider http://127.0.0.1:80/readyz` | HTTP 200，网关能访问游戏服务就绪探针 | 报警并重启网关 |

`/healthz` 只表示 Node/Colyseus 进程存活，不等待数据库；`/readyz` 才是生产流量的就绪门槛。两个端点均不缓存，也不返回连接字符串、迁移详情或管理员信息。

---

## 7. Durable Outbox 持久化与故障自愈

BubbleFortune 采用可靠的本地持久化 Outbox 设计，保障对局终局数据绝对不丢失。

### 7.1 持久卷架构

Docker Compose 为 Outbox 分配独立命名卷：
- 命名卷：`bf-outbox-data`
- 挂载点：`bf-game-server:/app/.data/history-outbox`

容器重建或版本升级时，未入库的对局文件驻留在命名卷中，数据不丢失。

### 7.2 数据库临时故障与自愈流程

当 PostgreSQL 发生临时网络分区或重启时：
1. **API 优雅降级**：
   - HTTP 接口以 HTTP 503 `DATABASE_UNAVAILABLE` 响应；
   - 响应头强制携带 `Cache-Control: no-store`，严防 CDN 或浏览器缓存故障态。
2. **游戏流程不受阻**：
   - 内存游戏房间正常推进结算；
   - 终局记录以 JSON 文件形式原子性写入磁盘 `.data/history-outbox/res_<resultId>.json`。
3. **数据库恢复自愈**：
   - 数据库重连后，`OutboxManager` 自动触发重试；
   - 数据库执行 `INSERT ... ON CONFLICT (result_id) DO NOTHING` 幂等写入；
   - 入库成功的本地文件自动从磁盘移除；
   - 损坏或结构异常的脏数据移动至 `.data/history-outbox/quarantine/` 隔离区供人工审计。

---

## 8. 备份与灾难恢复流程

### 8.1 数据库逻辑全量备份

建议通过 cron 定时任务每日执行逻辑热备：

```bash
#!/bin/bash
BACKUP_DIR="/data/backups/bubblefortune"
mkdir -p "${BACKUP_DIR}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/bf_db_${TIMESTAMP}.sql.gz"

# 在宿主机上无密码调用容器备份命令
docker exec -t bf-postgres pg_dump -U bubble_fortune bubble_fortune | gzip > "${BACKUP_FILE}"

# 保留最近 30 天的备份
find "${BACKUP_DIR}" -type f -name "bf_db_*.sql.gz" -mtime +30 -delete
```

### 8.2 Outbox 卷数据备份

```bash
# 备份 outbox 命名卷数据
docker run --rm \
  -v bf-outbox-data:/data:ro \
  -v /data/backups/bubblefortune:/backup \
  alpine tar czf /backup/bf_outbox_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .
```

### 8.3 灾难恢复步骤

若发生主机故障或数据损坏，恢复流程如下：

1. **拉起基础存储**：
   ```bash
   docker compose up -d postgres
   ```
2. **导入数据库备份**：
   ```bash
   gunzip < /data/backups/bubblefortune/bf_db_YYYYMMDD_HHMMSS.sql.gz | docker exec -i bf-postgres psql -U bubble_fortune bubble_fortune
   ```
3. **恢复 Outbox 挂载卷**（如存在离线未入库文件）：
   ```bash
   docker run --rm \
     -v bf-outbox-data:/data \
     -v /data/backups/bubblefortune:/backup \
     alpine sh -c "cd /data && tar xzf /backup/bf_outbox_*.tar.gz"
   ```
4. **重启全量服务**：
   ```bash
   docker compose up -d
   ```
   `game-server` 启动后将自动完成迁移校验并立即排空恢复的 Outbox 队列。

---

## 9. 日志脱敏与隐私安全底线

生产环境严格遵循《BubbleFortune 项目底线》安全准则：

1. **IP 地址指纹脱敏**：
   - 客户端真实 IP 仅在入站时由网关注入 `X-Forwarded-For`；
   - 服务端风控系统使用 `hashRiskFingerprint` 计算单向哈希：
     $$\text{Fingerprint} = \text{SHA-256}(\text{BF\_RISK\_SECRET} + \text{ClientIP})$$
   - 原始 IP 绝对不持久化至数据库，不出现在控制台日志或客户端响应中。
2. **敏感游戏数据隔离**：
   - 未开启箱子金额、洗牌种子、洗牌盐值保存在服务端内存；
   - 结算前严禁将箱子金额映射发送给客户端、写入日志或回显于错误信息中；
   - 种子仅在终局全部开箱结束后方可在公平性公开接口输出。
3. **Cookie 安全配置**：
   - `bf_guest` 与 `bf_admin` 会话 Cookie 设置 `HttpOnly`、`SameSite=Lax`（管理端为 `Strict`）；
   - 在 `NODE_ENV=production` 下自动追加 `Secure` 标记，禁止在未加密的明文 HTTP 信道传输。

---

## 10. 版本平滑升级与回滚策略

### 10.1 平滑升级步骤

1. 拉取新版本代码或预构建镜像；
2. 构建并验证镜像（在预发布环境运行 `npm run check:server`、`npm run test:server` 与 `npm run test:pwa`）；
3. 生产部署滚动更新：
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.production.yml --env-file .env.production up -d --build --no-deps game-server web proxy
   ```

### 10.2 内存会话与断线保护

- 进行中单人/双人对局保留在内存中，具备 **120 秒断线重连宽限期**；
- 生产升级前，建议提前在管理后台查看当前在线房间数（或选择低峰期部署）；
- 重启后玩家可通过重连凭据恢复，但已跨进程的对局若超时未恢复将以优雅超时结算入库。

### 10.3 故障快速回滚流程

若新版本出现不可预期的严重异常，可在 1 分钟内执行回滚：

```bash
# 1. 检出上一个稳定的 Git Commit / Tag
git checkout <LAST_STABLE_TAG>

# 2. 重新拉起上一版本容器
docker compose -f docker-compose.yml -f docker-compose.production.yml --env-file .env.production up -d --build

# 3. 检查回滚后服务健康状态
docker compose ps
docker compose logs -f --tail=100 game-server
```

> **数据库兼容性提示**：
> BubbleFortune 的所有数据库 Schema 变更均采用向后兼容原则（仅增加表或只增非必填列/索引）。回滚应用代码无需手动回滚数据库表结构。
