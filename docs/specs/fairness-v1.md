# BubbleFortune 公平性协议规范 v1 (`hmac-sha256-fy-v1`)

日期：2026-09-10  
协议版本：`hmac-sha256-fy-v1`  
适用规则版本：`classic-26-v1`

---

## 1. 协议目标与安全边界

BubbleFortune 采用基于服务端密码学承诺（Commitment Scheme）与可重算洗牌（Verifiable Fisher–Yates Shuffle）的一致性校验协议，设计目标与信任边界如下：

1. **开局预承诺（Pre-commitment）**：箱内金额在玩家选择幸运箱前由服务端确定。开局时，服务端通过 SHA-256 哈希公开初始承诺（`commitment`）。终局时服务端公开原始参数供客户端复算，用于证明服务端在游戏进行中未根据玩家操作动态调换箱子内容。
2. **隐藏信息与状态隔离（Information Hiding & State Isolation）**：进行中各阶段（SELECTING、OPENING、OFFERING、FINAL_SWAP）及重连、错误响应中，严格不向客户端传递 `seed`、`salt` 及未打开箱子的实际金额。
3. **承诺一致性校验（Commitment Consistency Verification）**：游戏结束后（`FINISHED`），公开完整的证明载荷（`fairnessProof`）。客户端可通过标准 WebCrypto API 独立复算承诺并重构 26 箱完整映射，与终局揭晓结果比对。
4. **信任边界与非目标（Trust Boundaries & Explicit Limitations）**：
   - **依赖保存初始承诺**：完整有效性严格依赖客户端在收到开局快照时固定保存并对比 `initialCommitment`。若客户端未保存开局承诺，只能验证证明自洽（`SELF_CONSISTENT_NO_INITIAL_COMMITMENT`），无法排除服务端事后挑选种子的可能性。
   - **不证明服务器诚实采样**：协议仅证明“终局数据与开局承诺一致”，并不证明服务端底层 CSPRNG 在抽取 `seed`/`salt` 时完全公正无偏，亦不证明服务端未在成局前做无成本的预选试抽。
   - **审计链可整体重算**：事件链是单局内的哈希链（Hash Chain），用于核对操作顺序与公开载荷完整性。掌握服务端密钥与控制权的服务端在最终公布前理论上能够整体重构整条链，因此其属性是事后可核查的完整性校验，而非跨节点共识或物理防篡改。
5. **测试与正式隔离**：测试局注入的自定义映射必须明确标记 `fairness.supported = false`，终局不提供证明对象（`fairnessProof: null`），禁止伪造证明。

---

## 2. 密码学算法与洗牌规则

### 2.1 基础参数与编码
- **算法标识**：`hmac-sha256-fy-v1`
- **规则版本**：`classic-26-v1`
- **种子 (seed)**：32 字节 CSPRNG 随机数，表示为 64 位小写十六进制字符串（如 `00...00`）。
- **盐 (salt)**：32 字节 CSPRNG 随机数，表示为 64 位小写十六进制字符串（如 `11...11`）。
- **规范 JSON (Canonical JSON)**：所有对象属性按 UTF-16 代码单元升序排列，数组保持原始顺序，无多余空格与不可见字符。

### 2.2 开局承诺生成
承诺输入包含：
- `algorithm`: `"hmac-sha256-fy-v1"`
- `amounts`: 升序排列的 26 个公开金额数组
- `gameId`: 当前对局标识
- `roundTargets`: 轮次开箱目标 `[6, 5, 4, 3, 2, 1, 1, 1, 1]`
- `ruleVersion`: `"classic-26-v1"`
- `salt`: 64 位十六进制盐
- `seed`: 64 位十六进制种子

承诺计算公式：
$$\text{commitment} = \text{SHA-256}\left(\text{"BubbleFortune/commit/v1\textbackslash n"} + \text{canonicalJsonStringify}(\text{data})\right)$$
输出为 64 位小写十六进制字符串。

### 2.3 Fisher–Yates HMAC-SHA256 拒绝采样洗牌
箱内金额从初始升序 `MONEY_VALUES`（索引 0 至 25）出发：
1. **全局计数器初始化**：在**整个洗牌算法开始前**，初始化采样计数器 $\text{counter} = 0$ 一次。此计数器在所有 25 次外层循环及内层拒绝采样中全局严格自增，**绝不是每次 $i$ 循环重置**。
2. **外层循环**：循环变量 $i$ 从 25 降至 1（包含 1）。令 $n = i + 1$。
3. **采样与拒绝判定**：
   - 构造 HMAC-SHA256 消息：
     $$\text{UTF-8}(\text{"BubbleFortune/shuffle/v1:"} + \text{salt} + \text{":"} + \text{counter})$$
   - 使用 `seed` 原始 32 字节二进制作为密钥，计算 HMAC-SHA256 摘要，取前 4 字节按大端序转换为 32 位无符号整数 $\text{val}$。
   - 计数器递增：$\text{counter} \leftarrow \text{counter} + 1$（无论后续采样是否被接受，每次尝试采样严格递增）。
   - 计算无偏阈值：
     $$\text{limit} = \lfloor \frac{2^{32}}{n} \rfloor \times n$$
   - 若 $\text{val} < \text{limit}$：接受该采样，令 $j = \text{val} \pmod n$，交换位置 $i$ 与位置 $j$ 的金额，当前外层循环结束，推进至 $i - 1$。
   - 若 $\text{val} \ge \text{limit}$：拒绝该采样，保持当前 $i$ 不变，再次进行采样直至接受。
