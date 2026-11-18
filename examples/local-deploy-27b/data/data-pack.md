# 本地部署 27B 模型 — 数据包（2026-10-17）

口径约定：下文「默认档」= merged-v3.ninfer（NVFP4 权重、nvfp4 KV、163,840 上下文、dflash2 K=7 + mailbox + 识图，2026-10-13 实测）；「当前档」= coder390 w4a4-w8a8 容器（W4A4/W8A8 权重、int8 KV、219,776 上下文，2026-10-17 正在 8080 运行）。

## 1. 硬件清单（实机核对 2026-10-17）

| 项 | 值 | 出处 |
|---|---|---|
| CPU | Intel Core Ultra 5 245K（带核显），14 核 / 14 线程 | PowerShell `Win32_Processor`（2026-10-17）；任务管理器可见 Intel(R) Graphics，KF 无核显故按 K |
| 显卡 | NVIDIA RTX 5060 Ti ×2，各 16 GB（16,311 MiB），驱动 596.49（32.0.15.9649） | `nvidia-smi.exe --query-gpu=...`（2026-10-17） |
| PCIe | Gen5，两卡 link.width.max = 8（均 CPU 直连，槽1 ×16 + 槽3 ×8 拆分双 ×8） | nvidia-smi 同上 + `driver-diagnosis.md:59` |
| 功耗上限 | 单卡 180 W | nvidia-smi `power.limit`（2026-10-17） |
| 内存 | Crucial 16 GB ×2 = 32 GB DDR5，**一条 4800 MHz + 一条 5600 MHz 混速，双通道**；实际运行频率预期取 4800（待确认） | PowerShell `Win32_PhysicalMemory`（2026-10-17） |
| 主板 | MAXSUN（铭瑄）MS-iCraft Z890 Pacific | PowerShell `Win32_BaseBoard`（2026-10-17） |
| BIOS | AMI E2.2D（2026-03-04） | PowerShell `Win32_BIOS`（2026-10-17），与 `driver-diagnosis.md:3` 一致 |
| 电源 | 爱国者 aigo EV850 极客版 850W 白金牌全模组 | 包装图实拍核对（2026-10-17）；5 月诊断文档记作 A+ 850W 白金，功耗推算 ~580W 峰值 @850W 约 68% 负载（`driver-diagnosis.md:112-121`） |
| 机箱 | 长城隐刃 H600 全塔，7 风扇正压差 | `driver-diagnosis.md:7,11-20`（待确认） |
| 散热 | 利民 PA120 SE 双塔风冷 | `driver-diagnosis.md:8`（待确认） |
| 磁盘 | KIOXIA EXCERIA PLUS G3 2 TB ×2（SATA SSD） | PowerShell `Win32_DiskDrive`（2026-10-17） |
| 系统 | Windows 11 25H2，build **26200**（2026-05-28 时为 22621.8457，此后升级） | PowerShell `Win32_OperatingSystem.BuildNumber`（2026-10-17） |
| WSL | Ubuntu（WSL2），CUDA 13.1（`/usr/local/cuda-13.1`） | `serve-valerio.sh:36`、README 环境注记（`README.md:66-74`） |

> **过时结论修正**：`driver-diagnosis.md`（2026-05-28）称「单通道 16 GB 内存是唯一短板」（`driver-diagnosis.md:132-138`）。内存已升级为 32 GB 双通道，该结论过时；且其推测的双卡崩溃根因「单根内存 + 访存冲突」（`driver-diagnosis.md:26-30`）在双通道后不再成立，双卡跑 ninfer 已稳定运行多日（见 §6）。

## 2. 模型与量化

