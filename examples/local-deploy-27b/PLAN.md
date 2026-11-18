# local-deploy-27b 视频规划

一句话主题：**两台 16GB 消费卡（RTX 5060 Ti）把 27B 稠密模型跑成日常 agent 后端，代价与取舍。** 代价是每步跨卡同步吃 14% 的 decode 时间、单流占满显存池后第二条请求只能排队；取舍是在「单流最长上下文」与「双路并发」之间选了前者。

## 背景（给没看过前情的人）

**硬件**（2026-10-17 实机核对，PowerShell CIM + nvidia-smi）：

- CPU Intel Core Ultra 5 245K（带核显），14 核 / 14 线程；主板铭瑄 MS-iCraft Z890 Pacific
- 显卡 2× NVIDIA RTX 5060 Ti 16GB（索泰月影三风扇 / 星夜双风扇），单卡 PCIe 5.0 ×8、显存带宽 448 GB/s、功耗上限 180W，驱动 596.49
- 内存 2×16GB DDR5（一条 4800 + 一条 5600 混速，双通道，实际频率预期 4800，未实测）
- 电源爱国者 EV850 850W 白金全模组；机箱长城隐刃 H600 全塔 7 风扇正压；散热利民 PA120 SE 双塔；磁盘 KIOXIA EXCERIA PLUS G3 2TB×2（NVMe PCIe 4.0）
- 系统 Windows 11 25H2 + WSL2 Ubuntu（WSL 内 CUDA 13.1）

**模型**：Qwen3.8-27B coder390，W4A4-W8A8 量化，权重 20.8 GiB，稠密 27B（非 MoE）。KV 用 int8，上下文 219,776，视觉开启（视觉塔钉卡 0，14 个预处理 worker）。

**引擎**：capy-flash（原 ninfer-tp2，ValerioDolci 社区双卡分支）——不是官方上游，是把上游 ninfer 的 v3 容器底座接上双卡张量并行、视觉和 dflash2 的改版。跑在 WSL2 的 Ubuntu 里，跨卡 all-reduce 走 pinned-host mailbox（两卡无 P2P）。

**两个重点的次序**：第一是硬件与显存账（能不能跑、跑多凉快），第二才是速度与坑（跑多快、踩过什么）。

## 关键数据

速度（当前档 W4A4/W8A8 + int8 KV + 219,776，10-17 运行日志，n=130 真实 agent 请求，awk 统计，窗口 11:10–13:03，非受控基准）：

| 维度 | 数字 |
|---|---|
| decode 中位 / p90 | 99.9 / 131.1 tok/s（min 71.4 · mean 105.3 · max 176.8） |
| TTFT 中位 / 最大 | 337 ms / 971 ms |
| prefill | 大 prompt 2.10k–2.73k tok/s（16,534–32,593 tok 级）；短 prompt 300–670 tok/s |
| 长上下文 58,863 | 首次 TTFT 28.0 s（prefill 2.10k），decode 155.4 tok/s（accept 61.5%） |
| 长上下文 150,459 | 首次 102.3 s（1.47k），decode 125.5 tok/s（accept 58.6%） |
| prefix 100% 命中 | TTFT 163 / 261 ms，总耗时 610 / 658 ms |
| dflash2 接受率（K=7） | 25.6%–69.0%，多数 31%–61%（prefix 高命中时 60%+） |

并发（10-13 默认档 NVFP4 + nvfp4 KV + 163,840 实测，与上表不可直接比，见已定口径 1）：

| 并发 | 总吞吐 | 备注 |
|---|---|---|
| 1 | 89.5 tok/s | 单流基线 |
| 2 | 166.9 tok/s（每流 83.5，1.87×） | 本机采用，wide slot 160 KiB |
| 4 | 167.3 tok/s（每流 41.8） | 出现 4.9 s 排队，故不采用 |

显存与 P2P（当前实例启动日志 2026-10-17 + 实机测量）：

