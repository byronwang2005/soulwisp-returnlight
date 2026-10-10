# 亡絮：归灯 / Soulwisp: Returnlight

浏览器实时探索、阶段议会与撤离养成游戏。四人优先完成，随后在本地逐档实现4–10人，全部验收后统一迁移单台服务器。

## 本地启动

需要Node24、PostgreSQL15的命令行工具。Apple Silicon本机语音安装还需要Go。

```sh
npm ci
npm run setup
node scripts/install-services.mjs
npm run dev
```

打开 http://localhost:5180。注册独立账户，创建4–10人房间，将邀请码交给同伴。普通标签页共享登录cookie，测试不同玩家请使用独立浏览器配置或不同设备。

```sh
npm run check
npm run test
npm run build
npm run health
npm run backup
```

本地密钥、数据库、服务二进制、日志和备份均在忽略目录`.local/`与`.env`。

## 游戏

暮钟城的死者记忆化作银白亡絮。归灯行会进入被灰月困住的旧城，点亮归灯柱、净化归灯芯并护送它离开。同行的蚀月者拥有相同公开职业，也能真实帮助工程，却可以暗中腐化祭坛、制造灰雾与阻断归途。

四人局为3名守灯者与1名蚀月者；14分30秒可操作时长，三次60秒议会。首章仅监视，后续全局最多永久封印一人。封印不立即揭晓阵营，终钟时统一裁决。

亡絮用于当局公共工程；旧城珍藏与有效对局奖励用于营地外观、研究和摆件。标准模式开放同一技能池，研究保留永久收藏与外观。

## 项目结构

- `apps/web`：React19、Three.js/R3F9三维表现与React界面。
- `apps/server`：Hono/BetterAuth账户、Colyseus权威房间、PostgreSQL/Drizzle持久化、LiveKit议会控制。
- `packages/rules`：共享可测试规则、人数配置、地图与内容。
- `packages/shared`：命令、授权视图、营地和结算协议。
- `deploy`：单机Linux部署模板；本地验收后实际使用。

操作步骤与实际截图见[玩家手册](docs/player-guide.md)，运行和局域网证书见[本地开发](docs/local-development.md)，背景见[故事](docs/story.md)，验收记录见[开发状态](docs/development-status.md)。运行模型来自KayKit官方免费CC0资源；完整来源、固定版本、动画与文件哈希见`apps/web/public/assets/manifest.json`。素材采购支出为0元。

`npm run package`生成包含源码、运行资产、迁移、启动工具与操作手册的版本包及SHA256校验文件；数据库使用`npm run backup`独立导出。