| 项 | 默认档（merged-v3，10-13） | 当前档（coder390 w4a8，10-17） | 出处 |
|---|---|---|---|
| 引擎自报名 | `qwen3.8-27b` | `qwen3.8-27b-coder390-w4a4-w8a8-mtp-dflash2` | `ninfer-default.log:7` / `ninfer-w4a8.log:8`（2026-10-17） |
| API 模型 id | `27b`（`--model-id 27b`，否则 404 model_not_found） | `27b` | `serve-valerio.sh:22,37`；`curl http://127.0.0.1:8080/v1/models`（2026-10-17）返回 `{"id":"27b","max_model_len":219776}` |
| 参数量 | 27 B（Qwen3.8-27B 稠密，非 MoE） | 同 | 模型名 + `README.md:96`（MoE 会被拒绝） |
| 权重格式 | NVFP4：层 0-55 MLP NVFP4，其余 FP8（官方 nvfp4 档）；另有全 NVFP4 QUASAR 档 17.0 GiB | **W4A4/W8A8**（coder390 容器），MTP 层与 DFlash2 drafter 已合并进工件 | `two-gpu.md:27-30`、`README.md:92-94` / `ninfer-w4a8.log:8` |
| 权重体积 | 20.7 GiB（nvfp4 档加载 20.7-20.9 GiB） | 20.8 GiB，24.5 s 载入（~868 MiB/s） | `ninfer-default.log:2,5` / `ninfer-w4a8.log:2,5` |
| 每卡权重 | 10.4 GiB（分片 9.88 + 复制 259.6 MiB + 本地 ~0.3 GiB） | 同 | `ninfer-w4a8.log:9-10` |
| embedding | FP8 `[248320,5120]` + 每行 BF16 scale = 1.185 GiB，放 host 锁页 | 同，host-mapped 1.18 GiB | `serve-valerio.sh:17`、`ninfer-w4a8.log:12` |
| KV 精度 | nvfp4（pages 2560/2560） | int8 | `valerio-engine-findings.md:4,12` / `ninfer-w4a8.log:11` |
| 上下文长度 | 163,840 | 219,776（max-context = kv-capacity = 219,776） | `valerio-engine-findings.md:4` / `serve-valerio.sh:38`、`ninfer-w4a8.log:11`、`curl` 返回 max_model_len 219776（2026-10-17） |
| 视觉 | --vision，视觉塔钉卡 0，14 预处理 worker | 同，cache 1.00 GiB + live 2.00 GiB | `valerio-engine-findings.md:28` / `ninfer-w4a8.log:20` |

## 3. 推理框架与关键参数（`serve-valerio.sh:37-43`）

| 参数 | 作用（一句话） |
|---|---|
| `--tp 2 --devices 0,1` | 张量并行：权重与 KV 池各半分布在两卡，两卡无 P2P，all-reduce 走 pinned-host mailbox（`README.md:61-64,98-99`） |
| `--kv-dtype int8` | KV int8 量化，16 GB 卡上换最大上下文（nvfp4 KV 上限更高但默认档用它做长上下文）（`README.md:111-112`、`serve-valerio.sh:9`） |
| `--max-context 219776 --kv-capacity 219776` | 刻意取相等以「保单流最长」：单条会话可跑满 219,776 token；代价是双并发退化为串行（池仅 3,434 页，一条满载吃光）（`serve-valerio.sh:11-13`） |
| `--device-state-slots 4` | 设备 checkpoint 状态槽（当前实例 3 个 device StateImage）（`ninfer-w4a8.log:14`） |
| `--max-concurrency 2` | 并发上限 2；conc=2 与 4 总吞吐相同（166.9 vs 167.3 tok/s）但 4 出现 4.9 s 排队，故选 2（`valerio-engine-findings.md:49-55`） |
| `--spec dflash2 --draft-tokens 7` | DFlash2 投机解码，每步提案 7 token，需配合 `--lm-head-draft`（`README.md:109-110`） |
| `--lm-head-draft` | 用 lm head 给 draft 打分，MTP/DFlash2 都受益（`two-gpu.md:8`） |
| `--embedding-host` | embedding 表移入 1.18 GiB host 锁页、两卡经 PCIe 原地读，省下每卡 1.185 GiB 显存——这是 219,776 int8 档能开起来的前提（不开只有 144,448）（`serve-valerio.sh:9,17-19`） |
| `--vision --vision-device 0 --max-vision-tokens 4096` | 开启识图，视觉塔钉在一张卡避免视觉阶段跨卡集合通信（`serve-valerio.sh:21`） |
| `--prefill-chunk 1024` | prefill 按 1,024 token 分块（tp2 每个 chunk 付一次交换开销）（`two-gpu.md:123-125`） |
| `--preserve-thinking` | 保留已关闭回合的 reasoning 内容进后续 prompt |
| CUDA graphs（默认开） | 捕获 decode 图，启动 904 ms；两卡各观察 58/56 MiB、allowance 132 MiB（`ninfer-w4a8.log:6,18-19`） |
| mailbox 传输（自动） | pinned-host mailbox 捕获成功：`captured all-reduces: mailbox | exchange kernel pipelined | slot 160 KiB | mailbox probe 1.03 ms`，无回退（`ninfer-w4a8.log:15`）；probe >50 ms 或超时会自动降级为跨卡 copies（`README.md:125-131`） |
| DFlash2 drafter 切分 | drafter 注意力 16/4 头切分、MLP 各半、selector 在 rank 1（`ninfer-w4a8.log:17`） |

