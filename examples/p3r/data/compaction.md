# 上下文压缩机制 — 参数表 · 观众口播稿 · 实测账单

> 交付对象：B 站"AI 算法对抗大赛"系列。第一节给数据页直接取数，第二节是口播稿，第三节是三场实测账单与核对过程。
> 采样时刻：2026-10-03 19:38（本地，UTC+8）。夺旗那一场仍在推理中，其数字会继续变化（19:24 与 19:38 两次采样结果一致）。
> 全程只读：只 grep 与读文件，没有改配置、没有重启任何服务、没有跑评分。

---

## 〇、生效层怎么叠（先看这段，参数表才读得对）

装配顺序 = **bundle 层 → 各预设自己的 realm → profile 补丁层**；profile 只在实例启动时装配，改数必须重启才生效。本次服务实例 pid 8877：`compact-region-diag.log:443-446` 与 `compact-route-diag.log:1482` 打出它在 10:50:01（本地）完成挂载，直到 19:22:40 的夺旗折叠仍是同一个 pid，期间没有重启（没有新的 `mount:` 行）。
> 注意一个坑：`ps -o etime` 反推该实例启动时间会得出 11:30，与日志差 40 分钟——WSL2 的单调时钟在虚拟机挂起期间冻结，所以 `etime` 偏小。以诊断日志与 `/proc/8877` 目录时间（10:50:00）为准。

| 层 | 文件 | 对压缩做了什么 |
|---|---|---|
| 上游默认（已构建检出） | `$HOME/dsh-master/packages/compaction/compaction-basic/src/config.ts` | 提供默认值与那条阈值算式本身 |
| bundle 层 | `$HOME/dsh-data/workplace/dsh-compact-route/cordis.patch.yml:14-15, 17-30` | `:14-15` 禁用官方 `compaction-basic` 后端；`:17-30` 插入 `compact-route` 引擎（摘要目标 `deepseek-official/deepseek-flash`、`maxTokens: 32768`、`headroomTokens: 0`、`effort high`、`auto: true`）。该包确实在 bundles 清单里：`$HOME/dsh-data/.dsh/profiles/web/package.json` → `dsh.profile.bundles` 第 4 项 |
| 预设层（生效预设 `ptc-local-concise`） | `$HOME/dsh-data/workplace/dsh-preset-ptc-local-concise/cordis.patch.yml:230-279` | 同 id 行整条替换 config：`thresholdRatio 0.8 / retainRatio 0.2 / maxTokens 65536 / headroomTokens 0`（`:252-258`），并挂上局部折叠工具（`:265-269`）、手动 `/compact`（`:271-272`）、工具输出修剪器（`:274-279`） |
| profile 补丁层 | `$HOME/dsh-data/.dsh/profiles/web/cordis.patch.yml` | **不含任何压缩参数**（全文只在 `:3` 的注释里提到"压缩"）。它给的是窗口与请求上限（`:37-38`）和默认预设指针（`:60-61`） |

两族引擎并存的事实（不是我推的，是重启时自己打出来的）：`$HOME/dsh-data/.dsh/compact-route-diag.log` 在 `2026-10-03T02:50:01Z` 打出 **4 条 `maxTokens=32768 headroom=0 ratio=0.8 retain=0.16`** 与 **4 条 `maxTokens=65536 headroom=0 ratio=0.8 retain=0.2`**——前者是根树/bundle 族，后者是 ptc 系预设族。两族算出的**压缩线相同（145000）**，差在摘要输出上限与尾部保留量。

搜过但确认没有的地方：profile 补丁层无压缩键；`DSH_HOME` 下无 `settings.yaml`（0.1.7 已把它并进 profile patch）；预设未使用 `rulesFile` 覆盖规则文案（诊断日志打 `rules=builtin`）；预设未覆盖提示参数（诊断日志打 `nudge=50000/22500/75/95`，即全默认）。`~/.dsh` 那棵树按已知事实是无关 profile，未取数。

---

## 一、参数表（最终生效值 + 出处）

