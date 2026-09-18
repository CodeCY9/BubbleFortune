# BubbleFortune 项目指令

## 工作原则

1. 使用中文沟通，以用户当前要求为准，历史上下文补充背景。
2. 先判断任务属于回答、分析、诊断、修改、创建、发布还是监控。
3. 回答、分析、诊断默认只读；修改或创建任务才写入文件。
4. 修改前读取目标文件和上下文，保留用户已有改动，不覆盖无关内容。
5. 存在 .codegraph/ 且提供 CodeGraph 时优先用其定位代码；文件读取、搜索和机械替换优先 FastCtx。
6. 小文件和局部代码直接处理。大型检索和独立核验可委派会话内原生探子代理；原生探子代理行为规则严禁直接修改代码或文件，遵循单轮即用原则（`fork_turns = "none"`，不复用、不追派），不负责方案取舍或交付。不重复已委派范围。
7. 架构、需求、设计和交接基础文档由主代理首次完整直接阅读建立全局视角，后续复核关注相关改动与缺失上下文。
8. 小范围语义修改使用 apply_patch；机械批量替换使用专用工具。
9. 满足当前需求的最小实现优先，不顺带重构，不提前实现整个 GDD。
10. 工具不存在时不要反复尝试；采用安全替代。遇到权限、缺文件或环境阻塞，完成不受影响的工作并说明必要信息。

## 代理角色分工与行为禁令

必须明确区分会话内原生探子与外部 Antigravity 实现 Worker：

1. **原生探子代理 (Native Scouts)**：
   - 职责：会话内轻量探子，负责「宽而重」的代码检索、外围调查与独立核验。
   - 行为禁令：仅限只读探索，严禁直接修改代码或写入文件；单轮即用，不复用、不追派。
   - 调度原则：不重复探索已有委派范围；已有充分证据时不重复验证。

2. **外部实现 Worker (External Agy Worker)**：
   - 职责：通过 codex-antigravity-bridge MCP 工具委派具体的代码编写、批量修改与验证执行。
   - 允许进行实现所需的局部代码核对，但不得重复探子已覆盖的检索范围。
   - 支持跨轮续接：通过 `conversation_id` 传递 Review 定向意见与验收重测。
   - 行为禁令：**严禁递归委派**（Worker 必须直接落地执行，严禁派生子代理或递归调用 agy）。
   - 最终决策权：架构方案、取舍决策及最终验收由 Codex 主导，不转交 Worker。

## 文档入口与权责

- [GDD_V2.0.md](GDD_V2.0.md)：产品目标、玩法、安全底线、版本范围。
- [PRODUCT.md](PRODUCT.md)：产品摘要；不得与 GDD 冲突或将目标写成已实现功能。
- [DESIGN.md](DESIGN.md)：视觉语言、布局、交互与组件状态。
- [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md)：实现边界、状态机、协议和待决问题。
- [docs/ROADMAP.md](docs/ROADMAP.md)：唯一开发进度入口、当前交接与验收证据。
- [docs/ASSETS.md](docs/ASSETS.md)：资产索引；每件资产的详细进度在 art/<asset-id>/brief.md。

开始实现前读取 ROADMAP、相关 GDD 章节和实际代码。UI 工作读 DESIGN；服务端、规则、协议工作读 TECH_DESIGN。首次整体架构/里程碑规划时主代理完整阅读 GDD，后续复核关注相关改动与缺失上下文。文档缺失时说明，不虚构。

用户明确变更需求时遵循本次要求并同步受影响文档。其他文档与 GDD 冲突时指出并修正从属文档，不静默改变玩法。未确定的金额池、计分、公平性和关键流程必须记录为待决；可先做不依赖该决定的工作。技术建议、设计示例和规划目录不等于已确认玩法或实际实现。

## 项目底线