## 4. 速度数据（两组口径，各标来源）

### 4.1 【默认档 merged-v3.ninfer，2026-10-13 实测】NVFP4 权重 + nvfp4 KV + 163,840 上下文 + dflash2 K=7 + mailbox + 识图

来源：`valerio-engine-findings.md`（2026-10-13 实测记录），逐条抽查 `mbv-*.log` 核实。

| 维度 | 数字 | 出处/核实 |
|---|---|---|
| 文本 decode（单流） | 89.5 / 89.6 tok/s，accept 25.1% | `valerio-engine-findings.md:33` |
| 文本 TTFT | 366 ms 冷启动 / 127 ms prefix reuse | `valerio-engine-findings.md:34` |
| 识图 decode | 119.3–120.7 tok/s，accept 39.2%；TTFT 232–294 ms，总 1.0–1.1 s | `valerio-engine-findings.md:35`；`mbv-dflash2-vis.log` req#32-34 实测 120.7/119.3/120.2 tok/s、TTFT 248/232/241 ms ✓ |
| prefill（58k 长文） | 2.10k tok/s（首条） | `mbv-dflash2-vis.log` req#35 ✓ |
| 并发 1 | 89.5 tok/s | `valerio-engine-findings.md:51` |
| 并发 2 | 总 166.9 tok/s，每流 83.5，1.87×（wide slot 160 KiB） | `valerio-engine-findings.md:52`；`mbv-dflash2-conc2.log` req#1-2 decode 101.2/91.3 tok/s ✓ |
| 并发 4 | 总 167.3 tok/s，每流 41.8，出现 4.9 s 排队（slot 320 KiB） | `valerio-engine-findings.md:53`；`mbv-dflash2-conc4.log` req#4 queue 4.9 s ✓ |
| 长上下文 58,863 | 首次 TTFT 28.0 s / prefill 2.10k tok/s，decode 155.4（accept 61.5%）；重发 prefix reuse 100%，TTFT 163 ms，总 610 ms | `valerio-engine-findings.md:42`；`mbv-dflash2-vis.log` req#35-36 ✓ |
| 长上下文 150,459 | 首次 1m42.3s / 1.47k tok/s，decode 125.5（accept 58.6%）；重发 TTFT 261 ms，总 658 ms | `valerio-engine-findings.md:43`；`mbv-dflash2-long150k.log` req#1-2 ✓ |
| 对照：无投机 + mailbox | 42.3 tok/s（1.00 tok/round，23.6 ms/round） | `valerio-engine-findings.md:17` |
| 对照：MTP K=3 + mailbox | 91.0 tok/s（127 tok 样本，2.80 tok/round，30.8 ms/round）；ab-bench 8080 1 512 2 → 60.5 / 65.1 tok/s（accept 29.9%/34.9%）；高接受率文本（69.3%）98.8 tok/s | `valerio-engine-findings.md:9-10,18` |
| 对照：dflash2 + copies（无 mailbox） | 44.2 tok/s（2.53 tok/round，57.2 ms/round） | `valerio-engine-findings.md:19` |
| 对照：老 fork dflash2 + mailbox | 70.8 tok/s | `valerio-engine-findings.md:20` |
| 稳定性 | 30 请求（24 文本 384 tok + 6 识图）0 错误、0 次降级，均值 83.6 tok/s | `valerio-engine-findings.md:36` |
| 传输事实 | `captured all-reduces: mailbox | exchange kernel pipelined | slot 80 KiB | mailbox probe 0.61 ms`，无回退；probe 0.56-0.98 ms | `valerio-engine-findings.md:8,32` |
| KV | nvfp4，pages 2560/2560 | `valerio-engine-findings.md:12` |

### 4.2 【当前 w4a8-mtp-dflash2 实例，2026-10-17 日志】W4A4/W8A8 权重 + int8 KV + 219,776 上下文，正在 8080 运行

来源：`ninfer-w4a8.log` 的 `req#… done` 行，awk 统计（非手数），采样窗口 2026-10-17 11:10:26–13:03:24（n=130 条完成请求，均为真实 dsh agent 流量：工具调用、长会话 prefix 命中）。

