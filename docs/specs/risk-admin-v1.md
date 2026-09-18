# 风控、举报与管理会话规范：risk-admin-v1

规范版本：`risk-admin-v1`。更新时间：2026-09-12。
本文定义 BubbleFortune V1.0 安全防护与管理后台基建，包含管理员会话安全、零明文 IP 指纹、举报去重、玩家风险处置与运行时配置管理。

---

## 1. 管理员认证与安全会话

### 1.1 凭证隔离与登录流程
1. **环境变量**：
   - `BF_ADMIN_TOKEN`：服务端管理凭证主密钥。若未配置，所有管理端接口均返回 `503 ADMIN_DISABLED`。
   - `BF_RISK_SECRET`：IP 散列盐值，用于将客户端 IP 单向转换为不可逆风险指纹。
2. **初始认证**：
   - 客户端通过 `POST /api/admin/session` 携带 HTTP 头 `X-Admin-Token: <token>` 进行初始身份验证。
   - 响应中**严禁**在 JSON Body、URL 或自定义 Header 中返回原始 `BF_ADMIN_TOKEN`。
3. **Session Cookie 机制**：
   - 登录成功后，服务端下发签名 Cookie：`bf_admin=<expiresAt>.<nonce>.<signature>`。
   - **签名算法**：`HMAC-SHA256(expiresAt + "." + nonce, BF_ADMIN_TOKEN)`。
   - **Cookie 属性**：
     - `HttpOnly`：防止 XSS 读取或窃取会话。
     - `SameSite=Strict`：杜绝跨站请求伪造（CSRF）。
     - `Path=/`：统一作用域。
     - `Secure`：在 HTTPS 环境自动开启。
     - `Max-Age=7200`（有效期 2 小时，刷新页面需重新输入环境令牌）。
4. **受保护端点校验**：
   - 所有 `/api/admin/*` 私有端点自动校验 `bf_admin` Cookie 签名与有效期，或在携带合法 `X-Admin-Token` 时直接放行。
   - 未授权请求统一返回 `401 UNAUTHORIZED`，且响应头附带 `Cache-Control: no-store`。
- `POST /api/admin/logout` 清除 `bf_admin` Cookie；前端同时丢弃内存中的环境令牌。

---

## 2. 零明文 IP 存储与风控指纹

### 2.1 隐私合规原则
- 遵循数据最小化与 GDPR / 个人信息保护合规规范，服务端数据库中**绝对不持久化明文 IP 地址**。

### 2.2 客户端 IP 提取
- 优先提取 `X-Forwarded-For` 头部（取逗号分隔的第一个有效 IP，抵御反向代理伪造）。
- 次级提取 `X-Real-IP` 头部。
- 兜底提取底层 TCP 套接字 `socket.remoteAddress`。

### 2.3 指纹生成算法
$$\text{ipFingerprint} = \text{SHA-256}(\text{BF\_RISK\_SECRET} + \text{clientIp})$$
- 截取 64 位十六进制散列串作为不可逆指纹。
- 用于关联同一网络来源的异常请求（如短时间高频举报、同 IP 协同作弊），但不保留可逆反查物理位置或原始 IP 的敏感数据。
- 设备信号使用 User-Agent、Sec-CH-UA、平台和语言请求头的组合哈希；仅用于同设备风险关联，不用于身份认证。

---

## 3. 举报处理与幂等防刷

### 3.1 举报提交接口
- **路径**：`POST /api/reports`
- **认证**：必须携带有效 `bf_guest` Cookie。
- **请求体**：
```json
{
  "targetType": "guest",
  "targetId": "d3b07384-d113-4632-9c91-46648d1beeed",
  "category": "match_fixing",
  "reason": "疑似双开对刷天梯积分"
}
```

### 3.2 数据库级幂等去重与频控防护
- **联合唯一索引去重**：
  数据表 `reports` 设置联合唯一索引约束：
  `CONSTRAINT uq_reports_reporter_target_category UNIQUE (reporter_guest_id, target_type, target_id, category)`
  当同一游客对相同目标实体的相同违规类别重复举报时，PostgreSQL 触发唯一性冲突（错误码 `23505`），服务端拦截并返回 HTTP `409 REPORT_CONFLICT`。
- **无状态 IP 指纹频控**：
  入库前利用已单向散列的 `ip_fingerprint` 检查近 1 小时内的提交频次（利用 `idx_reports_ip` 索引快速统计）。
  同一指纹每小时最多允许提交 10 次举报。超出频次直接返回 HTTP `429 REPORT_RATE_LIMITED`（`Too many reports submitted. Please try again later.`），在零明文 IP 存储前提下严格防范脚本轰炸。