- 正式单人和多人都由服务端权威裁决；局域网与公网使用同一规则与协议。
- 隐藏金额、种子、箱子映射、报价内部参数只保存在服务端，不能进入浏览器构建、状态、响应、错误或日志回传。
- 客户端只接收公共状态及本人有权看到的私有视图。未开箱对象不包含金额字段。
- 不向游戏前端下发或展示理论期望值、报价系数、期望百分比、接受建议或箱子概率推断。
- 客户端提交意图，服务端校验身份、阶段、权限、状态版本、序号、幂等性和截止时间。
- 接受报价校验 offerId；不信任客户端提交的报价金额。重复请求不得重复结算。
- 种子仅在整局结束后公开；重连不提前泄露，多回合不得通过复用已公开种子泄露后续局面。
- 游戏金额均为虚拟分数，不添加充值、提现、实物兑换或真实货币下注。
- 多人优先资本家对决，不改成共同投票。

## 实现与 UI 边界

- 前端沿用 React、TypeScript、Vite、Three.js、R3F、Drei；不引入 Phaser 或第二套渲染体系。
- 3D 负责舞台、箱子和效果；关键文字、金额和操作使用 HTML/CSS。
- 前端可导入的共享包只含公开协议、类型和非秘密配置；服务端秘密逻辑不能经共享导出进入前端。
- 服务端决定状态；本地动画不决定结果、不推进服务端流程。请求等待状态与游戏状态分开。
- 正式模式不隐式回退到本地随机；旧演示原型需独立标识和隔离后才可保留。
- 遵循 DESIGN 的视觉方向和断点；26 箱按模式布局（仅支持 26 箱模式），示例金额、编号不写死。
- 触控不依赖 hover，核心操作支持键盘；手机重排布局并单独调整相机，底部避开安全区。
- 支持低画质、降低动态效果及 3D 加载失败反馈；不要把生成脚本成功等同于视觉完成。

## 3D 资产工作流

创建、重制、修复、动画、LOD 或导出游戏资产前，必须读取并遵循：
[blender-web-game-asset-pipeline](.agents/skills/blender-web-game-asset-pipeline/SKILL.md)。

- 先读 DESIGN、ASSETS 和目标资产 brief；新资产缺适用参考图时使用 imagegen 技能生成设计图，再用 Blender 建模。
- 修复、材质变体和 LOD 复用可用设计，不重新生成无必要概念图。
- 使用 Blender 5.2。用户提供的 launcher 路径只是定位线索，操作前确认实际版本、活动文件和控制能力。
- 优先 Blender MCP，缺失时用实际 Blender 可执行程序运行 Python；不假设 @应用等于已经连接。
- 概念、白模、模型材质、动画、导出、游戏验证分别保留证据；按既定规格自行检查并推进，无需每阶段请求批准。
- art/ 保存新资产规格、概念、源文件、预览和报告；public/assets/models/runtime/ 只放需要公开加载的交付资源。
- 现有源文件先保留并登记，迁移时核对引用和备份，不破坏唯一有效版本。
- 每个资产预算须考虑同屏实例总成本，项目预算优先于技能默认值。复用 mesh 不等于实例化。
- 资产只有匹配版本的 Blender 检查和实际游戏内验证通过，才标记完成。

## 进度与交接

- 实现开始前读取 ROADMAP，核对当前任务、依赖、阻塞和文件；用户指定任务优先。
- 用户要求继续开发时，选当前里程碑中依赖满足、优先级最高的未完成项。
- 状态统一：待开始、进行中、待验证、阻塞、已完成；阻塞必须写原因和解除条件。
- 修改/实现结束或切换工作前更新交付物、验证证据、下一具体动作及日期；只读任务不写进度。
- 已完成必须有可定位交付物和适用验证证据；代码存在、GLB 存在、历史 PASS 都不足以证明当前版本完成。
- 最新文件与最新有效检查点分开记录。进度与实际文件冲突时核对后修正，不依赖聊天记忆。
- 资产阶段改变更新 brief 和 ASSETS；里程碑任务状态改变再更新 ROADMAP，避免重复流水账。

## 验证与交付