| 项 | 生效值 | 语义 | 出处（文件:行） |
|---|---|---|---|
| 保留尾部 `keep` | **6 条**（事件/表面节点，不是"6 轮"） | 尾巴上最近这 6 个节点永远不可折，等于"正在用的东西不许擦" | 预设 `.../dsh-preset-ptc-local-concise/cordis.patch.yml:268`（`keepRecentEvents: 6`）；上游默认同为 6：`$HOME/dsh-data/workplace/dsh-compact-region/src/index.ts:141, 598`；运行证据 `$HOME/dsh-data/.dsh/compact-region-diag.log:443`（`mount: keep=6`） |
| 摘要字数上限 `maxSummaryChars` | **5000** 字符（旧默认 3000 已在本实例失效） | 局部折叠时一次摘要正文的硬上限，超线整次退回、不静默截断 | 预设 `:269`；默认 3000 见 `.../dsh-compact-region/src/index.ts:142, 599`；运行证据 `compact-region-diag.log:443`（10:50 起 `maxSummaryChars=5000`），反向佐证：`diag:505` 正文 4115 字符被接受（>3000） |
| 单段摘要建议预算 | **`max(400, min(5000, 段tokens/24))`** 字符，由状态查询按段打印 | 只是打印给模型看的建议线；实测圈地 14:39 那次印 400、模型写了 503 仍然放行——硬拒绝线是上一条的 5000 | `.../dsh-compact-region/src/index.ts:319-322`（同文件 `:443` 负责把它打印成 `summary ≤ N chars`）；硬线校验 `:948-957`；实测印值见 `contestants/report/trace-land-gui2.md:15` |
| 触发比例 `thresholdRatio` | **0.8**（上游默认也是 0.8） | 窗口占比项 | 预设 `:252`；默认 `.../compaction-basic/src/config.ts:20, 78` |
| 尾部保留比例 `retainRatio` | **0.2**（ptc 系预设族）/ 0.16（根树族） | 自动压缩时保留多长的近期原文不压掉 | 预设 `:253`；默认 `.../compaction-basic/src/config.ts:23`；两族并存见 `compact-route-diag.log` 02:50:01 的 8 条 `engine constructed` |
| 预留窗口 `headroomTokens` | **0**（上游默认 65536） | 归零后公式退化成"声明窗口 − 请求输出上限"这一条直线 | 预设 `:255`；bundle `:28`；默认 `.../compaction-basic/src/config.ts:75` |
| 请求侧预留 | `maxTokens` **85000** | 公式里被减掉的输出预留 | `$HOME/dsh-data/.dsh/profiles/web/cordis.patch.yml:38` |
| **压缩触发线 `thresholdTokens`** | **145000** token = `floor(min(0.8×230000, 230000−85000−0))` | 实测提示日志里的分母就是这个数，说明整条公式生效 | 算式 `.../compaction-basic/src/config.ts:191-194`；代入 `:172, 181`；预设注释 `:242-247`；运行证据 `compact-region-diag.log:447` 起所有 `capacity=145000` |
| 尾部保留量（自动路径） | 预设族 ≈**29000**（`145000×0.2`）/ 根树族 ≈23200 | 实际取哪一族在压缩事件里没有字段记录 → **未记录** | `.../compaction-basic/src/config.ts:195-197`；事件字段实测清单见本文第三节（无 retain 字段） |
| 摘要请求输出上限 `maxTokens` | 预设 **65536** / bundle **32768**；**唯一一次自动压缩的事件里落的是 32768** | 即该次由 32768 那族（根树/bundle）引擎服务 | 预设 `:254`；bundle `:27`；事件值 `sessions/...bomberman-gui1.../session.v4.jsonl.zstd` 的 `compaction/summary`（`maxTokens: 32768`）；日志同值 `compact-route-diag.log:1509` |
| 摘要模型与档位（配置意图） | `deepseek-official` / `deepseek-flash`，reasoning `high` | 预设想让摘要走云端快模型，不占用本地 27B | 预设 `:256-258`；bundle `:23-24, 29` |
| 摘要模型与档位（实际发生） | 本地 **llamacpp/27b**：① 局部折叠 7 次**完全不发推理请求**（摘要由对话模型自己写）；② 唯一一次自动压缩先试云端、transport 失败后回落到本地 27B 成功 | 回落次序：配置目标 → 最近一次在途路由的模型 → 会话自身 provider/model | 引擎选择与回落 `$HOME/dsh-data/workplace/dsh-compact-route/src/engine.ts:135-150, 167-175`；局部折叠零推理 `.../dsh-compact-region/src/index.ts:10-15`；日志证据 `compact-route-diag.log:1503-1508, 1511`（`no LLM call` / `FAILED ... retrying on llamacpp/27b` / `fallback ... succeeded`） |
| 会话模型档位 | `reasoningEffort: max` → 映射为 `xhigh` | 思考预算本身就在吃窗口（预设注释里点名 `preserve_thinking` 让窗口涨得更快） | profile `:16-18, 42-47`；注释 `预设:248-250` |
| `compact_region` 局部折叠语义 | 模型自己给起点与替换文本；区间按**位置序**（`seq A -> B`，A 可以大于 B）；指令锚点、system 头、最近 6 条**永不可折**；摘要必须严格短于被压内容；超硬线整次拒绝并回送一个"这份摘要放得下"的 `to_seq`；旧检查点不会自动带过，需读回来并入；**只有返回 `compactionId` 才算真折叠**；原文不删，摘要末尾附回读指针与关键词 | 局部折叠是"自己动手擦某一段"，与整段自动压缩是两条路径 | 契约文案 `$HOME/dsh-data/workplace/dsh-compact-region/src/rules.ts:28-52`（工具）与 `:64-71`（状态查询）；实现拒绝分支 `.../index.ts:188-223, 935-957`；常驻规则 `rules.ts:74` 起；实际调用形态（经 `run_code` 内派发）：会话事件 `tool/ptc-dispatch-start name=compact_region` |
| `[compact-nudge]` 触发条件 | 压力分母用**有效容量 145000**（不是声明 230000）。三档：<br>① `growth`：相对基线净增 ≥**50000** token，且此刻可折量 ≥**22500** token →「This is an efficiency nudge to fold consumed work while...」<br>② `pressure`：占用 ≥**75%**（=108750）→「⚠ Context pressure is high — compress now. This nudge repeats until a fold lands.」，此后每轮重复<br>③ `emergency`：≥**95%**（=137750）→ 同上加尾句"再不折就被自动压缩接管、摘要不再由你控制" | 同一时刻最多挂一条（未领取即抑制后续）；读数比基线掉一整个台阶则重设基线（说明外部已压过）；提示本身不是指令，会随所在段被下一次折叠带走 | 分母 `.../dsh-compact-region/src/index.ts:668-680`；判档 `.../src/nudge.ts:97-124`；默认值 `:49-55`；两条文案 `:126-128`，渲染 `:137-151`；id 前缀契约 `:30`；运行证据 `compact-region-diag.log:439`（`nudge=50000/22500/75/95`）、`:447, 492, 499`（growth/pressure/emergency 三类实文） |
| 工具输出修剪（压缩前置） | `thresholdChars 8192 / headChars 4096 / tailChars 1024` | 单条工具输出超 8192 字符则留头 4096＋尾 1024，中间替换成固定标记；只在压力到达阈值后**先修剪再重测**，能不掉线就不掉线 | 预设 `:277-279`；上游默认同值 `$HOME/dsh-master/packages/compaction/compaction-tool-result-pruner/src/config.ts:10-14`；标记 `:7`；"先修剪再重测" `$HOME/dsh-master/packages/compaction/compaction-basic/src/index.ts:323-327` |
| 自动压缩的完整判据 | 实测 token ≥ 145000 → 修剪 → 重测 → 仍超线才压；每次保留 `retainTokens` 尾部；最多 2 次尝试；溢出错误另有恢复重试 | 这条线也是提示机制的 100% 点 | `.../compaction-basic/src/index.ts:314-341`；重试默认 `.../config.ts:105-106`（`compactionRetries: 1`、`maxOverflowRetries: 1`，预设未覆盖） |
| 手动 `/compact` | 已挂载 | 三场的 8 次压缩已全部归因到"局部折叠 7 + 引擎整段 1"，**未见手动触发那类** | 预设 `:271-272`；计数见第三节 |
| 常驻规则段与引擎在场 | `promptSection=on`、`engine=present`、`rules=builtin` | 系统提示里常驻一段"什么时候该压"的判断准则 | 挂载逻辑 `.../dsh-compact-region/src/index.ts:598-605, 1070`；运行证据 `compact-region-diag.log:443` |
| **上下文窗口：声明 vs 服务端实际（按要求只并列）** | 声明 `contextWindow: 230000` ｜ 请求上限 `maxTokens: 85000` ｜ llama.cpp 服务端 `-c 152000`（另有 `-np 1`、`--parallel 1`） ｜ 预设注释另记 2026-09-27 实测 `n_ctx 158208` | 压缩线用声明值算，与服务端值无关；本场不做评判、不改参数 | profile `:37-38`；`D:\biubiu\local-llm\scripts\Qwen3.8-uncensored-27b\UD-llama-Q5_K_XL-tensor.bat:24, 32, 42`；注释 `预设:245` |
| 设计决策出处（用户自己的文档） | 保持 0.8 不动、只做"摘要改道"与"局部折叠"两件事 | 「不调 compaction 阈值（A2 的 0.85 暂缓……保持 0.8 更稳）」；并警告过多压缩=反复重锚 | `$HOME/deepseek-harness/workplace/docs/ptc/ptc-local-implementation.md:315`；`.../ptc-local-optimization-review.md:19, 65-67, 230`（该文数字为 8 月旧口径，勿直接引用） |