| 维度 | 数字 | 出处 |
|---|---|---|
| decode 样本数 | n=130 | `awk` 统计 `ninfer-w4a8.log` `req# done` 行（2026-10-17） |
| decode 中位数 | 99.9 tok/s | 同上 |
| decode p90 | 131.1 tok/s | 同上 |
| decode min / max / mean | 71.4 / 176.8 / 105.3 tok/s | 同上 |
| TTFT 中位数 / 最大 | 337 ms / 971 ms | 同上 |
| prefill | 大 prompt 2.10k–2.73k tok/s（16,534-32,593 tok 级）；短 prompt 300-670 tok/s | `ninfer-w4a8.log` req#2/3/8 throughput 行 |
| dflash2 接受率 | 25.6%–69.0%，多数 31%-61%（prefix 高命中时 60%+） | `ninfer-w4a8.log` 各 req done 行 |
| 并发 | 服务上限 2，日志见 2 请求同时 running；本档无独立 conc=2/4 基准（serve 脚本注明 89.5/120/166.9 那组是 163,840 nvfp4 档测的，本档未重测） | `ninfer-w4a8.log` running 行；`serve-valerio.sh:20` |
| 识图 | 本档启动开启 vision（vision-device 0），日志未见独立识图基准 | `ninfer-w4a8.log:20` |
| 对照（同机器同引擎 10-14 默认档日志） | merged-v3 int8 219,776 档：单请求 200 tok 输出 decode 81.6 tok/s（accept 25.6%）、长输出 decode 113-118 tok/s | `ninfer-default.log` req#1/req#2（2026-10-14） |

> 注意：两组口径权重不同（NVFP4 vs W4A4/W8A8）、KV 不同（nvfp4 vs int8）、上下文不同（163,840 vs 219,776），不可直接比 tok/s。当前档 decode 中位数 99.9 tok/s 略高于 10-13 文本基线 89.5，符合 int8 KV 读得更快的预期，但未做同口径复测。

## 5. 上下文与显存账本（当前实例，`ninfer-w4a8.log:9-20`，2026-10-17 启动）

| 项 | 值 | 出处 |
|---|---|---|
| KV 容量 | 219,776 tokens，int8，pages 3,434/6,868 | `ninfer-w4a8.log:11` |
| runtime 显存 | 4.33 GiB（10-14 同配置默认档为 4.42 GiB） | `ninfer-w4a8.log:11` / `ninfer-default.log:11` |
| 剩余显存 | 每卡 free 136.0 MiB（10-14 档 free 68.0 MiB） | `ninfer-w4a8.log:11` / `ninfer-default.log:11` |
| 每卡权重 | 10.4 GiB = 分片 9.88 GiB + 复制 259.6 MiB + 本地 282.0/245.0 MiB | `ninfer-w4a8.log:9-10` |
| host-mapped 权重 | 1.18 GiB pinned host 内存，两卡经 PCIe 原地读（free -m shared +1.2 GiB） | `ninfer-w4a8.log:12`、`serve-valerio.sh:18-19` |
| 视觉 cache | 卡 0：cache 1.00 GiB + live 2.00 GiB，14 预处理 worker | `ninfer-w4a8.log:20` |
| CUDA graphs | rank 0 观察 58.0 MiB / rank 1 56.0 MiB，allowance 各 132.0 MiB | `ninfer-w4a8.log:18-19` |
| context cache | 2 active + 3 cached device states；private 8、shared 4、anchors 2；host 层关闭（tp2 无 host tier） | `ninfer-w4a8.log:19`、`README.md:106-108` |
| mailbox | slot 160 KiB（conc=2 下 wide slot），probe 1.03 ms | `ninfer-w4a8.log:15` |
| int8 显存极限 | 219,776（不开 --embedding-host 只有 144,448；219,840 差 47 KB 被拒：需 4,745,902,593 B，仅剩 4,745,854,976 B） | `serve-valerio.sh:9`；`cap-int8-144448-c2-x144448.log`、`cap-int8-219840-c2-x219840-dflash2---embedding-host.log:8` FATAL |
| 双满载需换 nvfp4 | 两条都满载需 cap = 2 × max_context，int8 显存给不了 | `serve-valerio.sh:13` |

## 6. 踩坑与稳定性

