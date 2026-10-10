# 《亡絮：归灯》Soulwisp: Returnlight · 素材与实施决策

2026-10-10 · 已进入实现 · 免费源资产 · 本地完成4–10人后统一上云。

主路线是 **KayKit免费CC0三维角色 / 场景 + Three.js / R3F9 + React19**。固定正交镜头、平面规则、直接GLB动画和实际换装共用一套资源。素材采购支出 **0元**，不依赖购买素材包或付费外部服务。

## 采用资源

| 项目 | 用途 | 官方来源与许可 |
| --- | --- | --- |
| KayKit Adventurers | Knight / Rogue / Mage / Barbarian职业模型、骨骼动作 | [免费作者包](https://kaylousberg.itch.io/kaykit-adventurers)、[仓库](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0)，免费部分CC0 |
| KayKit Dungeon Remastered | 地面、墙、柱、灯、箱、装置底座 | [仓库](https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0)，CC0 |
| Three.js / R3F / drei | 模型、动画、镜头与React生命周期 | [Three](https://github.com/mrdoob/three.js)、[R3F](https://github.com/pmndrs/react-three-fiber)、[drei](https://github.com/pmndrs/drei)，MIT |
| Colyseus | 房间、匹配、网络与重连 | [官方项目](https://github.com/colyseus/colyseus)，MIT |
| Hono / Better Auth / Drizzle | API、邮箱密码 / session、数据库 | [Hono](https://github.com/honojs/hono)、[Better Auth](https://github.com/better-auth/better-auth)为MIT；[Drizzle](https://github.com/drizzle-team/drizzle-orm)为Apache-2.0 |
| LiveKit / Caddy | 自建议会媒体、HTTPS/WSS、公网TURN分流 | [LiveKit](https://github.com/livekit/livekit)、[Caddy](https://github.com/caddyserver/caddy)，Apache-2.0 |

R3F9与React19采用同一代际；依赖解析由lockfile固定。[R3F版本要求](https://r3f.docs.pmnd.rs/getting-started/installation) 模型按固定GitHub commit下载，清单保留来源、动画、字节量、SHA-256及许可。KayKit免费部分与付费扩展包的授权分开记录。

工程目录目前尚未初始化Git。首次提交保留lockfile、资源来源和许可，按现有忽略规则排除密钥、`.local`、部署私有配置和数据库备份。

## 升级方式

角色、职业、动画和外观使用内容ID。新增换装可替换模型、材质或附件，不改服务端碰撞、技能和秘密权限。检查骨骼名称、动作、比例和附件锚点；缺失专属动作先用通用动作和明确读条表达，再补制。

固定镜头继续使用实时三维，同一模型能支持营地展示、配色、持物和对局动作。规则仍为节点与边的平面通路，视觉高度不增加楼层或空中判定。

旧方案中的 **Phaser4离线转精灵、PVGames付费主包已停止作为主推荐**。Kenney等免费资源以后按缺少物件补充，先维持KayKit统一风格；市场交易、素材订阅和付费语音不属于本轮前置条件。

## 当前切片与制作检查

工程已建立：四职业、五节点图、灯柱、暗祭坛、储藏点、芯、护送、营地和六阶段训练使用真实镜头。模型直接加载，外观应在人物上显示，不能只改头像。来源见 [manifest.json](../apps/web/public/assets/manifest.json)，内容规则见 `packages/rules`。

继续核对脚底锚点、门 / 装置比例、移动 / 交互 / 倒地动作、携物附件、可见危险与读条、十人同屏识别。手机记录纹理内存、阴影和特效负载；先加载对局必要资源，营地展示按需加载。本作专属演出与音效按 [四人制作](four-player-production.md)补齐。

## 本机交付

使用Node24、PostgreSQL15工具；Apple Silicon原生Caddy / LiveKit由安装脚本准备，日常入口 `npm run dev`。数据库和密钥在 `.local` / `.env`；账户、材料、研究、外观、配装预设和结算持久保存。本机不要求Docker，Linux迁移另用Compose模板。

四人优先，之后本地逐档完成5–10人再统一上云。独立浏览器上下文验证账户 / 权限，真人轮换狼职业和两形态，试玩抱团、分路、误封与夺芯。自动化不能代替社会推理平衡试玩。

同Wi-Fi要设置LAN媒体候选和可信HTTPS；`scripts/lan.mjs`生成Caddy内网CA，测试设备分别信任。详见 [本地开发](local-development.md)。

## 上云前结果

- 每档人数从准备到终局、入库、制作、换装和重开完整。
- 四人两条人类赢法、狼胜、回响和无效局有可复现实例；十人一房记录实际负载。
- 物品拾取 / 交接 / 托管与重复制作 / 结算不复制资源；隐藏身份和位置不进入载荷。
- 议会发言轮、自由讨论、回响禁发和离场强制关闭由实际LiveKit验证。
- 备份恢复新空库，账户、营地、结算和实物兑换一致，不覆盖活动库。
- 单VPS的HTTPS/WSS、UDP/TURN及每日七份备份按 [部署说明](../deploy/README.md)验收；Pages后续按需。

实际结果与缺口见 [开发状态](development-status.md)，服务边界见 [架构](architecture.md)。