| 维度 | 数字 |
|---|---|
| int8 KV 容量 | 219,776 tokens（pages 3,434/6,868） |
| nvfp4 双流档 | CAP 393,216 / 每路 CTX 196,608（池近 400K，双流跑满不排队） |
| 每卡显存 | 14.79 GiB = 权重 10.40 + KV/runtime 4.33 + graphs 0.06（两卡基本一样，任务管理器 15,154 / 15,207 MiB） |
| P2P 上限 | 1.16×：decode 一步 42.8 ms，跨卡 128 次 × 47 µs ≈ 6.0 ms = 14%，现实区间 1.10–1.17× |
| 维修补丁 | 83 行两笔提交 59de3c1 / 969d570，修复后 30 请求 0 降级，decode 44 → 89.5 tok/s |

## 已定口径

1. **两组 tok/s 口径不可直接比**：10-13 默认档（NVFP4 权重 + nvfp4 KV + 163,840）与 10-17 当前档（W4A4/W8A8 + int8 KV + 219,776）权重、KV、上下文三处都不同；并发 89.5 / 166.9 / 167.3 只属于 NVFP4 档。10-14 的日志又跑了 merged-v3 的 int8 219,776 档（decode 81.6 / 113–118），数据包里仍叫它「默认档」——按日期区分引用，不合并。
2. **显存按双口径说明**：启动日志给 KV/runtime 4.33 GiB 与 free 136.0 MiB 原文账目（日志未逐项归属，不按 16 GiB 加总）；任务管理器给 15,154 / 15,207 MiB 实际占用。画面与口播同时呈现两条，不互相换算。
3. **温度/功耗是推理时实测**（2026-10-17 夜，2000 token 生成，Windows 侧 nvidia-smi 采样 + 米家插座）：整机 480W 上下波动，双卡占用 95–98% / 94–97%，温度 46–47℃ / 52–53℃，nvidia-smi 采样单卡约 130 W（双卡合计 260 W 上下）。口播稿正文里更早的「56℃ / 58℃、占用 98% / 58%、14.9 GB」是采样瞬间的巧合，已作废不再使用。
4. **两张卡占用基本一致**：14.79 GiB 是每卡口径，不是两卡合计；host-mapped 1.18 GiB 在主机内存，不占显存。
5. 长上下文 58k / 150k 的数字来自 10-13 默认档（NVFP4 + 163,840），不是当前档的受控基准——画面脚注写明，口播不把它们读成当前档成绩。
6. 全片只讲本机硬件与本机实测；two-gpu.md 里的双 5070 Ti / 5090 对照属他人硬件，不进画面。

## 15 页页表

每页一个主视觉，主视觉即页型（表 / 图轮换 / 指标 / 实录 / 结论）：

| # | 页 | 内容 | 主视觉 |
|---|---|---|---|
| 1 | 封面 | 两台 5060 Ti 16GB 跑 27B；stats：2 卡 / 27B / 219,776 tok / 99.9 tok/s | 大字 + 统计带 |
| 2 | 章节 01 | 硬件、功耗与模型 | 章节页 |
| 3 | 硬件清单 | 9 行（CPU / 主板 / 显卡 / 内存 / 电源 / 机箱 / 散热 / 磁盘 / 系统），10-17 实机核对 | 表 |
| 4 | 选型逻辑 | 先定卡再配整机；1、3 槽直连 CPU 拆双 PCIe 5.0 ×8；CPU 必须带核显 | 图轮换（双卡产品图 → 机箱内部实拍，6s/帧） |
| 5 | 配套三件 | EV850 850W（满载 360W、插座实测 480W）/ H600 七风扇正压 / PA120 SE；推理时 46–47℃ / 52–53℃ | 图轮换（H600 白底 → PA120 SE 白底 → 双卡位置实拍 → 米家插座读数，4 帧） |
| 6 | 模型参数 | 6 行：W4A4/W8A8、20.8 GiB、每卡 10.4 GiB、int8 KV、219,776、视觉 | 表 |
| 7 | 章节 02 | 框架与速度 | 章节页 |
| 8 | 关键开关 | 9 行：tp2 / mailbox / dflash2 / CUDA graphs / prefill 1024 / vision / 并发 2 / 219776 | 表 |
| 9 | P2P 上限 | 1.16× 上限：一步 42.8 ms、128×47 µs ≈ 6.0 ms = 14%、现实 1.10–1.17× | 指标（巨数 1.16×） |
| 10 | 速度数字 | decode 表 6 行 + decode-dist 小图 + 三数字块（58k 28.0 s / 150k 102.3 s / prefix 163 ms） | 表 + 小图 |
| 11 | 章节 03 | 显存、坑与结论 | 章节页 |
| 12 | 显存账本 | 7 行 + embedding-host（1.185 GiB，144,448 vs 219,776）+ 双流档（393,216 / 196,608），swap 两段先后显示（?tab=2 钉第二段） | 表 |
| 13 | 显存账本图 | 每卡 14.79 GiB（权重 10.40 + KV/runtime 4.33 + graphs 0.06），两卡基本一样；任务管理器 15,154 / 15,207 MiB | 图（vram-budget） |
| 14 | mailbox 死锁 | 两 rank 互等 → kPeerSpinLimit 降级 → 83 行补丁 59de3c1 / 969d570 → 30 请求 0 降级 | 实录 |
| 15 | 结论 | 三条取舍 + 三件下一步 + colophon | 结论 |

