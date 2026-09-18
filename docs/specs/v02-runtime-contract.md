# V0.2 单人实施约定

日期：2026-09-10。依据用户批准的路线图；这是实现约定，完成状态仍见 ROADMAP。复用现有 26 箱、轮次、权威命令、动画揭晓和已确认美术。

## 公平承诺 v1

- 正式新局独立生成 32 字节 seed 与 32 字节 salt，均以小写 hex 表示；仅服务器持有，整局结束后才公开。自定义映射仅供引擎测试，必须标记不支持证明。
- algorithm 固定为 `hmac-sha256-fy-v1`。承诺为 SHA-256(`BubbleFortune/commit/v1\n` + canonical JSON)，JSON 包含 gameId、ruleVersion、algorithm、seed、salt、amounts、roundTargets。对象键按代码单元升序，数组保留顺序；只使用约定 ASCII 字段和整数。
- amounts 为当前 26 个金额的配置顺序。Fisher–Yates 从 i=25 降至 1；HMAC-SHA256 key 为 seed bytes，消息为 UTF-8 `BubbleFortune/shuffle/v1:` + salt + `:` + 十进制 counter（从 0 开始），取结果前四字节为无符号大端整数。n=i+1，仅接受小于 floor(2^32/n)*n 的数，然后取模 n；每次采样增加 counter，包括拒绝采样。
- 初始/进行中公开 supported、algorithm、commitment，不公开 seed/salt/映射。终局 proof 包含上述承诺输入与 commitment，客户端再校验 26 个箱号和映射。
- 浏览器验证器使用 WebCrypto；服务端生成器使用 Node crypto。前端不得导入服务端模块。校验器拒绝未知版本、错误长度、非有限整数、重复箱号和错误配置。
- 客户端首次收到同一 gameId 的承诺后固定保存，仅保存公开数据；后续相同 gameId 的不同承诺应报错，不覆盖旧值。终局比较首次承诺；缺少初始承诺时明确“只能检查证明自洽，未保存开局承诺”，不宣称完整验证通过。
- 可校验对象只来自终局或已完成战绩。旧记录标记不支持，不伪造证明。

主代理以 Python 标准库独立计算的固定向量：seed=`00` 重复 32 次，salt=`11` 重复 32 次，gameId=`fairness-vector-1`，ruleVersion=`classic-26-v1`，使用当前金额配置和轮次。

```text
commitment = 0440068d20082bb60b6d8d6d3571d8e9b7d17788597312f0d01ab7b45ecd9996
mapping 按箱号 1–26 = [750,1,1000,50,200000,100000,10000,5,2500,500,300,75,300000,500000,400000,400,100,750000,10,75000,25000,200,1000000,5000,50000,25]
采样 counter = 25
```

## 事件与 AI

- 事件包含 seq、timestamp、type、payload、previousHash、hash；hash 基于不含自身 hash 的 canonical JSON。记录创建、选箱、开箱、报价、接受/拒绝、超时来源、最终选择与结算。先记录事件，再生成对应快照；重复请求不重复追加。
- 事件仅保存各时刻已公开信息；终局才交付完整事件链。性质是完整性校验，不宣称绝对不可篡改。终局读取接口返回不可变副本，未完成对局不提供完整记录。
- 公共报价历史包含 offerId、round、amount、expiresAt、outcome，可选包含服务端白名单对白 `dialogue`。客户端按表现状态延后显示本轮刚生成的报价；对白不得包含 EV、倍率、概率或接受建议。
- aiType 白名单：conservative（默认）、aggressive、cold；创建时选择，单局不可修改。服务端策略版本 `ai-v1`。金额、轮次和超时不随 AI 改变。
- 当前 riskFactor=min(0.35+round*0.08,0.95) 保留作基线。保守型使用原公式；激进型乘独立随机 80–130 整数百分比；冷血型乘 0.70+0.30×初始最高三个金额尚未揭晓的比例。报价最终统一取百位整数、最小 10，检查有限安全整数。参数和随机抽样不进入公共配置、前端或分享摘要。
- 离线模拟使用相同局面比较三种策略并记录范围/差异；不把测试报告放到 public。对白只陈述角色态度，不虚构“大奖仍在”之类局面事实。

## 游客与战绩

- PostgreSQL 保存游客身份、已完成结果、报价历史、事件和公平证据；不创建账号系统，不承诺跨设备同步或进行中对局重启恢复。
- 游客凭据是随机 32 字节 opaque token，数据库只保存其 SHA-256；使用 HttpOnly、SameSite=Lax、Path=/ Cookie，生产 HTTPS 加 Secure。身份和房间重连令牌分离，不把 guestId 作为授权凭据。
- 现有 Node HTTP 服务增加 `/api/guest`、`/api/history`、单条战绩及分享摘要接口；Vite 同源代理 `/api`。不另建 API 服务或 Redis。
- 修改接口校验同源 Origin；所有身份响应和私人战绩 `Cache-Control: no-store`。JSON 有体积上限、查询分页有上限，使用参数化 SQL。战绩按已认证 owner 限制查询，不能靠猜 resultId 读取别人数据。
- 游戏服务器从握手 Cookie 解析游客身份，不接受载荷自报 owner。未启用数据库时明确告知战绩不可用，仍允许现有权威单人游戏；配置数据库却不可用时不可宣称已保存。
- resultId 为唯一键，服务端生成并保存记录，不接受客户端提交收益。完成记录先进入仅含已公开终局数据的本地持久化 outbox，再尝试事务写入数据库；失败保留并重试，重启后继续，不重复结算或覆盖已保存结果。该队列不是进行中对局存档。
- 分享默认关闭，仅用户主动创建；使用独立随机分享 ID，公开摘要只含模式、AI、最终收益、原始/最终箱号和成交结果。不返回游客 ID、Cookie、整个私人历史或身份相关信息。

## 验收边界

设置/公平/历史/AI/PWA 各项有对应功能测试与浏览器证据。真实 PostgreSQL 集成、真实设备性能未运行时明确保留待验证；内存替身和视口模拟不能替代。

实现参考：[Node crypto](https://nodejs.org/api/crypto.html)、[WebCrypto](https://www.w3.org/TR/WebCryptoAPI/)、[PostgreSQL INSERT / ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html)、[node-postgres 事务](https://node-postgres.com/features/transactions)。
