# 本地运行与局域网试玩

## 启动

项目使用 Node.js 24（版本见 `.node-version`）及提交的锁文件。准备 PostgreSQL 15 命令行工具并加入 PATH；Apple Silicon 的 LiveKit 安装还需要 Go。本地安装脚本仅支持 Apple Silicon，其他平台自行安装 Caddy / LiveKit。首次执行`npm ci`、`npm run setup`，再执行`node scripts/install-services.mjs`和`npm run dev`。安装脚本将Caddy和LiveKit放在项目的`.local/bin`。

`setup`初始化独立PostgreSQL数据目录`.local/postgres`，端口55432；随机密钥写入`.env`。`dev`启动网页5180、账户API3000、实时房间2567、LiveKit7880。Ctrl+C停止网页和游戏服务，数据库保留。

注册账户后点“开始归灯训练”，或直接创建好友房。每位玩家使用独立账户；普通标签页共享登录状态。生产预览使用`npm run build`、`npm run preview`。

## 同一Wi-Fi与局域网

记录本机局域网IPv4地址，执行：

```sh
node scripts/lan.mjs 192.168.1.100
```

命令生成Caddy配置和LiveKit内网地址，并更新`.env`。保持Caddy运行，在另一个终端重启`npm run dev`。

- 网页：`https://192.168.1.100:8443`
- 实时房间：WSS端口8444
- 语音信令：WSS端口8445
- 媒体：TCP7881、UDP50000–50100

允许上述端口通过本机防火墙。测试设备安装并信任`.local/caddy/pki/authorities/local/root.crt`；脚本不自动安装系统信任。iPhone还需要在证书信任设置中启用证书。网页警告放行无法代替麦克风所需的可信HTTPS。

先用两台设备戴耳机测试互听，再开始完整人数对局。浏览器拒绝麦克风时仍可使用文字、证据和投票。

恢复仅本机模式时，将`.env`的AUTH_BASE_URL恢复`http://localhost:5180`、ALLOWED_ORIGINS恢复localhost与127.0.0.1、LIVEKIT_PUBLIC_URL恢复`ws://localhost:7880`，删除VITE_GAME_URL及LAN_IP，再重启。

## 数据

`npm run backup`生成数据库备份。恢复目标必须是新建空库：

```sh
npm run restore -- /absolute/path/backup.dump postgres://USER:PASSWORD@127.0.0.1:55432/EMPTY_DB
```

恢复后核对账户、库存、研究、配装与结算记录，再调整DATABASE_URL。服务启动只运行提交的SQL迁移；已应用迁移内容改变会拒绝启动。

## 验证

默认执行静态检查，不需要启动游戏服务：

```sh
npm run check
node scripts/ground-assets.mjs
node scripts/scene-assets.mjs
npm run build
```

地面检查比对清单中的大小与 SHA-256；场景检查核对模型身体尺度、脚底与动作。`--download` 会恢复地面文件，`--record` 会更新尺度报告，日常检查不需要这两个参数。

仅在用户明确要求时运行以下验证：

| 命令 | 范围与前置条件 |
| --- | --- |
| `npm run test` | 规则、账户、实时房间与语音；需要本地 PostgreSQL 和 LiveKit |
| `npm run test:e2e` | 浏览器流程；需要 Playwright Chromium 及对应服务，详见 `playwright.config.ts` |
| `npm run measure` | 十人规则引擎六十秒 CPU / 私密视图编码基线，不测浏览器、媒体或公网 |

新输出通常写入 `.local/verification`、`.local/screenshots`；场景 GPU 用例和尺度记录脚本会写入 `docs/verification`。提交记录前说明时间、代码版本、环境与范围；旧报告从 [验收索引](verification/README.md) 查阅。

`npm run package`在`.local/releases/`生成源码与资产版本包，包含许可清单、迁移、启动工具、测试及手册，排除私有环境配置、数据库和备份。迁移玩家数据时另外执行`npm run backup`。

服务重启不恢复正在进行的远征；未完成对局不发材料，已有营地数据保留。短断线允许60秒恢复，终局到时冻结操作，必要时等待连接有效性确认再入库。
