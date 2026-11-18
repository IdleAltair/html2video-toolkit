# 两台 RTX 5060 Ti 16GB 跑 27B · 视频工程

把 WSL 侧的本地部署素材（deck + 图表 + 数据包）整理成可复用管线的生产工程。
产物是一个自包含的 15 页展示页（`deck/index.html`），录屏后配中文人声出片。

叙事背景、关键数据、已定口径与 15 页页表写在 PLAN.md（给外部评审读的自包含简报），这份 README 只讲怎么跑。

## 目录结构

| 路径 | 内容 |
|---|---|
| `deck/index.html` | 单文件 15 页 deck（瑞士网格版式，零外部依赖，2560×1440 自适应缩放） |
| `deck/DECK-NOTES.md` | 15 页与口播稿小节对照（页型 / 关键数字 / 对应小节） |
| `deck/PLAN.md` | WSL 侧的 deck 重构说明（15 页密排版怎么来的，历史文档） |
| `assets/charts/` | 四张统计图 + 生成脚本 `make_charts.py` |
| `assets/hardware/` | 硬件实拍与官方产品图（`cropped/` 为白底裁剪版） |
| `data/data-pack.md` | 唯一数据源：每个数字带出处，两组速度口径分开列 |
| `narration/口播稿-分页.md` | 按 15 页分节的口播全文（口语化改写），每节标目标时长 |
| `narration/字幕-draft.txt` | TTS 输入草稿：`6s 文本` 行格式，时间码为估算值 |
| `shots/` | 渲染自检截图（p01 / p10 等） |

## 打开 deck

deck 是自包含单文件，双击 `deck/index.html` 用浏览器打开即可（file:// 协议，图片走相对路径 `../assets/...`，目录层级不能动）。

- 纯看：`deck/index.html?noanim`（动画降级，1 帧直切）
- 录屏：`deck/index.html?clean=1`（隐藏鼠标与左下角键位提示条）
- 定位：`?slide=N`（第 N+1 页）、`?fig=N`（钉 rot 轮换帧，0 基）、`?tab=2`（钉 swap 第 2 段，1 基）
- 翻页：→ / Space / PageDown 下页，← / PageUp 上页，G 手动切轮换帧；末页默认停在结论页，按 → 才播退场

## 重建素材

四张统计图（decode 分布 / 长上下文 / 显存账本 / 并发）由脚本生成，改数据后重跑：

    python3 assets/charts/make_charts.py

脚本硬编码 Noto Sans SC 字体路径与输出目录（`assets/charts/`），改图先改脚本里的数据，别手改 PNG。硬件实拍图在 `assets/hardware/`，白底裁剪版在 `assets/hardware/cropped/`，替换同名文件即可。

## 配音

36 句整句合成，BreezeTTS 2，instruction「一字一句，从容不迫，语速放慢，吐字清晰。」，cfg 4，每句抽 3 个 seed。方法论见 `../docs/tts-抽卡.md`，本工程的落地件在 `tts/`：

| 文件 | 作用 |
|---|---|
| `tts/script-v9.json` | 36 句双轨文本：`sub` 进字幕（原文照搬）、`tts` 喂模型（千问 / 毫秒 / 八位整数等读音改写） |
| `tts/dub9.py` | 合成 + 指标（时长 / 字每秒 / 最长空拍）+ 断点续跑，产物落 `tts/clips-v9/` |
| `tts/finish9.py` | 选片 + 拼轨（句间 1.2 s、跨章 3.7 s）+ 出字幕 + 反推 CUES |
| `narration/full.wav` | 整轨 6:28，与 `deck/index.html` 里的 CUES 同源 |

重跑：`python3 dub9.py`（约 40 分钟）→ `python3 finish9.py`。改文案要同时改 `script-v9.json` 的 `sub` 和 `tts`。

## 渲染自检

WSL 侧的无头 Chrome 自检脚本在 `browser-verify/deck-shot-local.mjs`（本工作区：`$WORKSPACE/deepseek-harness/workplace/browser-verify/deck-shot-local.mjs`）：

    cd $WORKSPACE/deepseek-harness/workplace/browser-verify && node deck-shot-local.mjs

逐页截 2560×1440 到 `deck-shots/local/local-pNN.png`，必须输出 `no js errors`，再逐页看一眼有无出画、压字、换行断字。自检通过后再录屏。

## 录制

录的是**纯浏览器画面**：OBS 用「窗口采集」绑 Chrome 的 kiosk 窗口（不是显示器采集），画面里没有鼠标、任务栏和桌面，4K 画布 1:1 输出。字幕与配音都是后期加，不烧进录屏；音轨只在剪辑时当对齐参考。

- 采集：OBS 32.2.2，WebSocket `127.0.0.1:4455`（密码在 `%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json`），3840×2160@60，NVENC，mkv 落 `$OUTPUT_DIR`
- 播放：Chrome kiosk 打开 `deck/index.html?cue=1&wait=1&audio=1&clean=1`，由 WebSocket 在录制开始后调 `window.__startCue()`
- 脚本：`$WORKSPACE/deepseek-harness/workplace/browser-verify/deck-record.mjs`，`node deck-record.mjs probe` 只绑窗口并截一张 OBS 画面核对，`node deck-record.mjs record` 录完整一遍；跑完自动把场景还原、麦克风解除静音
- 成品：`$OUTPUT_DIR\2026-10-18 11-59-40.mkv`，3840×2160@60，H.264 约 2.0 Mbps（简单模式 HQ / NVENC p5），6:39.4，音轨是参考轨（约 −38 dB，只用于对齐）

两个必须知道的坑：

