# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

桌面、平板与手机浏览器中的休闲玩家；当前正式玩法统一使用 26 箱规则，包含经典单人、挑战模式、资本家对决、资本竞拍、生存战和锦标赛入口。快速设置仅缩短动画。核心需求是开箱悬念、接受/拒绝的压力和多人非对称谈判。

## Product Purpose

BubbleFortune 是原创响应式 3D 开箱谈判游戏。玩家根据公开金额、报价与对手行为决策；不展示期望值或接受建议。所有金额为虚拟分数。

## Positioning

即开即玩，3D 舞台强化情绪，HTML UI 保证可读性与操作。正式单人和多人都由服务端保管秘密并裁决。多人优先两人资本家对决，不采用共同投票。

## Operating Context

桌面鼠标/键盘、平板与手机触控；最低支持宽度 360 CSS px。公网与局域网共享权威协议。生产构建已提供 PWA 安装与静态缓存；正式游戏需要服务器，真机安装与触控仍待验收。

## Capabilities and Constraints

- 当前事实：26 箱权威单人、挑战模式、统一设置、五种服务端 AI、终局公平校验、游客战绩、双人对决、多人竞拍、生存战、锦标赛、赛季统计、风控与管理接口均已接入业务代码；真实设备、网络、数据库恢复和安全验收仍待完成，详见 ROADMAP。
- 当前里程碑：V0.1～V1.0 业务代码已交付但统一保持“待验证”；游客账号、跨设备同步和服务重启后的进行中对局恢复不在当前范围。
- 技术：React + TypeScript + Three.js + R3F + Drei，WebGL2 基线；游戏服务端使用 Node.js/TypeScript + Colyseus。
- 目标性能：桌面标准设备 60 FPS，中端手机 30–45 FPS，节能档可接受 30 FPS。目标不等于测量结果。
- 不充值、不提现、不兑换实物、不真实货币下注；不使用已有综艺名称和视觉资产。

## Brand Commitments

深靛紫、金属金色、克制霓虹与聚光灯；原创资本谈判舞台。细节以 [DESIGN](DESIGN.md) 为准，不重复 Token。

## Evidence on Hand

- [完整 GDD](GDD_V2.0.md)
- [技术设计与现状](docs/TECH_DESIGN.md)
- [开发进度](docs/ROADMAP.md)
- [资产索引](docs/ASSETS.md)

## Product Principles

清楚表达当前决策；响应式重排且手机独立镜头；保持秘密隔离；不把原型或历史报告宣传成已完成正式能力；按版本制作资产。

## Accessibility & Inclusion

核心操作支持键盘与触控，建议触控区至少 44×44 CSS px。金额不只靠颜色区分；关键文字和数字提供 HTML 表达。支持大字体、降低动态、关闭声音/摇晃/闪烁，网络异常提供明确下一步。
