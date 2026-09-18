# 排行榜与赛季规范：ranking-v1

规则版本：`season-v1`。更新时间：2026-09-12。
本文定义 BubbleFortune V1.0 赛季制度、天梯分（Elo）计算、多模式结算钩子、公开统计榜单、角色平衡收益率与个人战绩摘要接口契约。

---

## 1. 赛季周期与生命周期

1. **赛季时长**：固定为 4 周（28 天，2,419,200 秒），时间对齐 UTC 零点。
2. **赛季标识**：`season-1`、`season-2` 等递增标识，关联规则版本 `season-v1`。
3. **赛季状态流转**：
   - `upcoming`：未开始（预告展示）。
   - `active`：进行中（对局结算计入该赛季积分）。
   - `completed`：已结束（积分封存归档，仅供只读查询与历史勋章展示）。
   - `archived`：历史赛季归档。
4. **结算归属**：
   - 每场对局结算时自动归属到当前 `status = 'active'` 且满足 `start_at <= now < end_at` 的活跃赛季。
   - 若无活跃赛季，保留对局记录，但不更新天梯排位积分与天梯胜负统计。

---

## 2. 天梯分（Elo）与结算算法

### 2.1 基础设定
- **初始 Elo**：`1000`。
- **最低保底 Elo**：`100`（避免极端连败分数为负）。
- **K 因子（K-Factor）**：`32`（标准天梯敏感度）。

### 2.2 两人资本家对决（Duel26）Elo 结算
采用标准两玩家零和 Elo 体系：
设玩家 0 当前天梯分为 $R_0$，玩家 1 当前天梯分为 $R_1$。

1. **胜率期望值**：
   $$E_0 = \frac{1}{1 + 10^{(R_1 - R_0) / 400}}$$
   $$E_1 = \frac{1}{1 + 10^{(R_0 - R_1) / 400}} = 1 - E_0$$

2. **实际结果得分 $S$**：
   - 获胜：$S = 1.0$
   - 平局：$S = 0.5$
   - 失败：$S = 0.0$

3. **分值增减变化**：
   $$\Delta R_0 = \text{round}(K \times (S_0 - E_0))$$
   $$\Delta R_1 = \text{round}(K \times (S_1 - E_1))$$
   $$R'_0 = \max(100, R_0 + \Delta R_0)$$
   $$R'_1 = \max(100, R_1 + \Delta R_1)$$

4. **弃权惩罚**：
   - 单方超时断线（`TIMEOUT_DISCONNECT`）或主动投降（`FORFEIT`）判定该方失败，对手获得胜利积分，弃权者天梯档案 `forfeits` 计数加 1。
   - 双方弃权（`BOTH_FORFEIT`）判定平局（$S=0.5$），双方天梯积分按平局微调，且双方 `forfeits` 计数各加 1。

### 2.3 多人拍卖场（Auction26）Elo 结算
多人匹配（3~8人）采用**成对比较累加模型（Pairwise Comparison Model）**：
设参与有效结算的玩家数为 $N$（$N \ge 2$），玩家 $i$ 当前 Elo 为 $R_i$，终局名次为 $\text{rank}_i$。

1. **成对胜负定义**（对于任意对手 $j \ne i$）：
   $$S_{ij} = \begin{cases} 
   1.0 & \text{rank}_i < \text{rank}_j \quad (\text{名次更优}) \\
   0.5 & \text{rank}_i = \text{rank}_j \quad (\text{平局/同分}) \\
   0.0 & \text{rank}_i > \text{rank}_j \quad (\text{名次更差})
   \end{cases}$$

2. **成对期望胜率**：
   $$E_{ij} = \frac{1}{1 + 10^{(R_j - R_i) / 400}}$$

3. **综合多玩家分值增减**：
   $$\Delta R_i = \text{round}\left( \frac{K}{N - 1} \sum_{j \ne i} (S_{ij} - E_{ij}) \right)$$
   $$R'_i = \max(100, R_i + \Delta R_i)$$

4. **资格排除**：
   - 标记为 `isPrivate: true` 或 `ranked: false` 的房间不计入天梯 Elo 分值，但其对局记录正常持久化存储。

### 2.4 单人经典模式（Classic26）
- 单人模式属于休闲与单机体验，不参与多人竞技排位。
- 单人对局结算记录完整保存在 `completed_games` 历史表中供个人复盘与生涯统计（`singleGamesPlayed`），但**绝不更新**竞技天梯分（Elo）或赛季天梯档案（`ranking_profiles`）。只有受支持的两人对决（Duel26）与公开拍卖（Auction26）结算更新天梯积分；箱王生存战和锦标赛不改变 Elo，但会在当前赛季档案中累加模式场次与胜场统计。

---

## 3. 角色平衡收益率（Role Balance Return Rate）

为了评估玩家在「挑战者」与「资本家」双向角色下的全面策略平衡性，系统持续追踪并计算角色平衡收益率：

1. **指标累加项**：
   - $P_{\text{challenger}}$：在对决模式中担任挑战者身份获得的总累计净收益。
   - $P_{\text{banker}}$：在对决模式中担任资本家身份获得的总累计净收益。
2. **计算公式**：
   $$\text{Rate} = \begin{cases} 
   1.0000 & P_{\text{challenger}} = 0 \text{ 且 } P_{\text{banker}} = 0 \\
   0.0000 & P_{\text{challenger}} \le 0 \text{ 且 } P_{\text{banker}} > 0 \\
   \text{clamp}\left(\frac{P_{\text{challenger}}}{P_{\text{banker}}}, 0.0, 10.0\right) & P_{\text{challenger}} > 0 \text{ 且 } P_{\text{banker}} > 0 \\
   0.0000 & \text{其他边界条件}
   \end{cases}$$
