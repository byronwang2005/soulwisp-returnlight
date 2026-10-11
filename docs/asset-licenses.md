# 运行资产与许可

头像裁剪使用 react-easy-crop 6.2.4（MIT）；服务端图片校验和压缩复用 Sharp 0.35.5（Apache-2.0）。两者声明为对应工作区的运行依赖，许可随运行包保存。

仓库内素材采购支出 **0 元**。角色和地牢物件直接使用 Kay Lousberg 官方 KayKit 免费资源，许可为 **CC0-1.0**，支持商业使用与修改。原始许可文件随运行资产保存：

- [角色包原许可](../apps/web/public/assets/characters/LICENSE.txt)
- [地牢包原许可](../apps/web/public/assets/dungeon/LICENSE.txt)
- [逐文件来源、固定提交、SHA256与动画清单](../apps/web/public/assets/manifest.json)

运行模型共10个文件，包含5个人物、2个箱体、完整墙、断墙与柱体；原始模型保存在 `design/art/models/`，发布目录只包含实际使用的派生模型和许可。安装时不依赖第三方网站实时提供模型，文件随本地与服务器构建发布。

工程新增的环形提示、亡絮粒子、灯柱效果和界面由代码绘制；挥剑与命中音由原创程序离线合成，其余战斗、碰撞、采集与完成音效由 Web Audio 合成，没有采样第三方录音。

场景BGM共19首，均为项目原创程序化编曲，采购支出0元。竖琴、钟琴、弦乐、低音和鼓点离线渲染为立体声MP3，运行时直接播放；不引用第三方录音。各曲的标题、时长、SHA256与响度见[音乐清单](../apps/web/public/audio/manifest.json)，音频与许可随构建发布。确定性编曲源码为`scripts/generate-music.py`，重新生成需Python、numpy和ffmpeg；音频采用[CC0-1.0](../apps/web/public/audio/LICENSE.txt)。播放器复用MIT许可的[Howler](https://github.com/goldfire/howler.js)，完整许可已加入第三方声明。

开源软件沿用各自许可。依赖版本和包来源记录在根目录`package-lock.json`；[依赖许可索引](dependency-licenses.json)按锁文件生成。执行`npm ci`安装时同时取得相应包的完整许可证。PostgreSQL、LiveKit及Caddy的服务器分发使用各自官方发行版，部署时保留镜像内许可证。

## 大厅提示与脚步

大厅四种提示、挥剑与命中音为原创离线合成；脚步复用 [Kenney Impact Sounds 1.0](https://kenney.nl/assets/impact-sounds) 的五个硬地录音和 [TinyWorlds 的碎石素材](https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud)，均为 CC0-1.0。处理后的 WAV 自托管，源归档哈希、处理方法和逐文件响度见[音效清单](../apps/web/public/audio/sfx/manifest.json)，原许可见[音效许可](../apps/web/public/audio/sfx/LICENSE.txt)。采购成本 0 元，重生成与试听见[音频反馈](audio-feedback.md)。

## 古铜主题与古体字体

Source Serif 4、Source Sans 3、Noto Serif SC和Noto Sans SC通过锁定版本的Fontsource包自托管，均为OFL-1.1，采购成本0元。按钮使用morphicons（MIT）与lucide（ISC），许可已加入运行包。潘通876 C只作为古铜材质方向参考；实际屏幕色值与字体职责见[场景与界面](presentation.md)。

## 风格化古铜材质与运行裁剪

七类 imagegen 原创材质为广场石板、道路石块、石基砌石、氧化铜、旧木、粗织布与皮革。源图、完整提示词与古铜屏幕配色记录在 [美术源目录](../design/art/README.md)。原图实际为 1254 × 1254；广场和道路的 2K 颜色输出由原图重采样，其余颜色不超过 1K。ARM 与 OpenGL 法线从同一周期材质遮罩离线生成，使用 WebP 输出。共37张运行贴图，约18.88 MiB，无运行时外站请求。原始 Poly Haven 地面清单作为历史来源留存在 `design/art/sources/`，旧 JPG 不再发布。

[材质清单](../apps/web/public/assets/materials/manifest.json)记录来源、提示词、源图与输出 SHA256。项目将生成材质按 [CC0-1.0](../apps/web/public/assets/materials/LICENSE.txt) 分发。PANTONE 876 C 作为古铜方向参考；屏幕使用 `#b58a58`、`#9ab7a5`、`#efe4ce`、`#171512` 和 `#777566`。

运行 GLB 使用固定版本的 glTF Transform 4.4.0（MIT）裁剪，保留41个骨骼节点、十种实际动作及职业使用装备；Sharp 0.35.5（Apache-2.0）生成缩小的调色板和材质档位。开发工具许可在 [licenses](../design/art/licenses/) 中，依赖版本与许可随锁文件记录。10个运行模型从17.59 MiB缩至3.21 MiB，原始来源与派生哈希分别保存；恢复命令见美术源目录。

铺装布尔运算复用已引入的 polygon-clipping 0.15.7（MIT）；以整数输入合并房间和道路，保留外边界及孔洞，避免浮点交汇误差。设施与附件复用 Three.js 几何并按材质合批；外围复用 KayKit 地牢的完整墙、断墙与柱体。

`npm run assets:check`校验运行文件、源文件、尺寸、哈希、CC0许可、身体尺度、动作及运行依赖完整许可。离线图与体积、面数、纹理内存估算见 [本轮验收](verification/art-refresh.md)。