> 表中"预设 `:NNN`"均指 `$HOME/dsh-data/workplace/dsh-preset-ptc-local-concise/cordis.patch.yml`；"bundle `:NNN`"指 `$HOME/dsh-data/workplace/dsh-compact-route/cordis.patch.yml`；"profile `:NNN`"指 `$HOME/dsh-data/.dsh/profiles/web/cordis.patch.yml`。

---

## 二、给普通观众的口播稿（实测 357 汉字，含标点 405；无函数名、文件名、参数名）

模型没有记忆，只有一块固定大小的黑板。每走一步，它都得把黑板上已有的东西重看一遍：读过的文件、写过的代码、编译报错、一局局回放。

这场比赛让黑板格外紧张：一次比赛要走上百步，本地这块又比云端小得多。堆到一定程度，前面的内容会被挤出去，挤掉的可能是它花二十分钟想通的战术，或者裁判要求的通信格式。忘了这些，它会重犯已经修好的错。

于是我们定了记笔记的规矩：一段工作确实收尾，就把这大段过程压成几条要点，要点留下、过程擦掉。擦掉不等于销毁，笔记末尾留着索引，细节还能查回来；可查回来又占地方，它一般不查。

这事有代价。写笔记得它自己想、自己写，是打在慢机器上的真推理，几十秒起步；擦完还得把剩下的重读一遍，又几十秒。压太狠更疼：关键约束一并擦掉，后面几步就照错的假设重写。所以规矩很克制，只压已收尾的段落，正用着的那截不许碰，笔记还必须比原文短。