3. **输出规格**：保留 4 位小数，作为排位排行榜与个人战绩卡的关键进阶能力参考维度。

---

## 4. 排行榜排序与风控隐私

1. **主榜单排位规则**：
   - 第一排序键：`elo DESC`
   - 第二排序键（同分仲裁）：`net_profit DESC`
   - 第三排序键：`updated_at ASC`（先达成分数者优先）
2. **隐私隔离规范**：
   - 公开排行榜响应（`RankingEntry`）**绝不泄露**稳定的游客标识 `guestId`，仅返回公开排位指标（`rank`、`elo`、`winRate`、`roleBalanceReturnRate`、`netProfit`、`matchesPlayed`、`forfeitRate`、`survivorGamesPlayed`、`survivorWins`、`tournamentGamesPlayed`、`tournamentWins`、`singleGamesPlayed`、`singleHighestProfit`、`singleBestDealMargin`），杜绝玩家身份被第三方批量抓取关联。
   - 游客本人仅能通过经身份认证的 `/api/profile/summary` 读取本人的 `guestId`。
3. **风控隔离机制**：
   - 被标记为 `is_risk_excluded = TRUE` 或存在生效封禁的游客，查询榜单时被全量排除（`WHERE is_risk_excluded = FALSE`）。
   - 风控隔离玩家不占用前排排名名次，普通玩家的名次按合规活跃玩家连续编号。
   - 被隔离玩家查询个人档案时，`rank` 字段返回 `null`。

---

## 5. HTTP API 契约

### 5.1 获取赛季列表
- **路径**：`GET /api/seasons`
- **认证**：无需认证，公开只读。
- **响应格式**：
```json
{
  "items": [
    {
      "seasonId": "season-1",
      "name": "Season 1 (V1.0)",
      "ruleVersion": "season-v1",
      "startAt": 1773273600000,
      "endAt": 1775692800000,
      "status": "active"
    }
  ]
}
```

### 5.2 获取指定赛季详情
- **路径**：`GET /api/seasons/:seasonId`
- **响应**：`200 OK` 返回 `SeasonSummary`；不存在返回 `404 NOT_FOUND`。

### 5.3 获取排行榜
- **路径**：`GET /api/rankings`
- **查询参数**：
  - `seasonId` (可选，默认当前活跃赛季)
  - `board` (可选，默认 `elo`)：`elo`、`net_profit`、`challenger_profit`、`banker_profit`、`win_rate`、`survivor_wins`、`tournament_wins`、`matches`、`single_highest` 或 `single_margin`
  - `limit` (可选，默认 50，最大 100)
  - `offset` (可选，默认 0)
- `GET /api/rankings/:seasonId` 支持同样的 `board` 参数。
- `net_profit`、`challenger_profit`、`banker_profit`、`win_rate` 和 `matches` 只展示至少完成一场计入统计的玩家；`survivor_wins` 与 `tournament_wins` 只展示参加过对应模式的玩家；`single_highest` 按赛季时间窗口内经典单人结算的最高 `wonAmount` 排序，`single_margin` 按成交局的 `acceptedOfferAmount - originalBoxAmount` 最高值排序。所有榜单继续排除有效风控隔离玩家。角色收益字段只来自服务端已结算的角色拆分，不接受客户端提交。
- **响应格式**：
```json
{
  "seasonId": "season-1",
  "board": "elo",
  "items": [
    {
      "rank": 1,
      "elo": 1280,
      "winRate": 0.6500,
      "roleBalanceReturnRate": 1.1520,
      "netProfit": 850000,
      "challengerProfit": 520000,
      "bankerProfit": 330000,
      "matchesPlayed": 40,
      "forfeitRate": 0.0250
    }
  ],
  "total": 1
}
```

### 5.4 获取游客战绩摘要
- **路径**：`GET /api/profile/summary`
- **认证**：必须携带 `bf_guest` Cookie，未登录返回 `401 UNAUTHORIZED`。
- **查询参数**：
  - `seasonId` (可选，默认当前活跃赛季)
- **响应格式**：
```json
{
  "guestId": "d3b07384-d113-4632-9c91-46648d1beeed",
  "elo": 1280,
  "rank": 1,
  "seasonId": "season-1",
  "matchesPlayed": 40,
  "wins": 26,
  "losses": 13,
  "draws": 1,
  "forfeits": 1,
  "winRate": 0.6500,
  "roleBalanceReturnRate": 1.1520,
  "netProfit": 850000,
  "forfeitRate": 0.0250,
  "singleGamesPlayed": 15,
  "singleHighestProfit": 320000,
  "singleBestDealMargin": 85000,
  "duelGamesPlayed": 20,
  "auctionGamesPlayed": 5,
  "createdAt": 1773273600000
}
```

`singleHighestProfit` 与 `singleBestDealMargin` 只从该游客自己的已结算 `classic-26-v1` 记录聚合；没有对应记录时返回 `0`。这两项是历史汇总，不改变赛季 Elo，也不向客户端公开未开箱金额、箱子映射或审计秘密。

### 5.5 管理员数据分析摘要
- **路径**：`GET /api/admin/analytics?days=30`
- **认证**：短期 `bf_admin` HttpOnly 会话及管理员令牌。
- **范围**：最多查询 90 天；返回服务端事件聚合、按模式完成量、每日事件和 1/7/30 日游客留存。事件不携带原始 IP、游客令牌、报价或隐藏金额，明细写入 `analytics_events`（迁移 11）。
