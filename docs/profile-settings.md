# 用户头像与资料

在“设置 → 用户设置”点“上传头像”，选择 JPEG、PNG 或 WebP。原图最多 10 MiB、2400 万像素。拖动图片调整方形选区，使用滑杆、滚轮或双指在 1–3 倍之间缩放；方向键也可移动图片。

点“使用此头像”生成压缩预览，再点“保存用户资料”提交。取消裁剪保留之前的头像；保存失败时保留草稿，可直接重试。预设归灯头像和名字头像仍可选。图片加载失败时显示名字首字。已保存资料随账户登录同步。

## 接口与持久化

- `POST /api/profile` 需要账户会话、受信任来源和 JSON。已有头像提交 `{name,image}`；新上传提交 `{name,avatarData}`，两种字段不能同时提交。`avatarData` 为客户端导出的 256×256 JPEG data URL，图片最多 64 KiB；请求体实际读取上限为 96 KiB，其余账户请求保持 32 KiB。
- 服务端用 Sharp 0.35.5 校验图片内容与尺寸，再重编码为质量 82 的 256×256 WebP，移除元数据，最大 64 KiB。客户端 JPEG 质量为 0.85，透明区域填充设置面板底色。
- `0004_profile_avatars.sql` 新增账户外键、唯一素材 ID、内容 SHA256 版本及图片二进制列，每个账户一份。服务启动时沿用现有迁移器应用。头像和用户名通过锁定账户行的数据库事务共同保存；恢复预设或名字头像时删除上传数据。
- `User.image` 保持 URL 字符串。公开读取 `GET /api/avatars/:assetId/:version.webp`，仅匹配当前版本时返回 WebP，使用一年 immutable 缓存；替换图片改变内容版本。账户数据库备份包含头像。
- `/api/auth/update-user` 禁用，资料修改统一走 `/api/profile`。注册入口只接受预设或空头像；资料入口只接受本账户已有的自定义 URL，不接受外部地址或其他账户头像。

裁剪复用 react-easy-crop 6.2.4（MIT），支持桌面、键盘和触摸操作。服务端复用已有 Sharp 版本并将其声明为运行时依赖。

## 验证

使用 Node.js 24 执行 `npm run check`、`npm run build` 和定向 Vitest：`tests/avatar-crop.test.ts`、`tests/profiles.test.ts`、`tests/profile-api.test.ts`。测试使用模拟画布、会话和事务存储，不连接真实数据库或启动浏览器。