| 坑 | 详情 | 出处 |
|---|---|---|
| 双卡进程崩溃（早期，llama.cpp） | 双卡同时跑 llama-server 时进度跑不起来、后台进程直接崩溃退出（非 BSOD），当时归因单根内存 + 访存冲突 | `driver-diagnosis.md:26-30`；**双通道升级后 ninfer 双卡稳定运行多日，此坑已消**（`ninfer-w4a8.log` 10-17 连续运行、10-13/10-14 日志均无崩溃） |
| TDR | LLM 单次 forward 可超 2 s，默认 TDR 会复位显卡致进程崩溃/BSOD；解法注册表 `TdrDelay`/`TdrDdiDelay` = 60 | `driver-diagnosis.md:61-71` |
| 驱动版本 | NVIDIA 596.49（2026-05-05 安装，2026-10-17 nvidia-smi 核实仍为 596.49）；WSL 内 CUDA 13.1 | `driver-diagnosis.md:95`、nvidia-smi 输出（2026-10-17）、`serve-valerio.sh:36` |
| 单通道内存（已过时） | 5 月时单条 16 GB 单通道是「唯一短板」，双通道升级后带宽翻倍、双卡访存冲突缓解 | `driver-diagnosis.md:132-138`；2026-10-17 PowerShell 实测 2×16 GB 双通道（一条 4800 一条 5600 混速） |
| DFlash2 mailbox 死锁（WSL2 issue #1） | dflash2 提案阶段与 target forward 的 captured mailbox 交换交错：A 先进 mailbox 阶段自旋，B 的 pull 源被 A 显存挡住，两 rank 互等至 kPeerSpinLimit 降级。补丁 `dflash2-mailbox-rendezvous.patch`（83 行，含 v1），两笔提交 `59de3c1`（DFlash2 draft 阶段 collective 留在 staged copies 上）/ `969d570`（draft share 后两 rank 会合，pull_done(target) + source wait）。修复后 30 请求 0 降级 | `valerio-engine-findings.md:25-26`；`git show 59de3c1 / 969d570`（2026-10-17 核实提交存在）；`.inject-check/dflash2-mailbox-rendezvous.patch` |
| MTP K 上限 = 3 | K=5 接受率仅 19.2%（`mbv-mtp-k5.log` req#1：mtp accepted 250/1,303）；K=7 被 CLI 拒绝（`mbv-mtp-k7.log` 打出 usage、引擎未启动）。所以默认档走 DFlash2 K=7 而非 MTP K=7 | `valerio-engine-findings.md:59`；`mbv-mtp-k5.log`、`mbv-mtp-k7.log`（2026-10-17 核实） |
| MTP draft 阶段 mailbox 挂起（已知行为） | 引擎自带降级：draft 阶段挂起则回退 copies 并记日志；本机已用 DFlash2 绕开 | `README.md:69-74,125-131` |
| 单流占满 KV 池 | 219,776 池仅 3,434 页，一条满载后第二条排队至 pending_timeout_ms（默认 30 s）回 QueueTimeout；要双满载需换 nvfp4 KV | `serve-valerio.sh:12-13` |
| 5090 对照基准（他人硬件） | 双 5070 Ti：MTP3 corpus 157.1 vs 5090 161.1 tok/s（98%）；DFlash2 K=7 corpus 160.4 vs 192.5（83%）；对 llama.cpp decode 1.3-1.9×。锁频 2100 MHz 会损失 decode 17-18%；本机 5060 Ti 未锁频 | `two-gpu.md:55,60,101-103,160-162,193-197`（对照基准，非本机） |

## 7. 存疑/待确认清单

1. 内存混速（4800 + 5600）实际运行频率——预期 4800，未实测（无只读手段确认内存控制器频率）。
2. 电源/机箱/散热型号——无标准 CIM 类，沿用 2026-05-28 诊断文档，未重新打开机箱核对。
3. 默认档 ab-bench 60.5/65.1 tok/s（MTP K=3 档）——只有 `valerio-engine-findings.md` 记载，`ab-off.log`/`ab-on.log` 未找到对应 aggregate 行（那两份日志是别组 A/B）。
4. 当前 w4a8 档无独立并发/识图基准——decode 统计全部来自真实 agent 流量（工具调用 + 长会话），非受控 benchmark。
5. 锁频与否——`two-gpu.md` 的 5070 Ti 数据在 2100 MHz 锁频下测得，本机 5060 Ti 未锁频，直接对比会有偏差。
6. 双卡崩溃已消的结论基于「日志无崩溃」的间接证据，未做专门压测（纪律禁止大 benchmark）。