1. **Chrome 被遮挡会停止绘制**。kiosk 窗口被其它窗口完全盖住时，Chrome 的 `CalculateNativeWinOcclusion` 会把合成停掉，OBS 窗口采集就一直录到同一帧（第一版录出来是 6 分钟静止的封面）。起 Chrome 必须带 `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`，并在开始录制后取两帧图比对确认画面在变。
2. **deck 的 cue 到末页就停表**。`cueArm()` 在 `cur >= TOTALN-1` 处直接 return，所以第 15 页的 33 s 停留和退场动画要由录制脚本补：到末页后停 `CUES[14]` 时长再发 `ArrowRight`，再等 9 s 收，否则结尾会缺一整页。

剪辑对轴（cue 起点 = 成片 **1.632 s**，退场 389.5 s 起、约 393 s 全黑。1.632 是录屏音轨与 `full-v9.wav` 互相关量出来的，别按 1.5 估）：

| 页 | 起点（s，相对 cue） | 页 | 起点（s，相对 cue） |
|---|---|---|---|
| 01 | 0.0 | 09 | 178.12 |
| 02 | 32.32 | 10 | 219.80 |
| 03 | 34.82 | 11 | 241.32 |
| 04 | 42.10 | 12 | 243.82 |
| 05 | 76.74 | 13 | 288.22 |
| 06 | 135.94 | 14 | 306.54 |
| 07 | 147.78 | 15 | 355.02 |
| 08 | 150.28 | 结束 | 388.06 |

## 成片

录屏只有画面，配音、配乐、字幕全部后期烧录。成品 `out/local-deploy-27b-4k.mp4`：3840×2160@60、H.264（NVENC p5 / cq 19，约 2.96 Mbps）+ AAC 192k，**6:34.02**，145.9 MB。

三样素材：

| 用途 | 文件 |
|---|---|
| 画面 | `$OUTPUT_DIR\2026-10-18 11-59-40.mkv`（6:39.4，尾部黑场在编码时用 `-t 394` 切掉） |
| 人声 | `tts/full-v9.wav`（388.46 s，整轨已按句落位） |
| 配乐 | `$WORKSPACE\循环歌单_【2_23 AM】_.m4a`（1:01:20 循环歌单，取开头 394 s） |
| 字幕 | `tts/字幕-v9.srt` → 平移 +1.632 s、按句读拆成 185 条 → `tts/字幕-v11.ass` |

三步（中间产物都留在 `out/work/`，可重跑）：

1. **字幕**：直接生成 ASS（PlayRes 2560×1440，Noto Sans SC **86**，深色字 + 半透明白底框，BorderStyle 3，MarginV 70）。**不整句一次性出**：每句在逗号、顿号、冒号处切开，按字数权重把该句时长分给各段，平均一段 1–3 s、最长 23 字，跟着语音一句一句换。中英混排时 ASCII 按 0.55 字计权，纯数字串不会撑爆一行；切完过短的段（<5 字）与前段合并。这套做法照搬 `../arena-effthink/pipeline/mksub.py`（它也是按字数比例落轴、再吸附到气口），只是把「吸附」换成了句内比例分配——我们有逐句时长 `timeline-v9.json`，没有词级时间戳。
2. **混音**：人声 `adelay=1632` + `apad` 到 394 s；配乐 `volume=0.22`（约 −13 dB）、2 s 淡入、7.5 s 淡出、`sidechaincompress`（threshold 0.02 / ratio 8 / attack 15 ms / release 350 ms）跟着人声避让；最后 `loudnorm I=-16:TP=-1.5`，实测整片 **−16.0 LUFS**。
3. **编码**：Windows 版 ffmpeg 8.0（只有它带 NVENC）+ libass 烧字幕，`-t 394` 截尾，`h264_nvenc -preset p5 -rc vbr -cq 19`，约 1.85× 实时（6 分半的片子 3 分半出片）。Linux 静态版没有 NVENC，纯 CPU 编 4K60 要慢一个数量级。

对齐是用互相关验的，不是靠眼估：成片音轨与 `full-v9.wav` 的包络相关在 1.632 s 处 **0.856**（lag 0 / 1.0 / 2.5 处均 ≤0），与录屏参考音轨的同点包络相关 **0.873**，全片 5 s / 100 s / 200 s / 300 s 四处偏移都是 +1.632，没有漂移。

## 与 llm-html2video 工具链的对接

本工程不重写管线，直接复用 `../arena-effthink`（即 `$DESKTOP/screenshot/llm-html2video/arena-effthink/`）的脚本：

| 环节 | 复用脚本 | 说明 |
|---|---|---|
| TTS | BreezeTTS（`../breeze-tts/infer.py` + `../breeze-tts-2` 权重） | `--ref-audio ../laoda-zh-dub/voice-ref/ref_t06_from0.6s.wav --ref-text <ref_text.txt>`，`--lang zh`；输出 24k wav |
| 录屏 | `../arena-effthink/pipeline/record-obs.mjs` | OBS obs-websocket（4455）远程启停，NVENC；本 deck 已带 `?cue=1&wait=1` 时间轴，录屏前调 `window.__startCue()` |
| 气口 | `pipeline/dub.py` | 句间 0.6 s、换页 1.0 s（`GAP` / `PAGE_GAP`） |
| 字幕 | `../arena-effthink/pipeline/compose.py` + `mksub.py` | 按 cues 逐句轴出 ASS，烧进录屏 |

## 数据源三件

改数字只改这里，页面与口播都从它取：

- `data/data-pack.md` — 唯一数据源，每个数带出处；两组速度口径（10-13 NVFP4 档 / 10-17 int8 档）分开列，不合并
- `deck/index.html` — 页面内的数字与脚注 band（每页标来源与口径），与数据包一致性以核对为准
- `PLAN.md` 的 15 页页表 — 页与口播小节的绑定关系，页表是口播稿-分页的分节依据