三场下来，它自己记了七次笔记；另一次是系统看它实在腾不开，替它写的。

---

## 三、本次三场的实测压缩账单

口径先说死：**"压缩"= 会话日志里 `compaction/start` + `compaction/summary` + `compaction/end` 这一组三事件**，每压一次就是一组；来源 `$HOME/dsh-data/.dsh/sessions/--...-{land-gui2,bomberman-gui1,ctf-gui1}--/session-*/session.v4.jsonl.zstd`（zstd 帧解码，只读）。三场会话的 preset 全部是 `ptc-local-concise`。

### 3.1 汇总

| 场次 | 比赛时间窗（本地） | 压缩次数 | 其中：模型局部折叠 | 其中：引擎整段压缩 | 提示注入：发出 / 落入对话 / 未被采纳 | 压掉并释放的 token 合计 | 摘要正文合计（字符） |
|---|---|---|---|---|---|---|---|
| 圈地 `land-gui2` | 13:54–16:23 | 4 | 4 | 0 | 15 / 11 / 4 | 239,742 | 9,045 |
| 炸弹人 `bomberman-gui1` | 16:38–18:32 | 3 | 2 | 1 | 16 / 14 / 2 | 186,040 | 5,828（+云端那次 9,863 落盘） |
| 夺旗 `ctf-gui1` | 18:40–19:37（采样止） | 1 | 1 | 0 | 3 / 2 / 1 | 68,756 | 1,896 |
| 合计 | — | 8 | 7 | 1 | 34 / 27 / 7 | **494,538** | 16,769（局部折叠）+ 9,863（整段落盘） |

