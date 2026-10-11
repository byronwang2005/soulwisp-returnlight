# 项目文档

《亡絮：归灯 / Soulwisp: Returnlight》的使用与维护入口。

| 需要做什么 | 文档 |
| --- | --- |
| 训练、组队、探索、语音和换装 | [玩家手册](player-guide.md) |
| 安装、启动、局域网、备份与验证 | [本地开发](local-development.md) |
| 查看人数配置、胜负、证据和奖励 | [运行规则](game-design.md) |
| 理解暮钟城背景与统一命名 | [故事](story.md) |
| 修改服务、账户、权限或结算 | [架构](architecture.md) |
| 修改场景、动作、界面、画质或音乐 | [场景与界面](presentation.md) |
| 维护首页公共语音大厅 | [语音大厅](voice-lobby.md) |
| 核对资源来源与许可 | [资产许可](asset-licenses.md) |
| 查看实现范围与待验收事项 | [开发状态](development-status.md) |
| 部署、发布或恢复 VPS | [部署手册](../deploy/README.md) · [自动发布](../deploy/AUTOMATION.md) |

## 文档维护

- 运行数值以 [规则配置](../packages/rules/src/config.ts)、[动作内容](../packages/rules/src/content.ts) 和 [规则引擎](../packages/rules/src/engine.ts) 为准；命令以根目录 [package.json](../package.json) 与对应脚本为准。
- 修改功能时更新对应说明，避免把实施过程和测试日志复制到多篇文档。
- [验收记录](verification/README.md) 与 [截图](screenshots/README.md) 保留历史证据，按记录版本阅读；当前验证结果随提交或 PR 报告。
- 开发及提交约定见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
