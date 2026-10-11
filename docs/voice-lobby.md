# 灯下语音大厅

首页顶部以单行状态条显示公共语音大厅、人数和加入入口。点击大厅名称打开完整面板：桌面为右侧栏，手机为底部面板。登录后点击“加入语音大厅”即可收听并打开面板，点击“开启麦克风”开始说话。大厅最多 10 人，所有成员都可自行开麦。

点击“收起语音大厅”或按 Escape 关闭面板，语音继续连接；状态条可快捷开启或静音麦克风。成员、收听开关、播放解锁和连接诊断位于面板内。“离开大厅”退出语音并收起面板。状态条在桌面占用 64px，在手机和低高度屏幕占用 56px（含间距），人数变化和打开面板不会压缩首页内容。

“关闭收听”只关闭自己的播放，不影响其他成员。静音保留已打开的麦克风设备，停止发送声音；再次开麦复用原轨道。离开首页、进入训练或远征、退出账户时释放麦克风并退出大厅。返回首页后需要重新加入。另一个页面用同一账户加入时会接管语音，原页面显示接管提示。

麦克风被拒绝时仍可收听。浏览器阻止播放时点击“点击启用声音”。连接中可以取消，服务离线时可以重试，短时断线由 SDK 恢复。

## 接口与媒体

| 接口 | 权限 | 返回 |
| --- | --- | --- |
| `GET /api/voice/lobby` | 公开 | `available`、`online`、`capacity: 10`、`url` |
| `POST /api/voice/lobby/token` | 账户会话 | `token`、`url`、`epoch` |

公开接口不返回成员身份或票据；人数来自 SFU，状态缓存 3 秒。票据有效期 20 秒，身份和昵称来自账户会话，只允许麦克风发布及媒体订阅，禁止视频、屏幕和数据发布。满员返回 `409 LOBBY_FULL`，已在远征中的账户返回 `403 IN_EXPEDITION`，离线返回 `503 LOBBY_UNAVAILABLE`。多个未入场票据同时使用时，由 LiveKit 执行 10 人上限。

公共房间使用独立实例标识和随机 epoch，与议会房间分离。空房过期后重新创建，关闭服务时只删除自身创建的房间。保持 `room.auto_create: false`，旧房间的票据不能创建新房间。

生产环境采用单个权威应用进程。重启后首次使用大厅时，先关闭同一部署标记的旧实例房间，再创建当前大厅；兼容首次版本遗留的大厅标记。旧房删除失败时不签发新大厅票据，避免把听众分散到两个房间。旧页面收到“大厅已重启”后重新点击加入。

复用锁文件中的 LiveKit SDK，使用 Opus 单声道 24 kbps，开启 DTX、RED、回声消除、降噪和自动增益。首页预热 DNS/TLS，加入时解锁播放；大厅入场权限直接签发，不经过议会发言权轮询。加入和通话期间营地预览按需渲染，停止持续动画循环；对局和训练的渲染设置保持原有行为。

直连 UDP 为默认媒体路径，现有 ICE/TCP、TURN/TLS 443 作为回退。接收端使用浏览器自适应缓冲。“连接诊断”显示每条远端音轨的网络往返、区间丢包、抖动、区间缓冲等待及 ICE 路径。网络往返不等于说话到听见的延迟。

## 验证

使用 Node.js 24、提交的锁文件及本地 PostgreSQL/LiveKit；运行前按 [本地开发说明](local-development.md) 启动数据库并安装服务。

```sh
npm run check
npm run build
npm exec vitest run tests/lobby-stats.test.ts tests/voice-lobby-service.test.ts tests/room-voice-gate.test.ts tests/voice-lobby.integration.test.ts tests/voice.integration.test.ts
npm exec playwright test tests/voice-lobby.e2e.ts
```

真实 SFU 测试分别连接 2、4、10 个客户端，确认默认无发布轨道、同时开麦后每个接收者收到其他成员的 RTP 音频，以及第 11 人并发入场被 SFU 拒绝。还覆盖满员时同账户接管、静音复用轨道、旧 epoch 拒绝和实例清理。浏览器测试覆盖四种视口下的状态条固定高度、面板开关与焦点返回、手机双列布局、收起后持续收听与快捷静音、开麦和收听、远端音频元素移除、导航退出、远征入场拒绝、权限拒绝、播放解锁、延迟票据取消及退出后迟到的麦克风权限。

音频标记测试使用 12 个音调起始点，以源端参考和接收端 AudioWorklet 的输出音频时钟对齐到同一宿主机时间轴，测量浏览器编码、SFU、解码及输出调度。结果写入 `.local/verification/voice-lobby.json`，包括连接分位数、音频标记分位数、ICE 路径和自有 LiveKit 进程负载。该测量不包含真实麦克风、扬声器和外部网络。UI 截图写入 `.local/screenshots/voice-lobby-desktop.png`、`voice-lobby-mobile.png`、`voice-lobby-mobile-panel.png` 及四种尺寸的 `voice-home-*.png`。10 人长昵称、诊断滚动及重连／错误／播放受阻的布局使用控制器快照验证，截图为 `voice-ten-panel-*.png`；双人收听、收起后连接持续和导航退出使用真实 LiveKit 验证。

## 英国与欧洲网络验收

本次本地验收结果见 [本地语音报告](verification/voice-lobby-local.json)：2／4／10 人同时发布均收到完整的其他成员音轨，10 人共验证 90 条接收链路。12 个音频标记的浏览器媒体链路 P50 为 66.65 ms、P95 为 66.74 ms。SDK 连接完成 P95 分别为 419.30／141.70／227.30 ms；这一计时从预热后开始，不包含票据请求和首个可听音频，因此另行保留目标网络上的加入到可播放验收。

在两个客户端到 SFU 的 RTT 均不超过 50 ms、丢包不超过 1%、使用非蓝牙设备时，目标为预热后加入到可播放 P95 不超过 2 秒，真实音频端到端 P50 不超过 150 ms、P95 不超过 250 ms。

真实设备验收使用同一录音时钟同时记录源音频参考和接收设备输出，再对齐已知音频标记。分别测试 Wi-Fi 与移动网络，记录设备、媒体节点地区、网络类型、连接分位数和音频分位数。

对已配置 TURN/TLS 443 的测试 LiveKit，可设置私有环境中的 `LIVEKIT_URL`、`LIVEKIT_PUBLIC_URL`、`LIVEKIT_API_KEY` 和 `LIVEKIT_API_SECRET`，再运行：

```sh
LIVEKIT_TEST_FORCE_RELAY=1 npm exec vitest run tests/voice-lobby.integration.test.ts
```

强制中继测试保留服务器签发的 TURN 凭据，仅允许 `turns:…:443`，并核实选中路径的 `relayProtocol` 为 TLS；ICE candidate 的 `protocol` 和到 TURN 的传输协议分别报告。[统计字段定义](https://www.w3.org/TR/webrtc-stats/#dom-rtcicecandidatestats-relayprotocol)。默认本地 LiveKit 配置没有 TURN/TLS，因此本地直连结果不代表中继或欧洲移动网络验收。
