# DECK-NOTES · 15 页与口播稿对照

渲染自检：`cd $WORKSPACE/deepseek-harness/workplace/browser-verify && node deck-shot-local.mjs`
截图目录：`browser-verify/deck-shots/local/local-pNN.png`（2560×1440）

| 页 | 类型 | 关键内容 | 口播稿 |
|---|---|---|---|
| p01 | cover | 两台 5060 Ti 16GB 跑 27B；stats：2 卡 / 27B / 219,776 tok / 99.9 tok/s | 开篇 |
| p02 | divider | SECTION 01 · 硬件、功耗与模型 | §硬件清单 |
| p03 | table | 硬件清单 9 行（CPU/主板/显卡/内存/电源/机箱/散热/磁盘/系统） | §硬件清单表格 |
| p04 | figure+rot | 轮换：双卡产品图（月影白三风扇 + 星夜黑双风扇）→ 机箱内部实拍（两卡一上一下）；右侧选型逻辑 | §硬件清单后两段 |
| p05 | figure+rot | 轮换：H600 白底 → PA120 SE 白底 → 双卡位置实拍 → 米家插座读数；右侧电源/风道/温度/占用 | 同上末段 |
| p06 | table | 模型参数 6 行（W4A4/W8A8、20.8 GiB、每卡 10.4 GiB、int8 KV、219,776、视觉） | §功耗、温度与模型 |
| p07 | divider | SECTION 02 · 框架与速度 | §推理框架 |
| p08 | table | 关键开关 9 行（tp2 / mailbox / dflash2 / CUDA graphs / prefill 1024 / vision / conc 2 / 219776） | §推理框架表格 |
| p09 | metric | P2P：1.16× 上限，一步 42.8 ms、128×47 µs≈6.0 ms=14%，现实 1.10–1.17× | §推理框架 P2P 段 |
| p10 | table+小图 | decode 表 6 行 + decode-dist 小图 + 三数字块（58k 28.0 s / 150k 102.3 s / prefix 163 ms） | §实际速度 |
| p11 | divider | SECTION 03 · 显存、坑与结论 | §显卡空间占比 |
| p12 | table | 显存账本 7 行 + embedding-host（1.185 GiB、144,448 vs 219,776）+ 双流档（393,216 / 196,608） | §显卡空间占比 |
| p13 | figure | vram-budget（已改为两卡各 14.79 GiB，与任务管理器 15,154/15,207 MiB 对得上）+ KV pages、权重拆解、host-mapped | 同上 |
| p14 | transcript | mailbox 死锁：两 rank 互等 → kPeerSpinLimit → 83 行补丁 59de3c1 / 969d570 → 30 请求 0 降级 | §踩过的坑 |
| p15 | final | 三条取舍 + 三件下一步 + colophon | §结论与建议 |

## 2026-10-17 夜修订

- 卡片图换成两张卡各自的产品图（`cropped/gpu-moon-white.jpg`、`cropped/gpu-star-black.jpg`、合图 `gpu-two-cards.jpg`）。
- 双卡位置用俯拍图转正裁剪：`cropped/dual-gpu-position.jpg`（白卡在中，黑卡在下，中间隔一槽）。
- 推理时实测（2026-10-17 夜，2000 token 生成，Windows 侧 nvidia-smi 采样）：占用 95–98% / 94–97%，温度 46–47℃ / 52–53℃，nvidia-smi 采样单卡 113–117 W（双卡合计约 230 W，2026-10-18 复测：36.8 s / 3000 token 稳态，GPU0 中位 116.5 W、GPU1 114.5 W，util 97%，max 119.7/116.0 W）；此前的 98%/58% 是采样瞬间的巧合，不再使用。
- vram 图改为「两卡各 14.79 GiB」，去掉视觉 cache/live 的两条（日志口径，不另占显存）。
- 页脚 band 支持 `**加粗**` 标记，引擎名按此强调。

## 页面能力

- `figure` 页：`figs:[{src,cap}]`，2–4 张时加 `rot:{ms:6000}` 自动轮换；`?fig=N` 钉第 N 帧，键盘 `G` 手动下一帧。
- `table` 页：`cols` + `rows` + `widths`（12 栏里的栏数），8–9 行不溢出。
- 其它页型：cover / divider / metric / ranking / transcript / final。

## 已知待办

- 口播稿 §功耗、温度与模型 的「（功耗图、温度图）」和 §推理框架的「ninfer 上游现状」还没内容，deck 里分别是 p05 的任务管理器读数与 p08 的引擎行，等稿子补。
- p15 总时长还是 00:00:00，TTS 出来后再填。
- 实拍照片只有机箱内部两张；机箱外观与散热器用的是官方图（白底处理过），如需真人实拍可替换同名文件。
