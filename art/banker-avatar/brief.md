# banker-avatar — 资本家形象

更新：2026-09-12。状态：待验证（2D 占位已接入，3D 扩充待开始）。阶段：游戏接入 / 轻量占位。GDD §11.5/17/21。

V0.1 使用已有 2D 半身图作为报价卡占位；高成本 3D 角色不阻塞首个可玩切片。当前五种 AI 性格使用六套已接入图片：保守使用 thinking，激进使用 confident，冷血使用 sinister，诱导使用 explaining，疯狂使用 pointing；smiling 作为后续终局/亲和表情备用。V0.2 起可按性格和表现扩充 3D 角色、表情和语音；这些扩充仍未开始。

## 当前接入文件

- `/public/assets/character_banker_thinking.png`
- `/public/assets/character_banker_confident.png`
- `/public/assets/character_banker_sinister.png`
- `/public/assets/character_banker_explaining.png`
- `/public/assets/character_banker_pointing.png`
- `/public/assets/character_banker_smiling.png`
- 接入位置：`src/components/BankerModal.tsx` 的 `AI_PROFILES`。
- 当前用途：报价卡与对白区域的 2D 半身头像；不参与隐藏金额、报价或结算裁决。

## 制作规格

用途：报价卡/资本家区域；紫金视觉下保持脸部表情可读，角色不暗示知道隐藏金额。半身角色加 2D 表情头像优先。具体外形、尺寸、相机距离、骨骼、动画和预算在开始制作时明确，未决定项不当作既定需求。

新 3D 角色缺适用参考时，先 imagegen 概念图，记录选稿/提示词/来源，再 Blender 5.2 白模、模型材质、绑定动画、优化与游戏验证。角色变形使用适用拓扑，不能照搬箱子硬表面全部规格。

## 交接

- 最新源/导出/有效检查点：现有 PNG 为运行时占位，尚未登记可编辑源、授权和透明边界报告。
- 下一步：补齐图片来源/授权和目标设备透明边界检查；若进入 3D 扩充，先填写具体资产规格并进入概念图阶段。
- 未来输出：art/banker-avatar 下概念、源、预览、报告；运行时交付沿用 public/assets/models/runtime/。
- 完成证据：匹配版本的源/GLB、表情与片段检查、实际报价场景和目标设备表现，不以生成一张头像视为 3D 完成。
