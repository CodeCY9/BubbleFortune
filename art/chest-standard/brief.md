# chest-standard — 基础箱子

更新：2026-09-08。任务 ART-001；状态：待验证。新版已接入现有 26 箱演示，桌面/手机浏览器检查通过；真机性能与正式服务端 26 箱验收待补。

## 当前版本 v009 · 精致珠宝箱

- 本轮[制作规格与参考](concept/production-direction.md)，用户已确认概念与放大金额要求。复用 v008 机构，细纹外壳/绒面法线纹理、包角铆钉、锁扣转轴、铰链节和提手固定座；编号 180px 设计字号，金额区扩大至 1.19×0.49m，纯数字按长度适配。
- [制作脚本](source/refine_studio.py)；最新有效[标准源](source/briefcase_v009_material.blend)和[低档源](source/briefcase_v009_low.blend)。[标准 GLB](../../public/assets/models/runtime/BF_Briefcase_v009.glb) 13,924 三角面，[低档 GLB](../../public/assets/models/runtime/BF_Briefcase_v009_low.glb) 6,872 三角面；各 10 网格、3 材质、2 张内嵌 512px 法线纹理，仍为共享资源克隆而非实例化。
- [标准检查](validation/blender-v009.json)、[低档检查](validation/blender-v009-low.json) 均 0 错误/警告；[本轮范围报告](validation/runtime-sweep-v009.json)。源中保留动画 Actions，实际 GLB 有效片段仍为 Chest_Open，约 2.03 秒。
- [本轮验收](validation/studio-v009-review.md)记录最长金额、26 箱预览、游戏操作、桌面采样及限制。旧源/导出保留；下一步仍为真实手机性能检查。

## 上一有效版本 v008（历史）

历史 GLB 已归档至 legacy/runtime；当前 public 仅提供 v009 双档。[迁移清单与哈希](../../docs/validation/2026-09-10-runtime-archive.json)保留旧路径映射，历史报告内容不改写。

- 设计：[用户确认概念](concept/briefcase-approved-2026-09-08.png)。宽 1.40m 的薄型紫金手提箱，关闭竖立朝舞台中心；原位放下底座，活动上盖打开 100°，金额固定于上盖内侧。
- 生成源：[build_briefcase.py](source/build_briefcase.py)。Blender 5.2.0 LTS；最新有效检查点 [动画源](source/briefcase_v008_animation.blend)，[低档源](source/briefcase_v008_low.blend)。v006 白模仅为历史检查点，不是最终朝向。
- 交付：[标准 GLB](legacy/runtime/BF_Briefcase_v008.glb) 9,620 三角面 / 683,368 字节；[低档 GLB](legacy/runtime/BF_Briefcase_v008_low.glb) 5,710 三角面 / 448,500 字节。各 10 个网格、3 材质、0 纹理；不是烘焙贴图资产。导出有效动画只有 Chest_Open（约 2.03 秒），静态状态由运行时控制。
- [Box3D](../../src/components/Box3D.tsx) 共享几何与材质克隆，非实例化；HTML 编号和金额跟随挂点，使用独立点击代理。没有运行时材质覆盖或 hover 位移。
- [标准 Blender 检查](validation/blender-v008.json)、[低档检查](validation/blender-v008-low.json) 均 0 错误/警告。[完整动画范围检查](validation/runtime-sweep.json) 覆盖双档、16/26 箱及三种相机尺寸；[文件哈希](validation/delivery-manifest.json) 绑定当前源和导出。
- [游戏验收记录](validation/game-review.md) 包含实际截图、操作验证与限制。下一步：真机 FPS/绘制调用测量和正式服务端 26 箱场景验收；必要时再优化实例化。

## 以下为 2026-09-05 历史盘点（旧资源保留，已被上述运行时版本替代）

## 规格

用途：26 箱正式单人模式；桌面/平板/手机。深紫箱体、金属金边、独立箱盖及后侧铰链，编号与金额由运行时提供。
尺寸、比例及预算：须核对现有源文件与实际相机后确定；技能 chest-spec 的 1.60×0.82×1.05m 是起始建议，不是已验证实测。材料优先 1–3 个共享集合，桌面高与手机低档至少两档；已有三档需分别测量。不以技能三角数上限为填满目标。
运动/挂点：箱盖轴心、可读编号/金额挂点、FX/SFX 锚点及点击代理需要检查。客户端期望 Chest_Idle、Chest_Hover、Chest_Selected、Chest_Shake、Chest_Open、Chest_RewardHold；存在文件不等于全部片段有效。

## 已定位文件

- 源候选：[BF_Chest_v005_export.blend](legacy/source/BF_Chest_v005_export.blend)，仅文件存在，未打开检查。
- 历史报告源：[BF_Chest_v003_material.blend](legacy/source/BF_Chest_v003_material.blend)。
- 运行时：[LOD0](legacy/runtime/BF_Chest_lod0.glb)、[LOD1](legacy/runtime/BF_Chest_lod1.glb)、[LOD2](legacy/runtime/BF_Chest_lod2.glb)。
- 接入：[Box3D.tsx](../../src/components/Box3D.tsx)，引用三档资产和六类动画；包含运行时材质覆盖。
- 历史 [validation.json](legacy/validation/validation.json)：记录 Blender 5.2.0 LTS、v003_material、408 三角面、3 材质、6 Actions、PASS。未证明该报告覆盖 v005 或当前 GLB，数字不能作为当前预算实测。

## 概念与检查点

现有参考图片位于 asset/，选定参考、提示词、来源/授权、四视图归属待盘点。不要仅凭图片文件名选择最终设计。
最新已检查源：本次未打开 Blender 文件。最新有效检查点：未确认。当前导出哈希：未记录。Blender 控制方式：未连接验证；用户指定 5.2。
新产物保存 art/chest-standard/concept、source、previews、validation；旧 public 制作源文件已按 ART-003 完成备份并迁移至 [legacy/](legacy/manifest.json)（含 6 个 .blend、4 个 validation json、12 个 previews png）。历史 GLB 后续归档至 legacy/runtime，当前 v009 路径不变。

## 下一步与验收

1. 打开源候选，对比历史报告对应源，确定可继续编辑的有效检查点，记录版本/哈希。
2. 检查箱盖轴心、厚度、穿插、UV、片段、点击代理及挂点；核对运行时材质覆盖后的外观。
3. 记录每档三角面、材质/纹理/文件体积和同屏实例渲染策略；不要将 clone 当作 instancing。
4. Blender 渲染和实际游戏中检查 26 箱的关闭/选中/半开/全开/保持及低画质。记录设备/浏览器/画质/FPS。
5. 将匹配源与 GLB 的报告、预览和下一步写回此处后再判断完成。