4. 最终产生的 26 项数组，即对应箱号 1 至 26 的内部金额映射。

---

## 3. 官方固定测试向量

主代理以 Python 标准库独立计算并已由 Node / WebCrypto 完全复现的固定向量：

```text
seed = "0000000000000000000000000000000000000000000000000000000000000000"
salt = "1111111111111111111111111111111111111111111111111111111111111111"
gameId = "fairness-vector-1"
ruleVersion = "classic-26-v1"
algorithm = "hmac-sha256-fy-v1"

commitment = "0440068d20082bb60b6d8d6d3571d8e9b7d17788597312f0d01ab7b45ecd9996"

mapping 按箱号 1–26 = [
  750, 1, 1000, 50, 200000, 100000, 10000, 5, 2500, 500, 300, 75,
  300000, 500000, 400000, 400, 100, 750000, 10, 75000, 25000, 200,
  1000000, 5000, 50000, 25
]

采样 counter = 25
```

---

## 4. 浏览器 WebCrypto 验证流程

验证器位于 `packages/protocol/src/fairness.ts` 中，纯使用标准 WebCrypto API，可运行于浏览器及 Node 环境：

1. **运行环境检测**：
   - 检查当前上下文是否存在 `globalThis.crypto.subtle`；若处于不安全 HTTP 局域网等无 WebCrypto 的环境中，明确返回不可用状态，不误报为数据被篡改。
2. **结构与边界防御**：
   - 所有入参解析置于安全块中，缺失字段或畸形对象返回明确校验失败，不得抛出未捕获异常。
   - 验证 `algorithm === "hmac-sha256-fy-v1"` 与 `ruleVersion === "classic-26-v1"`；
   - 验证 `seed` 与 `salt` 均为 64 位小写十六进制字符串（匹配 `/^[0-9a-f]{64}$/`）；
   - 验证 `amounts` 与 `roundTargets` 长度和数值匹配官方配置；
   - 验证 `commitment` 格式合法。
3. **承诺哈希重算与开局对比**：
   - 用 WebCrypto 重新序列化并计算 SHA-256，校验与 `proof.commitment` 是否一致。
   - 若提供了 `options.initialCommitment`，比对是否一致；若不一致报错 `Initial commitment mismatch`。
4. **洗牌映射重算与完整箱号校验**：
   - 完整校验**必须提供包含全部 26 箱的 `finalBoxes`**。若未提供 `finalBoxes`，返回 `status: "INCOMPLETE"`、`boxMappingMatches: false`、`valid: false`，不冒充校验通过。
   - 校验 `finalBoxes` 是否涵盖箱号 1 至 26 且无缺失重复；
   - 逐一比对每个箱号金额是否与推导金额完全相等。

---

## 5. 有序审计事件链 (Audit Event Chain)

为保证单局事件序列的单调性与完整性，服务端维护单局链式事件记录：

```ts
export interface AuditEvent {
  seq: number;          // 严格单调递增，创世为 1
  timestamp: number;    // 服务端时间戳，有限安全正整数
  type: string;         // 事件类型，非空字符串
  payload: Record<string, unknown>; // 事件公开载荷，非空对象
  previousHash: string; // 上一事件 hash（创世事件为 64 个 '0'）
  hash: string;         // SHA-256(canonicalJsonStringify(eventWithoutHash))
}
```

- **记录范围**：`GAME_CREATED`、`BOX_SELECTED`、`BOX_OPENED`、`OFFER_MADE`、`OFFER_ACCEPTED`、`OFFER_REJECTED`、`FINAL_KEEP`、`FINAL_SWAP`、`GAME_SETTLED`。
- **终局结构校验**：完整终局事件链的首个事件类型必须为 `GAME_CREATED`，最终事件类型必须为 `GAME_SETTLED`；未结算或被截断的事件链不能宣称完整终局通过。
- **超时与幂等**：超时执行的操作在 `payload` 中明确包含 `source: "timeout"`，超时未响应报价标记 `outcome: "EXPIRED"`。重复请求被幂等拦截，不重复追加事件。
