# Deck 重构说明（v3 · 15 页密排版）

目标：把现有的 20 页「图多字少」改成「按 `article-draft.md` 七章的密排版」，并把图片缩小、同一页内可轮换。

## 硬约束

- 文件：`$WORKSPACE/deepseek-harness/workplace/local-deploy-share/deck/index.html`（02 swiss-grid 单文件模板，直接改这个文件）
- 渲染自检：`cd $WORKSPACE/deepseek-harness/workplace/browser-verify && node deck-shot-local.mjs`，输出 `deck-shots/local/local-pNN.png`，必须 `no js errors`，逐页看一眼不能有出画、压字、换行断字。
- 2560×1440；内容区 2368 宽（12 栏 × 200 步距）、正文区高 1040。
- 字号下限 24px。密排页正文 26–28px，表头 24px，图注 22px 以下禁止。
- 每页保留页脚 `band`（来源/口径两行）+ `legend`。
- 章节页签名不动（页码 05/21 这种自动算）。

## 新增能力：同页图片轮换

页面类型 `figure` 的 `figs` 允许 2–3 张，加 `rot:{ms:6000}` 表示同一图位按 `ms` 自动切换：

- 图位尺寸固定，图片 `object-fit:contain`，白底 `#fff`，不变形。
- 切换用 300ms 淡入淡出，不重新入场。
- 只有当前激活页在轮换；翻页时复位到第 1 帧；翻回来重新计时。
- 深链 `?fig=2` 可钉住第 3 帧（截图/TTS 对齐用）。
- 图注跟着帧切换，字号 24px。
- 键盘 `G` 手动切下一帧（备用；不要占用既有键位 → 无冲突即可）。

## 新增能力：密排表格页

新页型 `{type:"table", kick, title, cols:[...], rows:[[...]], widths:[n,n,n], note, band, legend}`：

- 三列栅格：`widths` 是 12 栏里的栏数，默认按 3/6/3。
- 行间毛发线，行高按内容自适应；表头小写字号 24px + 灰色。
- 8–10 行必须在正文区内不溢出；数值列右对齐、等宽数字。
- 第一列可放序号或项目名，重点行可用红色实心点标记（沿用现有 `.dot rd`）。

## 页面结构（15 页，按口播稿七章合并）

合并原则：章节分隔页只留 4 个（硬件与模型 / 框架与速度 / 显存·坑·结论），原来一页一图的拆页合并成「表 + 小图 + 数字块」的密排版。

| # | 类型 | 内容 |
|---|---|---|
| 1 | cover | 标题「两台 5060 Ti 16GB 跑 27B」；lede 一句话；stats 四格：2 卡 / 27B / 219,776 tok / 99.9 tok/s；TOC 四章 |
| 2 | divider | SECTION 01 · 硬件、功耗与模型 |
| 3 | table | 硬件清单 9 行 3 列（项/配置/核对方式），取口播稿表格，磁盘写明 NVMe PCIe 4.0 |
| 4 | figure + rot | 左图位约 768 宽，轮换 rtx5060ti-1 → z890-pacific-1 → cropped/box-internal-1-crop；右侧文字：先定卡再配整机、1/3 槽直连 CPU 拆双 PCIe 5.0 ×8、必须带核显（桌面占显存 + TP 均分会扣掉另一张卡的显存） |
| 5 | figure + rot | 左图位轮换 case-h600-1 → cooler-pa120se-1 → cropped/box-internal-2-crop → cropped/gpu-telemetry.png；右侧文字：EV850 850W（满载 360W、峰值最多 600 余 W、智能插座实测 360W）、H600 七风扇正压（上二/后一/前三/下一）与风道、PA120 SE、实测 56/58℃ 14.9 GB |
| 6 | table | 模型参数 6 行（权重格式/体积与载入/每卡权重/KV 精度/上下文/视觉）；note 一句：功耗与温度见上一页实测 |
| 7 | divider | SECTION 02 · 框架与速度 |
| 8 | table | 关键开关 9 行 3 列（开关/取值/理由），取口播稿表格 |
| 9 | metric | P2P：hero `1.16×`，note 写 42.8 ms/步、128 次 × 47 µs ≈ 6.0 ms = 14%、现实 1.10–1.17×、要真 Linux + 开源内核模块；收尾句「投机解码摊薄同步开销更划算」 |
| 10 | table + 小图 | 速度一页搞定：左侧数字表 6 行（decode 中位 99.9 / p90 131.1 / min·mean·max / TTFT / prefill / 接受率），右侧小图 `charts/decode-dist.png`（约 700 宽），底部三格数字块：58k → 28.0 s / 155.4；150k → 102.3 s / 125.5；prefix 命中 163/261 ms |
| 11 | divider | SECTION 03 · 显存、坑与结论 |
| 12 | table | 显存账本 7 行（KV 容量/runtime/free/每卡权重/host-mapped/视觉 cache/CUDA graphs）+ 注意「日志原文，不按 16 GiB 加总」；下一块 `--embedding-host` 1.185 GiB → 144,448 vs 219,776，以及双流档 nvfp4 CAP 393,216 / 每路 196,608 |
| 13 | figure | 小图 `charts/vram-budget.png`（约 900 宽）+ 右侧：KV pages 3,434/6,868、每卡权重 10.4 GiB 拆解、host-mapped 在主机内存不占显存 |
| 14 | transcript | mailbox 死锁实录：两 rank 互等 → kPeerSpinLimit 降级 → 83 行补丁两笔提交 59de3c1 / 969d570 → 30 请求 0 降级 |
| 15 | final | 结论三条（显存优先于算力 / 量化档按上下文选 / 本机选单流）+ 三件下一步 + colophon（硬件、版本、录制口径） |

标题字数控制在 18 字内；表格行数 ≤ 9；每页正文总字数 120–200 字，靠表与数字承载信息。

## 素材现状

- 白底、可直接用：`assets/hardware/cropped/gpu-4view.jpg`、`gpu-dimensions.jpg`、`cropped/box-internal-*-crop.jpg`、`cropped/gpu-telemetry.png`、`charts/*.png`
- 质量一般、允许先用：`assets/hardware/case-h600-1.jpg`（绿底渲染）、`cooler-pa120se-1.jpg`（促销红字）
- 数量：不要一页超过 4 张轮换。

## 交付

1. 改 `deck/index.html`，`DECK.slides` 重写到上面 21 页；新增 `table` 页型与 `rot` 轮换；不动模板签名动效。
2. 跑 `node deck-shot-local.mjs`，逐页截图，确认无报错。
3. 写 `deck/DECK-NOTES.md`：每页一行（页码/类型/关键数字/对应口播稿小节），供后面出分镜和 TTS 用。