## 出片方式

先录 2560×1440 屏幕，复用 `../arena-effthink` 的工具链，不重写管线：

- **录屏**：参考 `../arena-effthink/pipeline/record-obs.mjs`，走 OBS 的 obs-websocket（127.0.0.1:4455）远程开始/停止录制，NVENC 硬编；Chrome `--kiosk` 全屏 + `--mute-audio`。本 deck 已内置 cues 时间轴：开 `index.html?cue=1&wait=1&clean=1`（挂起），确认开录后调 `window.__startCue()` 开始自动翻页；`window.__cueState()` 查当前页与剩余，`window.__stopCue()` 停，`?cuerate=N` 可整体加速做彩排。每页时长写在 `deck/index.html` 的 `CUES` 数组（当前是按口播稿估算，TTS 出实测后覆盖）。
- **气口**：句间 0.6 s、换页 1.0 s（`../arena-effthink/pipeline/dub.py` 的 `GAP` / `PAGE_GAP` 口径）。
- **合成**：`../arena-effthink/pipeline/compose.py` 把音轨与 ASS 字幕烧进录屏（字幕由 cues 逐句轴出，几何 PlayRes 2560×1440）。
- **deck 录屏参数**：`?clean=1` 隐藏鼠标与左下角键位提示条；`?noanim` 降级（落版 1 帧直切、数据条直显终值）；`?slide=N` 定位第 N+1 页；`?fig=N` 钉 rot 轮换页第 N+1 帧（0 基，TTS 对齐用）；`?tab=2` 钉 swap 页第 2 段。末页默认停在结论页，按 → / Space 才播退场（`?autoexit=1` 恢复自动退场）。

## 还没做的

- 口播稿逐句时间轴：15 页分页口播与估算时间码已写在 `narration/`；BreezeTTS 出音频后用实测时长覆盖 deck 的 `CUES` 数组与 `narration/字幕-draft.txt` 的草稿时间码。
- TTS：已定 BreezeTTS。参考音频用 `../laoda-zh-dub/voice-ref/ref_t06_from0.6s.wav` 与其 `ref_text.txt`，权重 `../breeze-tts-2`，推理 `../breeze-tts/infer.py`；逐句产出后按实测时长回填 cues。
- 功耗图、温度图待补：口播稿 §功耗、温度与模型 还是占位，deck p05 目前用米家插座读数顶，待数据出来补图。
- ninfer 上游 PR 待验证后提交：mailbox 死锁补丁 `59de3c1` / `969d570` 目前只在本机。
- 封面与片尾的总时长占位还是 `00:00:00`，TTS 出来后再填。

## 可以自行核对的本地文件

- `data/data-pack.md` — 唯一数据源，每个数带出处（2026-10-17）
- `deck/index.html` — 单文件 deck，数字取自数据包与实机核对，不自造；页脚 band 每页标来源与口径
- `deck/DECK-NOTES.md` — 15 页与口播稿小节对照（页型 / 关键数字 / 对应小节）
- `narration/口播稿-分页.md` 与 `narration/字幕-draft.txt` — 分页口播与 TTS 前的估算时间码
- `assets/charts/make_charts.py` — 四张统计图的生成脚本（decode-dist / long-context / vram-budget / concurrency）
