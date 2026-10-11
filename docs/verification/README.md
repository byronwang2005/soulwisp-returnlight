# 验收记录索引

这里保存历史结果，原始 JSON 不随文档整理改写。已标明日期的报告集中于 2026-10-10 / 11；部分文件没有时间或提交 SHA，需结合记录内容与 Git 历史确定范围。报告中的部署状态、账户数量、测试数和性能数据仅代表当次环境。

当前实现与待验收事项见 [开发状态](../development-status.md)。新改动的验收结论随提交或 PR 记录，不能直接复用旧报告。

| 范围 | 原始记录 |
| --- | --- |
| 规则与集成测试摘要 | [测试摘要](test-summary.json) |
| 本地生产预览与浏览器回归 | [预览入口](production-smoke.json) · [浏览器回归](browser-regression.json) |
| 本地迁移与恢复 | [本地部署](deployment-local.json) |
| 公网部署与迁移 | [公网部署](deployment-public.json) |
| 公网 4 / 10 人、5–9 人流程 | [四人与十人](public-gameplay.json) · [扩展人数](public-expansion.json) |
| 公网教程与营地 | [教程](public-tutorial.json) · [营地](public-camp.json) |
| 公网负载与测试数据清理 | [服务器采样](server-runtime.json) · [清理](public-cleanup.json) |
| 规则引擎 CPU / 编码基线 | [调度前](simulation-before.json) · [调度后](simulation.json) |
| 浏览器短时渲染采样 | [本地](render-performance.json) · [公网](public-render-performance.json) |
| 教程与十人场景 GPU 夹具 | [教程场景](scene-gpu-tutorial.json) · [十人场景](scene-gpu-ten-player.json) |
| 模型静态尺度 | [身体与脚底测量](character-scale.json) |
| 主题、布局与音乐 | [古铜主题](bronze-design.json) · [视口与音乐](viewport-music.json) |
| 公共语音本地链路 | [语音大厅](voice-lobby-local.json) |

## 输出约定

- 大部分测试的新输出在忽略的 `.local/verification` 和 `.local/screenshots`，需明确选择后再保存到文档目录。
- `node scripts/scene-assets.mjs --record` 会更新 `character-scale.json`；`tests/scene-performance.e2e.ts` 会更新 `scene-gpu-*.json`。普通资产检查不改报告。
- 新报告注明时间、提交 SHA / 规则版本、运行环境、命令和覆盖范围。CPU 模拟、GPU 夹具、浏览器音频标记与真实设备 / 公网测试分别说明。

## 局内美术与营地简化

[本轮静态验收](art-refresh.md)包含运行资产哈希、模型裁剪统计、纹理内存估算及 CPU 离线投影；不包含浏览器、联机或 GPU 实测。
