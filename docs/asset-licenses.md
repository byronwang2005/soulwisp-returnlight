# 运行资产与许可

本轮素材采购支出 **0 元**。角色和地牢物件直接使用 Kay Lousberg 官方 KayKit 免费资源，许可为 **CC0-1.0**，支持商业使用与修改。原始许可文件随运行资产保存：

- [角色包原许可](../apps/web/public/assets/characters/LICENSE.txt)
- [地牢包原许可](../apps/web/public/assets/dungeon/LICENSE.txt)
- [逐文件来源、固定提交、SHA256与动画清单](../apps/web/public/assets/manifest.json)

共16个文件，包含5个人物模型、9个场景物件与2份许可文件。安装时不依赖第三方网站实时提供模型，文件随本地与服务器构建发布。

工程新增的环形提示、亡絮粒子、灯柱效果和界面由代码绘制；战斗、碰撞、采集与完成音效由Web Audio合成，没有采样第三方录音。系统字体由玩家设备提供。

场景BGM共19首，均为项目原创程序化编曲，采购支出0元。竖琴、钟琴、弦乐、低音和鼓点离线渲染为立体声MP3，运行时直接播放；不引用第三方录音。各曲的标题、时长、SHA256与响度见[音乐清单](../apps/web/public/audio/manifest.json)，音频与许可随构建发布。确定性编曲源码为`scripts/generate-music.py`，重新生成需Python、numpy和ffmpeg；音频采用[CC0-1.0](../apps/web/public/audio/LICENSE.txt)。播放器复用MIT许可的[Howler](https://github.com/goldfire/howler.js)，完整许可已加入第三方声明。

开源软件沿用各自许可。依赖版本和包来源记录在根目录`package-lock.json`；[依赖许可索引](dependency-licenses.json)按锁文件生成。执行`npm ci`安装时同时取得相应包的完整许可证。PostgreSQL、LiveKit及Caddy的服务器分发使用各自官方发行版，部署时保留镜像内许可证。

## 古铜主题与古体字体

Source Serif 4、Source Sans 3、Noto Serif SC和Noto Sans SC通过锁定版本的Fontsource包自托管，均为OFL-1.1，采购成本0元。按钮复用CCC同版本的morphicons（MIT）与lucide（ISC），许可已加入运行包。潘通876 C只作为古铜材质方向参考；实际屏幕色值与字体职责见[视觉系统](visual-system.md)。