- 单纯分析或修改不自动运行测试、构建、Lint 或格式化。
- 修复、实现、完成、交付执行直接相关的最小验证；用户指定命令时只执行指定命令。
- 命令以实际 package.json scripts 为准；不存在的脚本不得虚构执行。
- 已有充分验证证据时不进行冗余重复运行测试。
- Skill 更新执行 skill-creator 的 quick_validate.py，并检查引用和真实任务路由；不为文档改动运行游戏构建。
- 规则验证重点：秘密隔离、非法操作、重复命令、过期报价、重连与结算一致性。
- UI/资产验证记录尺寸、设备、画质和场景；未测设备不宣称通过。
- 最终简述完成内容、文件链接、验证结果和剩余限制。


# Codex + Antigravity Orchestration Policy

## Roles

Codex is the **planner, architect, and reviewer**.
Antigravity Gemini 3.8 Flash is the **implementation and verification worker**.

The purpose of this repository policy is to spend high-capability Codex reasoning on decisions that affect correctness and consistency, while delegating broad repository reading, repetitive implementation, test execution, and focused fixes to the Antigravity MCP worker.

## Mandatory workflow for non-trivial implementation

This mandatory workflow applies exclusively to the Codex coordinator when orchestrating non-trivial implementation tasks (multi-file changes, repository exploration, test creation, refactoring, or debugging). It does not apply to read-only diagnosis, native scouts, or the agy worker itself:

1. Understand the user goal and repository constraints.
2. Read only enough high-level/relevant code to make the architectural decision. Initial foundation docs (GDD, TECH_DESIGN, ROADMAP) must be read directly by Codex; subsequent review checks inspect relevant changes and missing context.
3. Produce a concise implementation plan with acceptance criteria.
4. Split the work into coherent tasks only when dependencies or independent areas justify it. Avoid micro-tasks.
5. Delegate implementation through the Antigravity MCP server `execute` tool.
6. Review the worker report AND the actual git diff/current files. Never accept the worker's self-report as proof by itself.
7. If review fails, use Antigravity `continue` with the same `conversation_id` and precise correction feedback. Prefer continuation over starting from zero.
8. Repeat review/correction until acceptance criteria pass or a genuine blocker is identified.
9. Give the user the final result, including any remaining uncertainty or tests that could not run.

## Codex owns

- requirement interpretation
- architecture and design decisions
- task boundaries and dependency ordering
- public API/data-model decisions
- security-sensitive decisions
- acceptance criteria
- review of diffs
- final verification and user-facing conclusion

## Delegate to Antigravity

- targeted repository exploration for implementation details (worker may perform local inspection for implementation, but must not duplicate prior scout scope)
- writing or modifying implementation code
- mechanical multi-file changes
- test creation/update
- lint/build/test execution
- focused bug fixes after Codex identifies the likely cause
- repetitive migrations/refactors once Codex defines the pattern

## Do not delegate blindly

Codex must not ask Antigravity to "figure out the whole architecture" when architecture materially affects the product. Decide the important constraints first.

Do not delegate tiny one-line edits when tool overhead is larger than doing the edit directly, unless the edit needs repository-wide verification.

Do not ask the worker to make unrelated cleanup changes.

Workers must NOT recursively delegate: worker is the terminal implementation agent and must not spawn subagents or invoke agy.

## Delegation payload

Every `execute` call should contain:

- a concrete task, not a vague feature request
- observable acceptance criteria
- only the planner context required to implement it
- a preferred file scope when reasonably knowable
- an appropriate model/effort

Default worker model: `gemini-3.8-flash-high`.
Use `gemini-3.8-flash-medium` for straightforward/repetitive work.

Default permissions: `full`.

## Suggested planning shape

```json
{
  "goal": "...",
  "tasks": [
    {
      "id": "T01",
      "goal": "...",
      "depends_on": [],
      "preferred_files": ["src/.../**", "tests/.../**"],
      "acceptance": ["...", "..."]
    }
  ]
}
```

## Review standard

After worker execution:

- inspect changed files/diff for architectural consistency
- check every acceptance criterion against evidence
- look for scope violations and unrelated edits
- confirm tests actually ran rather than being merely proposed; avoid redundant test reruns when adequate evidence exists
- check error handling, compatibility, and obvious security issues
- when needed, run a small independent verification yourself

If the worker reports `partial` or `blocked`, treat the task as incomplete even if the Antigravity CLI process itself exited successfully.
