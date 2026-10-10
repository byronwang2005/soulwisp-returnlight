# 自动发布到现有 VPS

`main` 的 CI 成功后，`Deploy production` 自动发布该次 CI 对应的提交。PR 和其他分支不部署。手动运行仅允许当前 `main`，且必须已有该 SHA 的成功 push CI。任务开始及上传前核对 `main`；部署任务串行运行，不取消正在执行的发布。

流程：校验 CI / SHA → 上传仅包含 Git 跟踪文件的源码包 → 校验 SHA-256 → 在服务器构建新镜像 → 暂停新建房与新入房 → 等现有房间清空及结算写入完成 → 数据库备份 → 只替换 app → 检查容器和公网 API 的准确版本 → 保存发布记录。

构建时现有服务继续运行。维护期间现有玩家继续游戏并可恢复原连接；新玩家收到更新提示。房间一直有人时，35 分钟后取消部署并恢复入房。公共语音连接在 app 切换时断开，玩家重新点击加入。单台服务器切换有短暂维护窗口。

使用现有 GitHub Actions、OpenSSH 与 Docker Compose；不新增 npm 包或付费服务。Actions 固定 checkout 的提交版本。权限和并发行为参照 [GitHub 部署文档](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)，应用切换使用 [Compose up 的 wait / no-deps 选项](https://docs.docker.com/reference/cli/docker/compose/up/)。

## 一次性设置

在 GitHub 仓库 Settings → Environments 创建 `production`，限制部署分支为 `main`。自动发布不配置必需人工审核。

Environment variables：

| 名称 | 内容 |
| --- | --- |
| `DEPLOY_HOST` | VPS 主机名或 IPv4，SSH 可达 |
| `DEPLOY_USER` | 已有部署用户，能访问部署目录和 Docker |
| `DEPLOY_PORT` | SSH 端口，默认 `22` |
| `DEPLOY_ROOT` | 现有仓库根目录，默认 `/opt/wangxu`；仅字母、数字、下划线、连字符与斜线 |

Environment secrets：

| 名称 | 内容 |
| --- | --- |
| `DEPLOY_SSH_KEY` | 专用部署私钥，公钥放到服务器该用户的 authorized_keys |
| `DEPLOY_KNOWN_HOSTS` | 从可信管理连接核对过的 SSH 主机公钥行；非 22 端口用 `[host]:port` |

工作流强制验证主机公钥，不在执行时信任临时 `ssh-keyscan` 结果。数据库和 LiveKit 私钥继续只放服务器原有 `deploy/.env`；不上传到 GitHub。部署账户的 Docker 权限等同服务器管理权限，应只用于可信 `main` 发布。

VPS 需要 Bash、Python 3、curl、tar、coreutils timeout、util-linux flock、Docker Engine 和支持 `up --wait` 的 Compose。沿用原有 Compose project 和 `deploy/compose.yaml`，保留数据库、证书、媒体服务和备份卷。基础设施配置变动另行维护，自动流程只更新应用镜像。

首次必须在维护窗口手动更新一次 app，加入内部维护接口；旧服务器缺少该接口时，自动脚本会安全失败，不替换运行中的应用。等待旧房间清空后，按原有手动构建方法发布包含 `deployment.ts` 的版本。确认：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T app \
  node -e 'fetch("http://127.0.0.1:3001/status").then(r=>r.json()).then(console.log)'
```

应返回 `draining:false` 和真实房间数。3001 只在容器 loopback 监听，不添加端口映射或公网代理。配置完成并推送工作流后，在 Actions 查看部署结果；失败在日志中区分等待超时、备份、切换、健康检查和回滚。

## 回滚与恢复

新镜像构建有 15 分钟上限；构建失败不会暂停入房。备份失败或等待超时恢复旧 app 入房。切换失败或公网 `/api/health` 的 `revision` 不匹配时，脚本恢复切换前的准确镜像 ID，重新检查容器健康，Actions 仍标记失败。上一镜像保留为 `soulwisp-app:rollback-<本次SHA>`。不自动恢复数据库。

迁移必须向后兼容上一应用版本。破坏性迁移使用独立维护流程；不能依赖应用镜像回滚撤销数据变更。

成功和回滚后都写入 `deploy/runtime-image.yaml`。后续人工操作 app 时包含该覆盖文件，避免重新使用旧 build 配置：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml -f deploy/runtime-image.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml -f deploy/runtime-image.yaml logs --tail=100 app
```

`deploy/current-revision` 记录最近一次成功发布；公网 health 和运行镜像标签是当前版本的依据。失败后上一成功记录不会改变。备份继续保留每天七份。源码包和回滚镜像不自动删除，定期确认运行及回滚版本后清理旧 releases 与未使用镜像。

正常退出、SSH 挂断和 TERM 会触发恢复处理；主机掉电、SIGKILL 无法执行退出处理。如果维护状态残留，通过容器内部 `POST /resume` 恢复；如果切换中断，先检查 app 的运行镜像和健康状态，再使用保留的上一镜像恢复，核对公网 revision。不要执行 `down -v`。

## 当前验证边界

本地测试覆盖内部监听、维护开关、构建失败、旧服务器拒绝部署、房间未清空、备份失败、切换失败及健康检查失败的回滚。发布脚本测试使用模拟 Docker 命令；GitHub production 环境已配置两项 SSH secrets、四项服务器 variables 及 main 分支限制；服务器已完成首次维护接口更新。真实自动发布结果在 [Deploy production](https://github.com/byronwang2005/soulwisp-returnlight/actions/workflows/deploy.yml) 查看。受控失败回滚仍需单独实测。