### 3.2 逐次明细（时间为本地，= 诊断日志 UTC + 8）

| # | 本地时刻 | 场次 | 路径 | 折叠区间（seq，位置序） | 压掉事件数 | 释放 token | 摘要正文 / 落盘字符 | 该步墙钟 | 折叠执行耗时 | 端点修补尝试 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 14:39 | 圈地 | 模型局部折叠 | 9 → 39 | 9 | 5,241 | 503 / 1,020 | 1 分 53 秒 | 约 8 毫秒 | 1 |
| 2 | 14:47 | 圈地 | 模型局部折叠 | 79 → 53（反向形状） | 5 | 76,112 | 4,115 / 4,659 | 51 秒 | 约 2 毫秒 | 2 |
| 3 | 15:15 | 圈地 | 模型局部折叠 | 106 → 494 | 124 | 71,224 | 2,054 / 2,611 | 1 分 10 秒 | 约 4 毫秒 | 1 |
| 4 | 16:23 | 圈地 | 模型局部折叠 | 536 → 725 | 60 | 87,165 | 2,373 / 2,900 | 32 秒 | 约 4 毫秒 | 2 |
| 5 | 17:06 | 炸弹人 | 模型局部折叠 | 9 → 69 | 17 | 45,384 | 3,362 / 3,911 | 1 分 08 秒 | 约 3 毫秒 | 1 |
| 6 | 17:29 | 炸弹人 | 模型局部折叠 | 108 → 464 | 107 | 69,857 | 2,466 / 2,982 | 1 分 31 秒 | 约 3 毫秒 | 1 |
| 7 | 18:12 → 18:16 | 炸弹人 | **引擎整段压缩** | 8 → 905 | 111 | 70,799 | —（模型不写）/ 9,863 | 发起前该步已走 59 秒 | **摘要推理 3 分 56 秒**（含云端失败与本地回落） | 不适用 |
| 8 | 19:22 | 夺旗 | 模型局部折叠 | 9 → 128 | 30 | 68,756 | 1,896 / 2,412 | 1 分 25 秒 | 约 6 毫秒 | 1 |

第 7 次的推理用量（全场唯一有 token 记账的一次压缩）：`inputTokens 9582 / outputTokens 7782 / cacheReadTokens 96497 / totalTokens 113861`，另存 `rawOutput` 推理文本 14,387 字符；`provider/model = llamacpp/27b`、`maxTokens = 32768`、`llmStreamCall = true`。

"该步墙钟"= 从 `step/start` 到折叠落地的时间，也就是模型自己想、自己写这段笔记花掉的真机时间（第 7 次另有 3 分 56 秒的摘要推理，不在这个数里）。"折叠执行耗时"= 引擎落盘替换的时间，毫秒级，可忽略。

### 3.3 压缩之后的"重读税"（每次压缩后的第一步用量，实测）

| 压缩 | 压缩后首步时刻 | 该步新输入（未命中缓存）token | 该步缓存命中 token |
|---|---|---|---|
| 圈地 14:39 | 14:46 | 113,294 | 10,055 |
| 圈地 14:47 | 14:48 | 34,696 | 10,055 |
| 圈地 15:15 | 15:16 | 16,624 | 10,055 |
| 圈地 16:23 | 16:23 | 10,794 | 10,652 |
| 炸弹人 17:06 | 17:07 | 47,195 | 10,176 |
| 炸弹人 17:29 | 17:30 | 9,013 | 10,176 |
| 炸弹人 18:12 | 18:20 | 45,384 | 10,653 |
| 夺旗 19:22 | 19:23 | 38,284 | 10,118 |

这组数是"压缩不免费"的第二半：折叠点之后的所有内容都要重新喂进模型，缓存命中普遍掉回去，只剩开头约一万 token。**这些是 token 数，不是秒数；本场未记录逐次重放耗时，我没有换算成秒**（若要给口播配一个秒数，得按 2026-09-30 用户自测的 ≈1000 token/秒 prefill 折算，那是**推算、非实测**，且属于另一场会话的速率）。

### 3.4 与两份诊断日志的核对（UTC → 本地 +8）

