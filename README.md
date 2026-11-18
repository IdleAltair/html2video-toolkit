# html2video-toolkit

把「本地大模型生成的动态 HTML 页面」做成展示视频的一套可复用工具链：

> 页面模板 → 浏览器/桌面录屏 → 剪辑 → TTS 配音抽卡 → 字幕与混音 → 成片

所有脚本都来自实际发布过的 B 站项目，经过脱敏整理；示例工程在 `examples/` 下可以直接作为模板参考。

## 目录

| 路径 | 内容 |
|---|---|
| `tools/clip/` | 剪辑管线：`build.mjs`（重建页面）、`cut.mjs`（按剪辑表裁片）、`check.mjs`（全量体检）、`cuts.json`（剪辑表）、`music_p5r_*.mjs`（混音变体） |
| `tools/tts/breeze-setup/` | BreezeTTS 部署与冒烟脚本（install_env / dl_ms / verify_ckpt / smoke / api_test / run_check） |
| `tools/tts/laoda-voice/` | 配音抽卡与拼接脚本（dub_all / api_patched / ab-track / audit / breeze-* 等） |
| `tools/record/` | 录制编排：`record-4k.mjs` / `record-obs.mjs` / `record-deck.mjs`，以及 win-side 的排程/挖掘脚本 |
| `tools/subtitle/` | 字幕与同步：`mksub.py`、`syncsecs.py`、`speakcheck.py`、`mkreplay.py` |
| `tools/fonts/` | 字体子集化 `subset-fonts.py` |
| `tools/pages/` | 展示页模板（`p_top / p_style / p_mid / p_script / p_end` 五件套） |
| `docs/tts-抽卡.md` | TTS 抽卡方法论：参数作用、选片判据、拼轨对轴、已证伪路线 |
| `docs/design-language-*.md` | 7 套设计语言方案说明（远岸 / 蓝图 / 瑞士网格 / 磷光 / 浮世绘 / 合成波 / 白盒） |
| `assets/voice-ref/` | 开源参考音源（来源与许可见 `SOURCE.md`） |
| `examples/p3r/` | 实际项目：P3R 配色展示页 + 数据事实卡 + 中文口播（27 页 / 387s） |
| `examples/effthink/` | 实际项目：AI 对局战报（含 p2 分册管线） |
| `examples/presentation-v1/v2/v3/` | 三代表情页实验（v2 五件套模板、v3 构成主义封面） |
| `examples/design-samples/` | 7 套设计语言的单文件页面模板（同一份内容横向选型，可直接录屏） |
| `examples/local-deploy-27b/` | 两台 RTX 5060 Ti 16GB 跑 27B 的 15 页 deck、硬件配置页与口播稿 |

> 示例工程只包含页面源码、构建脚本与数据；图片/音频/视频素材未随仓库提供（清单见 `manifests/images.md`）。直接打开 `index.html` 可以看结构与交互，缺素材的位置会显示占位或空白，按清单自行准备即可。

## 环境变量约定

原始脚本在本机是用绝对路径跑通的，公开版把本机路径替换成了占位符，使用前请按自己的目录替换（或在 shell 里 export）：

| 占位符 | 含义 |
|---|---|
| `$PROJECT_ROOT` | 本仓库/项目根目录 |
| `$WORKSPACE` | 其他并行工程的工作区 |
| `$TMP` | 临时目录 |
| `$OUTPUT_DIR` | 成片输出目录 |
| `$DESKTOP` / `$HOME` | 桌面 / 用户目录 |
| `$AVATAR_DIR` | 头像素材目录 |
| `$PBZ_DIR` / `$STEAM` | 游戏安装目录（示例项目用） |

## 依赖

- Node.js 20+（`.mjs` 脚本）
- ffmpeg / ffprobe（`bin/` 未包含二进制，自行安装或用系统包）
- Python 3.10+（字体子集、同步工具；部分脚本依赖 Pillow / numpy）
- 录制：Chrome（CDP）或 OBS（websocket）
- 配音：BreezeTTS 2（Linux/WSL，权重需自行从 ModelScope 获取，见 `tools/tts/breeze-setup/`）

## 快速开始

```bash
# 1) 看示例：直接用浏览器打开
#    examples/presentation-v2/index.html
#    examples/p3r/index.html

# 2) 重建展示页
node tools/clip/build.mjs

# 3) 按剪辑表裁一段
node tools/clip/cut.mjs --list
node tools/clip/cut.mjs <clip-name>

# 4) 全量体检
node tools/clip/check.mjs
```

## 许可

代码与音源均以 MIT 许可发布，见 `LICENSE` 与 `assets/voice-ref/SOURCE.md`。

第三方模型（BreezeTTS / IndexTTS 等）不在本仓库内，请按其自身许可获取与使用。
