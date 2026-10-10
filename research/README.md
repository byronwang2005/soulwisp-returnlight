# 24 款游戏机制索引与取舍

核实日期：2026-10-10。调研回答的是“哪些决策能共同服务一局身份博弈”，而非把商业游戏的内容量直接相加。人数和版本信息见详细调研；下表只整理机制与本项目的候选取舍。

详细阅读：

- [社交推理与动作混合调研](./social-games.md)：10 款身份、合作生存、调查和曝光后追猎参照。
- [肉鸽、搜打撤、MOBA 与养成调研](./hybrid-games.md)：12 款成长、风险、资源和目标节奏参照。
- 本页末尾：Armello 与 Destiny 2 Gambit 两款追加参照。

“采用”表示写入首版玩法候选；“后续”表示在核心循环成立后单独测试；“排除”针对某个具体机制。它们是本项目设计选择。

## 总索引

| # | 游戏与官方来源 | 值得借鉴的决策结构 | 本项目取舍 | 详细调研 |
| --- | --- | --- | --- | --- |
| 1 | [Among Us](https://www.innersloth.com/games/among-us/) | 行动产生证据，公共任务提供另一条胜利压力 | 采用：行为线索、有限会议 | [社交调研](./social-games.md) |
| 2 | [Goose Goose Duck](https://store.steampowered.com/app/1568590/Goose_Goose_Duck/) | 不同动机与近距离交流形成临时结盟 | 后续：8–10 人中立变体；排除：小局独赢第三方 | [社交调研](./social-games.md) |
| 3 | [Project Winter](https://store.steampowered.com/app/774861/Project_Winter/) | 共同生存与修复让叛徒需要真实贡献 | 采用：共享危机与公共工程；排除：多套生存条 | [社交调研](./social-games.md) |
| 4 | [First Class Trouble](https://store.steampowered.com/app/953880/First_Class_Trouble/) | 环境事故和物理交互提供多种解释 | 采用：有痕迹、有救援窗口的事故 | [社交调研](./social-games.md) |
| 5 | [Deceit 2](https://store.steampowered.com/app/2064870/Deceit_2/) | 做任务同时支持通关与工具经济 | 采用：一条资源循环；排除：购买直接验人答案 | [社交调研](./social-games.md) |
| 6 | [Dread Hunger](https://store.steampowered.com/app/1418630/Dread_Hunger/) | 推动可见工程，利用资源和天气破坏 | 采用：共同目标与限次破坏；排除：无限自由处决 | [社交调研](./social-games.md) |
| 7 | [Blood on the Clocktower](https://wiki.bloodontheclocktower.com/Glossary) | 死亡后一次票权、小局另设信息规则 | 采用：受限幽影参与、按人数配置 | [社交调研](./social-games.md) |
| 8 | [Unfortunate Spacemen](https://store.steampowered.com/app/408900/Unfortunate_Spacemen/) | 暴露身份后转入怪物追猎 | 采用：曝光后的阶段；后续：短时拟态 | [社交调研](./social-games.md) |
| 9 | [LOCKDOWN Protocol](https://store.steampowered.com/app/2780980/LOCKDOWN_Protocol/) | 实时合作任务现场发生交流和阻挠 | 采用：现场交流与公共进度 | [社交调研](./social-games.md) |
| 10 | [Eville](https://store.steampowered.com/app/1220170/Eville/) | 村庄、昼夜、工具、足迹和死后活动 | 采用：可行动的身份游戏；排除：职业直接绑定阵营 | [社交调研](./social-games.md) |
| 11 | [Hades II](https://store.steampowered.com/app/1145350/Hades_II/) | 本局祝福组合与局外故事推进 | 采用：少量等预算成长；排除：永久数值优势 | [混合调研](./hybrid-games.md) |
| 12 | [Risk of Rain 2](https://store.steampowered.com/app/632360/Risk_of_Rain_2/) | 组合收益与持续增大的危险互相竞争 | 采用：有限遗物组合；排除：无限叠加 | [混合调研](./hybrid-games.md) |
| 13 | [Ravenswatch](https://store.steampowered.com/app/2071280/Ravenswatch/) | 有限成长时间后强制迎接章节目标 | 采用：探索、集结、议会的章节节奏 | [混合调研](./hybrid-games.md) |
| 14 | [Slay the Spire](https://store.steampowered.com/app/646570/Slay_the_Spire/) | 路线风险、协同选择与机会成本 | 采用：路线与升级选择；后续：完整卡组模式 | [混合调研](./hybrid-games.md) |
| 15 | [Deep Rock Galactic](https://store.steampowered.com/app/548430/Deep_Rock_Galactic/) | 工具互补改变团队路线 | 采用：公开工具职业；后续：复杂可破坏地形 | [混合调研](./hybrid-games.md) |
| 16 | [Lethal Company](https://store.steampowered.com/app/1966720/Lethal_Company/) | 前线与支援的信息差、运输与回撤 | 采用：局部感知和资源交接；排除：全知监控位 | [混合调研](./hybrid-games.md) |
| 17 | [Hunt: Showdown 1896](https://www.huntshowdown.com/player-guide/en_US) | 持有关键赏金换侦测和公开暴露 | 采用：圣物风险、护送与撤离 | [混合调研](./hybrid-games.md) |
| 18 | [Dark and Darker](https://store.steampowered.com/app/2016590/Dark_and_Darker) | 有限携带、取宝、深入和出逃 | 采用：背包取舍；排除：主模式个人提前撤离获胜 | [混合调研](./hybrid-games.md) |
| 19 | [Escape from Tarkov](https://store.steampowered.com/app/3932890/Escape_from_Tarkov/) | 入场准备与失败损失形成下注 | 采用：局内资源投入；排除：跨局装备市场与战力库存 | [混合调研](./hybrid-games.md) |
| 20 | [League of Legends](https://www.leagueoflegends.com/en-us/how-to-play/) | 中立目标、局内经济和地图视野 | 采用：公共目标与共享经济；排除：三路补刀、无限 PvP | [混合调研](./hybrid-games.md) |
| 21 | [Dead by Daylight](https://deadbydaylight.com/game/?category=survivor) | 修理、牵制、救援和逃生争夺时间 | 采用：倒地救援与终局追猎；排除：开局公开所有敌人 | [混合调研](./hybrid-games.md) |
| 22 | [Cult of the Lamb](https://store.steampowered.com/app/1313140/Cult_of_the_Lamb/) | 探险资源回流公共营地、建设与仪式 | 采用：有限公共建设、剧情养成；排除：繁琐生计循环 | [混合调研](./hybrid-games.md) |
| 23 | [Armello](https://armello.com/_press/sheet.php?p=armello) | 动态任务、地图行动与玩家对抗共同推进故事 | 采用：地图上的行动承诺；后续：完整桌游卡牌规则 | 本页追加条目 |
| 24 | [Destiny 2: Gambit](https://help.bungie.net/hc/en-us/articles/360048722272-Destiny-2-Gambit-Guide) | PvE 收集、资源交付与对手干扰互相连接 | 采用：可干扰且可反制的公共交付；排除：公开两队直接照搬 | 本页追加条目 |

## 追加参照

### Armello：地图行动让口头承诺变得可观察

开发者媒体包描述 RPG、卡牌与棋盘策略融合，角色在程序生成的六角地图上执行动态任务、探索、与怪物或其他玩家交战，并争夺终局目标。这份媒体包保留早期开发文字，这里只使用地图行动、任务和玩家对抗的抽象结构。[League of Geeks 官方 Armello 媒体包](https://armello.com/_press/sheet.php?p=armello)

本项目可借用“行动有路线、有代价、有结果”：玩家说自己去找净化材料，就要花真实时间去相应区域；改道可以发生，但可能被另一小队目击。地图节点提供调查、资源、交付等不同选择，让承诺能够和之后的行为对照。

完整卡牌战斗和掷骰系统放入后续候选。若同时要求玩家计算战斗概率、经营资源、维护装备、编造不在场证明，再参加多人议会，记忆负担会高于社交收益。先用少量地图节点与一次性工具实现路线选择。

### Destiny 2 Gambit：让收集—交付循环具有反打空间

Bungie 官方指南描述两支队伍与环境敌人战斗、收集资源并存入银行，队伍可以派玩家入侵并干扰对手；资源交付还能召出阻碍者。该指南包含版本相关旧数值，本项目仅引用收集、交付、干扰的结构。[Bungie 官方 Gambit 指南](https://help.bungie.net/hc/en-us/articles/360048722272-Destiny-2-Gambit-Guide)

本项目可让背包中的未交付资源承担风险，进入公共仪式阵后才成为公共进度。狼人破坏只能暂停银行交付、腐化一个有明确上限的目标，或者夺走尚未提交的资源；好人能清除阻碍、重新净化或夺回携带物。这为“把材料带回来”增加护送和反制价值。

不照搬两支公开对立队伍。这里所有人表面上为同一个公共工程服务，敌对目标藏在身份里；狼如何掩饰一次干扰，才是这一结构转成狼人杀的关键。破坏不能瞬间清空已经完成的整局积累，反制消耗也应由候选预算明确约束。

## 采用：连接同一局的核心系统

- **职业合作与隐藏身份**：职业工具公开，阵营独立抽取；贡献一次不能证明身份。
- **公共目标与一条资源循环**：探索、遗物、净化、建设、调查和终局目标共享有限的时间与资源。
- **章节探索与议会**：先经历共同事件，再交换证据、调整合作关系；议会期间保护讨论时间。
- **局部证据与有限误导**：事件真实存在，信息可以不完整，伪造与破坏付出代价且能复盘。
- **轻量构筑与有限携带**：少量等预算选择影响路线、工具与证词；控制叠加上限。
- **倒地救援、圣物护送与终局**：身份判断改变之后的行动和风险，曝光不必直接结束。
- **死后受限参与与横向养成**：让失误后仍有贡献和故事回报，同时保留同桌起点公平。

## 后续：作为独立增量测试

- 8–10 人中立身份变体，单独核算票权与个人胜利激励。
- 近距离语音与可窃听通信，配套文字和结构化举证。
- 有破绽、持续时间和成本的短时拟态。
- 更多遗物与职业风格，按信息、资源和行动预算扩充。
- 卡组战斗模式、复杂可破坏地图、季节与动态天气。
- 局外营地外观、角色关系与章节剧情。

## 排除：会改写核心激励或过度增加负担的直接拼接

- 永久生命、伤害、调查次数优势，付费战力与老玩家装备库存。
- 主模式个人提前撤离获胜，或个人奖励高于阵营胜利。
- 不受阶段和资源限制的 PvP 处决、无限补刀与经济滚雪球。
- 全图实时监控、无限直接验人、把公开职业固定绑定真实阵营。
- 无限叠装、完全不可调查的拟态、无痕迹且无法反制的随机杀人。
- 多套饥饿、温度、卫生、作物和材料生产链同时塞进短局。
- 把已经交付的全部公共进度瞬间清零，或让一个玩家永久封锁唯一出口。

这些取舍把 24 款参照收束到同一个目标：玩家需要一起行动，也需要判断同行者是否值得信任。
