# 应用图标

可编辑源为 [app-icon.svg](app-icon.svg)，沿用金色手提箱与紫色舞台视觉。运行图标位于 public/icons，主体保留 maskable 安全区。

生成：`node scripts/generate-icons.mjs <sharp 模块入口的绝对路径>`，或在可解析 sharp 的环境省略参数。该工具仅用于重新制作图标，正常开发与构建不依赖 sharp。
