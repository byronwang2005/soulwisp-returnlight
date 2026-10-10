# 单台 Linux VPS 迁移

本地四人优先，再逐档完成并验收4–10人；本目录在所有本地档位通过后使用。本机不要求Docker；生产模板在Ubuntu24.04使用Docker Engine与Compose。当前正式入口为[亡絮：归灯](https://gaming.byron.wang)。已完成容器上线、HTTPS / WSS、完整数据库迁移、十客户端强制TURN/TLS音频、备份空库恢复与本机导出；具体版本、时间和内容校验见[公网部署验收](../docs/verification/deployment-public.json)。七档正常时长完整对局、账户结算及服务器采样见[开发状态](../docs/development-status.md)。

## 域名与服务

需要一台有公网IPv4的Linux服务器、一个域名、Docker Engine和Compose插件。DNS将根域、`game`、`voice`、`turn`四条A记录指向同一服务器。媒体子域使用DNS直连；若域名在Cloudflare，`voice` / `turn`设为DNS only。首版不需要Pages、Redis或额外付费语音服务。

| 入口 | 用途 |
| --- | --- |
| `https://你的域名` | 静态前端，`/api/*`同源代理账户服务 |
| `wss://game.你的域名` | Colyseus websocket，HTTPS入房接口 |
| `wss://voice.你的域名` | LiveKit信令 |
| `turns:turn.你的域名:443` | UDP受限时的TURN/TLS中继 |

Linux中LiveKit和Caddy使用host网络；应用端口只发布到127.0.0.1，PostgreSQL不发布端口。不要把此host网络模板当作Mac Docker网络教程。

app通过Docker的host-gateway访问LiveKit API7880。Compose私有桥接口固定为`wangxu0`；宿主防火墙仅允许该接口到7880，不向公网开放该端口。可从app容器请求`http://host.docker.internal:7880`核对内部可达性。

## 配置与启动

仓库放在例如`/opt/wangxu`。首次准备：

```sh
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

新Ubuntu24.04服务器可先执行`sh deploy/bootstrap.sh`。它使用Docker官方APT仓库安装Engine / Compose，先放行22再启用防火墙，开放下表端口，并允许私有桥访问LiveKit API。脚本不删除已有数据、不启动应用。[Docker官方安装](https://docs.docker.com/engine/install/ubuntu/)

编辑`deploy/.env`：填写DOMAIN和PUBLIC_IP，将三个secret替换为各自独立的64位十六进制值（`openssl rand -hex 32`）；LiveKit key保留为无空格标识即可。变量只进入服务端，前端构建只接收公开`VITE_GAME_URL`。应用Dockerfile仅复制应用 / packages，私有部署配置与备份不会复制入应用镜像。

配置生成使用Node24内置模块，无需在VPS安装npm依赖。可在已装Node24的本机生成，或在VPS用容器：

```sh
docker run --rm -v "$PWD/deploy:/config" node:24.19.0-bookworm-slim node /config/render.mjs /config/.env
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml build
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail=100 app livekit caddy backup
```

`render.mjs`生成私有`livekit.yaml`与`caddy.json`，两者权限0600。Caddy镜像增加固定commit的[caddy-l4](https://github.com/mholt/caddy-l4)。TCP443使用插件原生listener wrapper：只按TLS SNI截获TURN并交给内部5349；其余连接进入同一监听器的HTTPS处理，保留真实客户端地址、同源cookie与WSS。TURN分支终止TLS并发送PROXY v2；LiveKit配置`external_tls`和可信loopback代理，使Firefox也能得到正确客户端地址。普通官方Caddy镜像没有L4模块，不能直接替代本目录Caddy构建。

DNS正确、TCP80/443可达后，Caddy申请并续期四个域名证书；证书卷保留。数据库健康后应用执行已提交SQL迁移，API readiness通过后启动代理。迁移或启动报错时应用不会假装就绪，先检查日志再重启。

## 防火墙

同时检查服务器厂商安全组和系统防火墙：

| 公网端口 | 协议 | 内容 |
| --- | --- | --- |
| 22 | TCP | SSH管理，建议仅管理来源 |
| 80 | TCP | ACME HTTP验证与HTTPS跳转 |
| 443 | TCP | 网站 / WSS / TURN/TLS，共用SNI分流 |
| 7881 | TCP | 直接ICE/TCP，不经过HTTP反代 |
| 3478 | UDP | 嵌入TURN/UDP与STUN |
| 50000–50100 | UDP | LiveKit SFU媒体端口 |
| 50101–50200 | UDP | 配置中的TURN relay端口 |

不开放数据库5432、应用3000/2567、LiveKit API7880或内部明文TURN5349。模板禁用HTTP3，因此不需要为Caddy开UDP443。Docker发布的应用端口绑定127.0.0.1，数据库不发布端口；这些约束同时保留，避免Docker发布端口绕过UFW。服务器出站需允许DNS、证书申请和相关媒体流量。[官方LiveKit端口](https://docs.livekit.io/transport/self-hosting/ports-firewall/)、[官方Caddy L4部署例子](https://github.com/livekit/deploy/blob/main/generate/templates/caddy.go)

## 本机数据迁入

先停止新开局，等活动局完成并入库；进行中房间不支持跨服务重启恢复。用本机`npm run backup`导出custom dump，安全复制至服务器。第一次目标数据库必须为空：可先只启动db，在应用启动迁移前导入本机完整dump。不要先让app建表再把完整dump覆盖进去。

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d db
docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T db pg_restore -U wangxu -d wangxu --exit-on-error --single-transaction --no-owner < /安全路径/local.dump
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
```

只有全新、未供app使用的空目标`wangxu`才使用上述首次导入命令。已有云数据时先恢复到新库验证，保留旧库；不要运行`down -v`，它会删除数据卷。

导入后比较完整十张表的行数和内容摘要：auth_user、auth_session、auth_account、auth_verification、camps、camp_requests、matches、match_rewards、redeemed_loot、wangxu_migrations。比较应使用只读一致性快照，统一UTC时区，按`to_jsonb(t)::text COLLATE "C"`排序，避免本机与容器的时区或locale差异产生假不一致。另核对营地余额、camps.presets以及matches.map_seed / player_count，再登录检查外观 / 研究 / 当前配装 / 账户预设。需要继续既有登录会话时保留旧AUTH_SECRET；更换时既有用户重新登录。测试账号是否迁移由实际用途决定，不从有效账户余额随意扣除。

## 每日备份、导出与空库恢复

backup服务启动即备份一次，此后每86400秒一份UTC日文件；同日重启只替换当天文件，始终保留最近7份成功日备份。pg_dump使用custom格式，归档检查成功后才替换和轮换；失败保留原文件并60秒后重试。文件位于宿主机`deploy/backups/`，权限0600。

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T backup sh /scripts/backup.sh
ls -lh deploy/backups
```

从本机导出一份服务器备份，保存于私有本机目录：

```sh
mkdir -p .local/backups
scp 你的SSH用户@服务器:/opt/wangxu/deploy/backups/wangxu-YYYY-MM-DD.dump .local/backups/
```

每日七份是在同机上应对误操作的恢复点；上述导出让备份在服务器丢失后仍可使用。配置secret另外保存在私人密码存储中，数据库dump不包含这些环境配置。

恢复演练创建不同名字的空库，脚本拒绝活动库和非空目标：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T db createdb -U wangxu wangxu_restorecheck
sh deploy/restore.sh deploy/backups/wangxu-YYYY-MM-DD.dump wangxu_restorecheck
docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T db psql -U wangxu -d wangxu_restorecheck -c 'SELECT count(*) FROM camps; SELECT count(*) FROM matches; SELECT count(*) FROM match_rewards;'
docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T db dropdb -U wangxu wangxu_restorecheck
```

## 故障与公网验收

进程退出由restart策略恢复；仅unhealthy不自动重启。检查`ps`、服务日志与`https://域名/api/health`，修正问题后明确重启。数据库卷、备份目录和Caddy证书卷不随应用更新删除。应用重启会丢当前内存房间，应在维护窗进行；已提交账户 / 结算不丢。

公网最小验收为一个十人房完整一局、各档人数正常开局 / 入库、两种真实网络、麦克风允许 / 拒绝、发言轮与回响权限、关房后旧token拒绝、60秒重连及长断线无效。至少一次强制WebRTC relay验证TURN/TLS连接，而不是只看WSS成功；另测停止 / 重启、每日备份和新库恢复。记录实际CPU、内存、tick漂移和媒体流量，再决定服务器是否够用。

Pages之后仅替换静态托管；API跨域cookie / CORS与公开地址需要另外配置，当前同源默认模板不能直接照搬。运行结构见[架构](../docs/architecture.md)。
