# ART-003 制作资产交付整理与迁移验收报告

日期：2026-09-10。任务：ART-003 制作源与公开资源分离。执行规范：[.agents/skills/blender-web-game-asset-pipeline/SKILL.md](../../.agents/skills/blender-web-game-asset-pipeline/SKILL.md)。

## 收尾状态

第二阶段已将下文登记的 17 个历史 GLB 迁至 art 下各资产的 legacy/runtime，公开目录只保留 3 个当前模型；[归档清单](2026-09-10-runtime-archive.json)记录原路径、目标、备份、字节数与 SHA-256。源/备份/目标核对一致，当前 3 个模型与 26 箱布局未改变。16 箱布局移入制作归档，`node scripts/check-briefcase.mjs` 对当前与历史几何检查通过，0 干涉、0 投影遮挡、0 裁切。下文是第一阶段整理时的原路径登记，不表示历史模型仍公开托管。

## 概述

根据资产制作规范与任务规划，`public/assets/models/` 原作为 Web 游戏公开静态托管目录，此前混放了初始箱子制作源文件（.blend）、验证报告（.json）及中间预览图（.png）。
本任务针对已确定的 22 个非运行制作文件完成完整备份与迁移整理至 `art/chest-standard/legacy/`，不修改模型三维内容。
如实区分运行时消费资源与保留的历史/对比模型：原有 19 个模型文件（位于 `runtime/`，包含当前运行引用的箱子与舞台、历史对比版本及独立片段）以及根目录历史参考模型 `chest_blue.glb` 完整保留在 `public/assets/models/`，SHA256 哈希值保持一致，前端应用与脚本引用不受影响。

## 迁移执行详情

### 1. 备份与迁移策略
- **限定范围与受限路径**：逐文件检查源与目标绝对路径，均严格限定在项目根目录下；执行前确认目标路径不存在，杜绝意外覆盖。
- **独立完整备份**：在被 git 忽略的 `.codex-antigravity/backups/public/assets/models/` 目录下完成 22 个源文件完整拷贝，并比对文件大小与 SHA256 哈希。
- **单文件安全迁移**：使用原生受限单文件原子重命名/移动，不使用不可控的递归通配删除或组合脚本。
- **历史证据保留**：迁移的历史 JSON 验证报告（如 `BF_Chest_gate4_validation.json`、`validation.json`）内容保持原始内容不作改写，保留原始 Blender 产出审计证据；在 [art/chest-standard/legacy/manifest.json](../../art/chest-standard/legacy/manifest.json) 中建立旧路径与新路径、备份路径的映射与解释。

### 2. 22 个迁移制作文件清单与哈希核对