### 3.3 举报处置流程
- 管理员通过 `GET /api/admin/reports?status=pending` 审查待处理工单。
- 通过 `PATCH /api/admin/reports/:id` 更新工单状态（`reviewed` / `actioned` / `dismissed`）并记录核查备注。

---

## 4. 风险控制与封禁处置

### 4.1 风险标记类型
- `BANNED`：直接封禁，禁止参与对局与排位。
- `EXCLUDED_RANKING`：成绩可疑，从天梯排行榜隔离下架。
- `SUSPECTED_BOT`：疑似自动化脚本或挂机。
- `MATCH_FIXING`：操控比赛或故意送分。

### 4.2 级联排行榜排除
- 当管理员执行 `POST /api/admin/bans` 或为玩家施加 `excludeRanking: true` / `BANNED` 标记时，系统原子化更新该玩家在当前赛季的所有 `ranking_profiles.is_risk_excluded = TRUE`。
- 排行榜查询自动过滤此类玩家，保障竞技公平性。
- `BANNED` 标记同时阻止该游客加入 Classic、Duel 和 Auction 房间；已开始的内存对局继续由服务端裁决，不因后台操作篡改结果。
- 解封时通过 `PATCH /api/admin/bans/:banId` 标记 `isActive = false`，服务端依据该游客剩余生效的风险标记重新计算 `ranking_profiles.is_risk_excluded`。

### 4.3 自动固定对手信号
- 玩家进入双人或竞拍房间时，服务端只保存由 `BF_RISK_SECRET` 派生的 IP 指纹和请求头设备指纹。
- 结算后按最近 24 小时的已完成对局统计固定对手频次；同一对手组合达到 5 场以上，且两名游客共享任一指纹时，自动生成 `MATCH_FIXING` 中等级别标记。
- 自动标记只影响正式排名资格并进入后台待审，不改变已经开始的对局裁决；同一对手组合使用稳定信号键去重，覆盖对决、竞拍、生存战和锦标赛的已结算参与者，管理员可按现有流程解除。
- 对决与竞拍还检查结算回合中的窄范围让利信号：同一固定对手组合至少两轮出现高于真实箱值的成交报价且资本家利润为负时，追加 `automatic-concession-v1` 元数据标记。该标记只排除排名并进入人工复核，不向客户端公开，也不改变既有结算结果。

---

## 5. 管理员审计日志（Admin Audit Logs）

### 5.1 审计追踪要求
- 所有具有管理权限的操作必须记录至不可篡改的 `admin_audit_logs` 表，包含：
  - `admin_id`：执行操作的管理身份。
  - `action`：操作类型（`ADMIN_LOGIN`、`UPDATE_CONFIG`、`UPDATE_THEMES`、`BAN_GUEST`、`UNBAN_GUEST`、`RESOLVE_REPORT` 等）。
  - `target_type` 与 `target_id`：受影响的对象标识。
  - `details`：操作前后关键载荷快照（JSON 格式）。
  - `ip_fingerprint`：操作来源安全指纹。
  - `created_at`：精确 UTC 时间戳。

---

## 6. 运行时配置与主题管理

### 6.1 动态配置存储
- `runtime_configs` 表提供带版本号（`version`）的原子键值对存储。
- 每次修改递增版本号并记录操作人与时间。

### 6.2 主题动态切换
- 预置主题列表：`classic`（默认）与 `starry-neon`。
- 管理员可随时通过 `PATCH /api/admin/themes/:themeId` 启用/禁用特定主题或切换全局默认激活主题。
- 客户端在初始化或对局结算页面实时获取当前生效主题配置。

---

## 7. 零对局中断（Zero Gameplay Interruption）

### 7.1 数据库故障隔离原则
- **对局运行**：所有正在进行中的游戏（Classic26、Duel26、Auction26）均在内存状态机（Colyseus Room / GameEngine）中独立推进与计时。
- **持久化韧性**：结算数据通过 Outbox 机制保存在本地磁盘安全暂存区，数据库离线或网络分区时对局正常完成并向客户端返回最终胜负。
- **业务降级**：
  - 当 PostgreSQL 服务不可用时，依赖数据库的 HTTP 接口（历史记录、排行榜、个人战绩、举报）统一返回 `503 DATABASE_UNAVAILABLE`。
  - 数据库故障不导致 Node.js 进程崩溃，待数据库连接恢复后 Outbox 自动重试补写入库，天梯积分与审计记录最终一致。
