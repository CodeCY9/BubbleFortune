# stage-basic — 基础舞台

更新：2026-09-10。任务 ART-002；状态：待验证。新版已接入 26 箱演示，服务端单人验证已完成（见 [2026-09-10-server-single-player](../../docs/validation/2026-09-10-server-single-player.md)）；真实手机性能待补。

## 当前版本 v007 · 精致演播厅

- [已确认概念](concept/studio-approved.png)；[制作脚本](source/refine_stage.py)复用 v006 台座顶面和挂点，增加下沉台面、分层箱座、加高分段弧墙、独立立体标志。模型内原有两侧短幕布已移除，保留原 16/26 箱间距及动画安全范围。
- 当前正式运行时为 [26 箱源](source/display_stage_26_v007.blend) / [GLB](../../public/assets/models/runtime/BF_DisplayStage_26_v007.glb)：约 32k 三角面。各 4 个材质批次，0 纹理；移除原有两侧短幕布，开场幕布改由全高舞台层动画承担。16 箱文件仅保留为历史/资产预览资源。
- 当前 Blender [26 箱](validation/blender-26-v007.json) 0 错误/警告；16 箱检查仅作为历史资产记录。[游戏与预览验收](../chest-standard/validation/studio-v009-review.md)和[布局检查](../chest-standard/validation/runtime-sweep-v009.json)。舞台源不含运行时灯光，接入时使用暖主光、弱填充与桌面阴影；低档禁用实时阴影。
- 开场幕布由 [App](../../src/App.tsx) 的舞台层覆盖实现：两片覆盖整个舞台内容区的紫色褶皱幕布从中央向左右缓慢拉开，覆盖舞台内容后再显示箱列；无障碍/降动态时瞬时完成。幕布不再作为 GLB 常态装饰。
- 旧资产保留。当前状态待验证：服务端单人已完成验收，真实手机性能仍待验证。

## 上一有效版本 v006（历史）

历史舞台 GLB 与 16 箱布局已归档至 [legacy/runtime](../../docs/validation/2026-09-10-runtime-archive.json)和 [stage-layout-16.json](legacy/stage-layout-16.json)。前端布局只包含 26 箱，原始 16 箱几何仍可通过制作检查脚本核验。

- [生成源](source/build_display_stage.py) 同时生成舞台与 [运行时布局](../../src/stage-layout.json)，避免台座和箱子分别硬编码。复用箱子的[确认概念](../chest-standard/concept/briefcase-approved-2026-09-08.png)。旧源未移动或覆盖。
- 正式 26 箱前到后为 6/7/7/6。半径 7/9.4/11.8/14.2m，台面高 0.30/1.85/3.60/5.65m；弧向间距 2.05m。台座 1.78×1.46m，箱子正面朝舞台中心。
- [16 箱源](source/display_stage_16_v006.blend) / [GLB](legacy/runtime/BF_DisplayStage_16_v006.glb)：17,928 三角面；[26 箱源](source/display_stage_26_v006.blend) / [GLB](legacy/runtime/BF_DisplayStage_26_v006.glb)：23,328 三角面。各 3 网格、3 材质、0 纹理，无多档 LOD 重叠。增加独立台座、阶沿、金边、分段背景与立柱。
- Blender 5.2.0 LTS 当前源 [16 箱检查](validation/blender-16-v006.json)、[26 箱检查](validation/blender-26-v006.json) 均 0 错误/警告。源和导出哈希见[清单](../chest-standard/validation/delivery-manifest.json)。
- [几何检查](../chest-standard/validation/runtime-sweep.json) 对照 GLB 挂点/布局，验证每个台座 9 点支承与整个开箱范围的实体和投影间隔；[实际游戏证据与限制](../chest-standard/validation/game-review.md)。下一步为真机性能和正式 26 箱服务端游戏验证。

## 以下为 2026-09-05 历史盘点（旧运行时已替换）

## 规格

紫金原创谈判舞台，包含基础地面、箱子排列区、背景与灯光；首版优先清晰点选和开箱表现，不追求完整观众/角色资产。桌面和手机独立相机，正式玩法采用 26 箱布局。尺寸以已打开源文件测量为准；整体三角面、绘制调用、纹理与灯光预算待设备测量确定。

## 已定位文件

- 源候选：[stage_v005_animation.blend](../../asset/blender/stage_v005_animation.blend)。另有白模、模型、拓扑、材质检查点，均未在本次打开验证。
- 制作导出：[stage.glb](../../asset/blender/stage.glb)。
- 网页导出：[BF_Stage.glb](legacy/runtime/BF_Stage.glb)。
- 接入：[StageEnvironment.tsx](../../src/components/StageEnvironment.tsx)，含材质覆盖，须以覆盖后的游戏效果验收。
- 历史 [validation.json](../../asset/blender/validation.json)：记录 Blender 5.2.0 LTS、stage_v005_animation、25,102 三角面、3 材质、2 Actions、0 错误/警告、PASS。尚未核对运行时 GLB 与该源一致性。
- 已有预览：[三分之四模型图](../../asset/blender/renders/model_three_quarter.png)、[材质图](../../asset/blender/renders/material_check.png)及同目录多视图/动画帧；本次仅文件盘点，不作视觉通过结论。

## 概念与检查点

选定概念图、提示词和来源待盘点。最新有效检查点未重新确认；当前源/导出哈希未记录。新制作记录放 art/stage-basic 下相应子目录，旧 asset/blender 源保留。用户指定 Blender 5.2；实际控制方式本次未验证。

## 下一步与验收

打开源候选，确认层级、比例、地面/箱子接触、动画及导出集合；比对 26 箱 GLB 版本。中性光和游戏光下渲染，检查手机镜头遮挡和安全操作区。以实际 26 箱场景测桌面/手机画质与性能，记录设备、尺寸、FPS 与资源统计。缺少当前导出关联和游戏内证据期间保持待验证。