| 文件类型 | 原始路径 (`public/assets/models/`) | 新路径 (`art/chest-standard/legacy/`) | 备份路径 (`.codex-antigravity/backups/`) | 大小 (Bytes) | SHA256 |
|---|---|---|---|---|---|
| blend | BF_Chest_v001.blend | source/BF_Chest_v001.blend | public/assets/models/BF_Chest_v001.blend | 94,494 | `e37e6788e4fb3acbf064f0acb5760a053b5e193f5fa4a78006ceb0db203f6689` |
| blend | BF_Chest_v001_blockout.blend | source/BF_Chest_v001_blockout.blend | public/assets/models/BF_Chest_v001_blockout.blend | 103,356 | `de4aa806800da8a3474e325d9235cec5132ff88d852f82ef3dc27175652ea6b2` |
| blend | BF_Chest_v002_model.blend | source/BF_Chest_v002_model.blend | public/assets/models/BF_Chest_v002_model.blend | 102,172 | `ca6ef37ce4443dae9ad45728cfa0db1aaf90237afb6311af06d118c445fc834a` |
| blend | BF_Chest_v002_model_uv.blend | source/BF_Chest_v002_model_uv.blend | public/assets/models/BF_Chest_v002_model_uv.blend | 119,480 | `d85dfe5590432d4d4223b71ca3c5b825a23c5178ea00578649d90e57b2f21d16` |
| blend | BF_Chest_v003_material.blend | source/BF_Chest_v003_material.blend | public/assets/models/BF_Chest_v003_material.blend | 118,417 | `47a5973e61971f708b59e77696e7e02286eec976d013174203049d733a30698d` |
| blend | BF_Chest_v005_export.blend | source/BF_Chest_v005_export.blend | public/assets/models/BF_Chest_v005_export.blend | 150,964 | `12ff2a186fd0bbeb9bf0e25ae3767cfff05fc9da5833f12a929a24054ab7d47a` |
| validation | BF_Chest_gate4_validation.json | validation/BF_Chest_gate4_validation.json | public/assets/models/BF_Chest_gate4_validation.json | 8,367 | `71d471049e09a9dfa26cb3114ceafb1469ad2f9c2da26bb91e7171e661af8170` |
| validation | BF_Chest_gate4_validator_config.json | validation/BF_Chest_gate4_validator_config.json | public/assets/models/BF_Chest_gate4_validator_config.json | 606 | `7d25f727886cc5b0bdd8bf88cca0f4f85133a24124380d957a07dca40cf14745` |
| validation | BF_Chest_validator_config.json | validation/BF_Chest_validator_config.json | public/assets/models/BF_Chest_validator_config.json | 1,024 | `3a8e68d77aab38bfd5bb791b72e53f2fe550ee63f781cd41ddf1c83a79da94c7` |
| validation | validation.json | validation/validation.json | public/assets/models/validation.json | 10,026 | `7fea543efd2234f701634f99a825e671d39da844795dfd7ad623ccad315a049a` |
| preview | previews/BF_Chest_blockout_front.png | previews/BF_Chest_blockout_front.png | public/assets/models/previews/BF_Chest_blockout_front.png | 299,695 | `2aaa1ac8dcd451809e819bf9da4715b27752294eb1641ce7cf44f9db842016cf` |
| preview | previews/BF_Chest_blockout_front_3q.png | previews/BF_Chest_blockout_front_3q.png | public/assets/models/previews/BF_Chest_blockout_front_3q.png | 370,740 | `7c0c59532865eb92bf12a547b44446530dc84f32ce2a119d73679dcbd9eb3bc9` |
| preview | previews/BF_Chest_blockout_rear.png | previews/BF_Chest_blockout_rear.png | public/assets/models/previews/BF_Chest_blockout_rear.png | 289,590 | `fc2778e653cb28ebe28fc3cc04382daa8ef75de4f7e812d14892f7dc588154d1` |
| preview | previews/BF_Chest_blockout_side.png | previews/BF_Chest_blockout_side.png | public/assets/models/previews/BF_Chest_blockout_side.png | 259,056 | `b591e2f342724256a9c9c13afae52b487290262de794d3229ca1f8ef91ae2e9a` |
| preview | previews/BF_Chest_final_front.png | previews/BF_Chest_final_front.png | public/assets/models/previews/BF_Chest_final_front.png | 593,987 | `4e35306f9b723eb678ec08279a3dab570fdb1da6dbace744dad4c50a42ff5f2a` |
| preview | previews/BF_Chest_final_front_3q.png | previews/BF_Chest_final_front_3q.png | public/assets/models/previews/BF_Chest_final_front_3q.png | 643,126 | `eacaa44e509ed9af5a253d9287fe410569cc4e198745c09c03acbb7abb6b30a4` |
| preview | previews/BF_Chest_final_rear.png | previews/BF_Chest_final_rear.png | public/assets/models/previews/BF_Chest_final_rear.png | 562,258 | `53e563d985bac0948898b2b9eb632ea2c6e251afcb874a6a790ffa79b26aeecd` |
| preview | previews/BF_Chest_final_side.png | previews/BF_Chest_final_side.png | public/assets/models/previews/BF_Chest_final_side.png | 565,705 | `96cf6b5ad84dc56d8ba4631183fb84eca820ddf3d6e285f6a3e57ec2b379a25a` |
| preview | previews/BF_Chest_model_front.png | previews/BF_Chest_model_front.png | public/assets/models/previews/BF_Chest_model_front.png | 303,860 | `4eb4a223813d8141e3af14fd4d040d0d66870ad1b0e1532c863010bd1a949c0b` |
| preview | previews/BF_Chest_model_front_3q.png | previews/BF_Chest_model_front_3q.png | public/assets/models/previews/BF_Chest_model_front_3q.png | 383,064 | `434ce6fd0f6af35d5bd5ec4df7d4f94b0bcd4778f77ed56b554b1a7e9d1f6379` |
| preview | previews/BF_Chest_model_rear.png | previews/BF_Chest_model_rear.png | public/assets/models/previews/BF_Chest_model_rear.png | 302,052 | `6eeaa6ec964bc9590840c14668ca619971c7eb9109aed10ee273a24b034164d3` |
| preview | previews/BF_Chest_model_side.png | previews/BF_Chest_model_side.png | public/assets/models/previews/BF_Chest_model_side.png | 266,604 | `617e53a9917da255f43509c53d6fc3a376276ed475d04070a66c9a7e4eac09eb` |