- **8 次压缩逐条对得上。** 表中 7 次局部折叠（#1–#6、#8）与 `$HOME/dsh-data/.dsh/compact-region-diag.log` 的 `folded:` 行按 `compactionId` 一一对应，行号依次 `:498, :505, :512, :533, :538, :545, :581`；第 7 次（引擎整段）在区域日志里**没有** `folded:` 行——它记录在 `$HOME/dsh-data/.dsh/compact-route-diag.log:1509-1511`（18:12:41 起云端目标、18:12:42 失败回落、18:16:37 成功）。
- **摘要路由对得上。** 三场窗口内 `compact-route-diag.log` 只有 2 条 `summarize(vendored)`（`:1502` 属 12:26 的赛前会话，不计；`:1509` 即炸弹人 18:12 那次），其余全是 `summarize: model-authored ... no LLM call`（`:1503-1508`、夺旗最新行）——与"局部折叠不花推理"一致。
- **阈值线对得上。** 提示日志里 `capacity=145000` 从 11:20 起贯穿三场（`compact-region-diag.log:447` 起）；圈地 14:36 那条压力档提示 `projected=119567`（已过 108,750=75% 线），16:22 起进入紧急档 `projected=138201`（已过 137,750=95% 线），炸弹人 18:12 前最后一条 `projected=146775` 越过 145,000 → 整段压缩随即发生。这条链路（提示→重复→越线→引擎接管）与参数表完全自洽。
- **`maxSummaryChars` 生效值对得上。** 本实例 10:50 挂载起就打 `maxSummaryChars=5000`（`:443-446`），三场全在其后；圈地 14:47 那次正文 4,115 字符被放行即为反证（旧默认 3000 会拒）。
- **时刻口径提醒：** `compaction/start` 记**发起**时刻（18:12），`compaction/summary` 记**摘要完成**时刻（18:16），`compact-route-diag.log` 只记后者。做分镜时若把两者当同一时刻，会漏掉那 3 分 56 秒。
- 三场会话的 `requestConfig`/`contextInfo` 一致：`provider=llamacpp, model=27b, reasoningEffort=max, maxTokens=85000, contextWindow=230000`（取自 `contestants/report/stats.json`）。

### 3.5 口径差异（必须上页面，别等评论区问）

1. **"圈地 4 次整段 / 4 次 compact_region"其实是同一批 4 次。** 逐条比对结果：圈地的 4 个压缩事件与 4 次局部折叠调用一一同 id 对应，且引擎路径在该窗口没有任何摘要记录 → **圈地的"引擎整段压缩"实为 0 次**。炸弹人的 3 次里 2 次是局部折叠、1 次是引擎整段（18:12–18:16）。先前那组计数把同一事件按两个维度各算了一遍。
2. **提示条数三种口径都给出：** 发出（写进收件箱）15 / 16 / 3；落入对话（成为一条用户消息）11 / 14 / 2；未被采纳（下一次折叠时被丢弃）4 / 2 / 1。炸弹人的"14"等于"落入对话"口径；圈地的"12"与两口径都不等，恰好等于其中"压力档"的 12 条，推测先前按含"Context pressure is high"字样且不含紧急尾句来数——**未证实，按未定处理**。
3. **摘要字符数三套数并存，别混用：** 工具记录的正文（503 / 4,115 / …）、会话事件落盘文本（比正文多约 520–560 字符，多的部分是回读指针与关键词行）、既有 `stats.json` 的 `chars`（JSON 序列化长度，比落盘文本再大几十到上百）。
4. **夺旗一场是进行中的快照**（19:38 采样，会话最后事件 19:37）：1 次压缩、发出 3 条提示。发布会前建议重采一次。

### 3.6 明确未记录 / 拿不到的项

- 每次**局部折叠**的 token 用量：无记录（该路径不发推理请求，日志明写 `no LLM call`）。
- 自动压缩那次的**尾部保留量**与实际生效 realm 归属：事件无 `retain` 字段 → 未记录（只有 `maxTokens=32768` 这个间接证据指向 bundle/根树族）。
- 逐次**重放秒数**：本场会话日志只有 token 与步时刻，未记录首 token 时间 → 未记录（见 3.3 的说明）。
- `/compact` 手动压缩、`clearThinking` 之类的其它上下文管理动作：三场会话日志中未出现该路径事件 → 未发生。
- 溢出恢复（请求被服务端判超窗后的重试）：三场窗口内未在任何日志出现相关记录 → 未观测到。