### 3. 保留的 19 个运行时/历史模型及 1 个根目录历史模型如实登记

现有公开模型目录保留资产分为两类：当前运行时直接消费资源与保留的历史/对比版本。禁止将所有资产均删到最小作为结论。

#### (1) 当前运行时直接消费模型
| 文件路径 | 大小 (Bytes) | SHA256 | 消费组件与用途 |
|---|---|---|---|
| `public/assets/models/runtime/BF_Briefcase_v009.glb` | 2,041,564 | `c4d378cea0bc52bd309e65384596bc3c1e11a53d3d737a033fc12ef427b0c6b4` | [Box3D.tsx](../../src/components/Box3D.tsx) 桌面端标准画质箱子模型 |
| `public/assets/models/runtime/BF_Briefcase_v009_low.glb` | 1,608,184 | `af6cab7b47c4023a9525ca9ecbc6f415a6c9d33d2dd8ea023c8bfc258825cf20` | [Box3D.tsx](../../src/components/Box3D.tsx) 移动端/低画质箱子模型 |
| `public/assets/models/runtime/BF_DisplayStage_26_v007.glb` | 1,917,800 | `2e3e198ac1218eedf3de8256196fbc887e5ad9ce708818b636deb9a579aad592` | [stage-layout.json](../../src/stage-layout.json) 正式 26 箱舞台模型 |

#### (2) 保留的历史版本与对比资产
| 文件路径 | 大小 (Bytes) | SHA256 | 保留性质与用途 |
|---|---|---|---|
| `public/assets/models/chest_blue.glb` | 8,060 | `2e7912d6e3e4fd097ce298031273d4add285ae6693f0812ed5851be730f9b5a2` | 原点历史占位模型，保留原地 |
| `public/assets/models/runtime/BF_Briefcase_v008.glb` | 683,368 | `dafa0f3e2c5a5a9e3a7e10e85abd23f7977e28fe2a6fe07b3fbb0d9a36b783a1` | v008 标准箱历史对照版，保留回退与性能对比 |
| `public/assets/models/runtime/BF_Briefcase_v008_low.glb` | 448,500 | `a277ab387c3a9e84a84ef85f2d4a4cb7ce89db53a3dcf9c9a362eaa430267603` | v008 低模箱历史对照版，保留回退与性能对比 |
| `public/assets/models/runtime/BF_DisplayStage_16_v007.glb` | 1,442,972 | `9adc4d3ecc7bf0955f7bc2eb079fea48f46f67fcf56a86a5eece9d28a2ae76cc` | 16 箱演播厅布局历史与预览保留 |
| `public/assets/models/runtime/BF_DisplayStage_16_v006.glb` | 834,396 | `27348ce3a4014d35d0a9fc928b3a7c8358b1fb2a8d2a7eb97d96e445a7d57fa5` | v006 16 箱历史资产保留 |
| `public/assets/models/runtime/BF_DisplayStage_26_v006.glb` | 1,099,840 | `2ae2bbf9c8cf3fd452c67f6595f4054abb1b40965c72ab1c6d74e1e8851bfc74` | v006 26 箱历史资产保留 |
| `public/assets/models/runtime/BF_Stage.glb` | 1,133,944 | `2d6c62ef573cb6de6f0165ff7ebf4f5f5d2c67f94f3dba2afe63c79112b4a0a3` | 原始单人基础舞台历史保留 |
| `public/assets/models/runtime/BF_Chest_lod0.glb` | 216,100 | `e3f14e996f0523909634104b74af5d4a036ff5a21c1ccb232ec58c590147a284` | 早期基础宝箱 LOD0 历史保留 |
| `public/assets/models/runtime/BF_Chest_lod0_nla_test.glb` | 28,236 | `7548039cfe27a4c4aba51903ac9ade18670359f4d122de52fbdca6cde0bdd3ad` | 早期 NLA 动画测试模型历史保留 |
| `public/assets/models/runtime/BF_Chest_lod1.glb` | 109,824 | `9e2e7df9bdb5b6be56021feba89bfe792e74b2b85acac4cfaefe955bac906b43` | 早期基础宝箱 LOD1 历史保留 |
| `public/assets/models/runtime/BF_Chest_lod2.glb` | 47,044 | `32af81bad23fdf52d379d402e85b9e91329a802d02c5d1cfb9959af7ae49ed0f` | 早期基础宝箱 LOD2 历史保留 |
| `public/assets/models/runtime/clips/Chest_Hover.glb` | 209,388 | `23bb476cee1e5407646a790cdd1c37bf1a326bfe9010828302adef4a8367ef50` | 历史独立动画片段 |
| `public/assets/models/runtime/clips/Chest_Idle.glb` | 209,512 | `bc7202d30c6573ddb67466b3673ee32f79dd9bc980629a17fd003deb0251f951` | 历史独立动画片段 |
| `public/assets/models/runtime/clips/Chest_Open.glb` | 210,748 | `0b4d9b48f160ebd6eab5e49d183bd6f1a21beb4ae8912c9966b42ec6ea8ca177` | 历史独立动画片段 |
| `public/assets/models/runtime/clips/Chest_RewardHold.glb` | 210,868 | `fab61b83484126ee15b7c1abe36a454b0c4ed5105753263cdd0a985c77850883` | 历史独立动画片段 |
| `public/assets/models/runtime/clips/Chest_Selected.glb` | 209,208 | `3c5236b74936b155a5300359053fb5f4d2859a5d645480dcf7b178f86f4b3182` | 历史独立动画片段 |
| `public/assets/models/runtime/clips/Chest_Shake.glb` | 209,152 | `bb3cb06b626e5037e15db6c4e72b7b344959dcf51d9db92d2835ef664d8c787c` | 历史独立动画片段 |

### 4. 引用、已有验证与当前限制说明

1. **代码与脚本引用**：
   - `src/components/Box3D.tsx` 引用 `BF_Briefcase_v009.glb` 与 `BF_Briefcase_v009_low.glb`，路径与内容均不变。
   - `src/stage-layout.json` 引用 `BF_DisplayStage_26_v007.glb` 与 `BF_DisplayStage_16_v007.glb`，保持不变。
   - `scripts/check-briefcase.mjs` 引用 `public/assets/models/runtime/` 下 v009 模型，测试执行通过。
   - 全局扫描确认无任何应用或脚本直接引用已迁移的 22 个非运行制作文件。

2. **验证产物更新**：
   - [runtime-sweep-v009.json](../../art/chest-standard/validation/runtime-sweep-v009.json) 是本次运行 `node scripts/check-briefcase.mjs` 产生的验证更新。报告覆盖双档箱子（BF_Briefcase_v009 与 low）、16/26 箱台座布局与 3 种相机视口（760×620、920×800、390×540）的几何开盖包围盒干涉和投影重叠校验，输出均为 0 physical overlaps、0 projected overlaps、0 clipped、0 errors。

3. **已有验证与当前限制**：
   - **已有验证**：完成了 Node.js / Three.js 动画范围与几何干涉校验、服务端权威 26 箱单人集成测试、前端表现层测试与 Chromium 浏览器视口操作验证。文档与 brief 链接经自动化脚本解析全量通过（0 死链）。
   - **当前限制**：真机硬件（真实移动设备触控、低端 GPU 性能、实际网络延迟与丢包）仍未完成实机验收，不将视口模拟直接当作性能达标证明；相关资产 brief 与总表均维持“待验证”状态。

4. **文档与 brief 链接更新**：
   - `docs/ASSETS.md`：记录 ART-003 完成 22 个制作源文件迁移与清单路径，runtime 及历史保留文件说明，并链接至本验收报告。
   - `art/chest-standard/brief.md`：更新旧文件定位链接指向 `legacy/source/` 与 `legacy/validation/`，记录 `legacy/manifest.json`。
   - `art/stage-basic/brief.md`：更新单人服务端验证状态引用（`docs/validation/2026-09-10-server-single-player.md`），明确真机性能仍待验证。
   - `docs/ROADMAP.md`：按照执行要求保持原样未修改。

## 验收结论

| 验收准则 | 结果 | 证据 |
|---|---|---|
| 迁移报告如实区分运行时资源和保留历史资源，列出已有验证及限制。 | 通过 | 报告第 3 节明确区分 3 个当前运行时消费模型（v009 箱子双档、v007 26 箱舞台）与 17 个保留历史/对比资产（v008 双档、16 箱/v006 历史舞台、早期 lod0-lod2 宝箱、独立 clips 片段及 chest_blue.glb）；第 4 节说明 runtime-sweep-v009.json 为 check-briefcase 产生的更新产物，并如实记录已有 Node/Three.js 几何验证与真机尚未实测的限制。 |
| 22 项迁移目标与备份哈希核对并返回精简有效报告；不新增测试执行。 | 通过 | art/chest-standard/legacy/manifest.json 登记的 22 项迁移目标与 .codex-antigravity/backups/ 备份文件 SHA256 及字节数 100% 吻合，源端原制作文件已移出；未新增任何测试与构建执行。 |
