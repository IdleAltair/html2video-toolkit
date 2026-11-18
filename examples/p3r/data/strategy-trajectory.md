# 27B 三场解题的思维与策略演变

分析对象：Qwen3.8-27B-Uncensored（llama.cpp，Q5_K_XL，双卡 tensor 切分），经 DSH Web GUI 驱动，预设 `ptc-local-concise`，`reasoningEffort=max`，`maxTokens=85000`，上下文窗口 230000。
三场：圈地（land-gui2）、炸弹人（bomberman-gui1）、夺旗（ctf-gui1，**分析时仍在跑**）。

数据来源（只读，未执行任何编译/评分/裁判/重启）：

- `$HOME/deepseek-harness/workplace/meow-ai-arena/contestants/report/trace-land-gui2.md`（97 步）
- `$HOME/deepseek-harness/workplace/meow-ai-arena/contestants/report/trace-bomberman-gui1.md`（149 步）
- `$HOME/deepseek-harness/workplace/meow-ai-arena/contestants/report/trace-ctf-gui1.md`（16 步，进行中）
- `$HOME/deepseek-harness/workplace/meow-ai-arena/contestants/report/stats.json`

---

## 0. 口径（进数据页前先读这段）

| 项目 | 口径 | 依据 |
|---|---|---|
| `时刻` 列含义 | **该步结束的时刻**，分钟精度（向下取整） | stats.json 里 land 首次压缩 14:39:51 正对表内 1.9 步（14:39，fold 动作）；第二次 14:47:45 正对 1.11 步（14:47）。若按"步开始"解释，1.10（14:46，7.0 分钟）会与 1.11（14:48）重叠，解释不通 |
| `步耗时` 列含义 | 请求 + 该步工具执行的合计间隔 | land 步耗时求和 120 分钟 ≈ 墙钟 149 分钟 − 服务中断 27 分钟；bomberman 101 分钟 ≈ 墙钟 114 分钟 − 中断 2 分钟 |
| 有效工时 | 用步耗时求和，不含服务中断 | land 中断 15:52:44→16:19:22（27 分钟，`bad allocation`）；bomberman 中断 18:00:55→18:02:34（2 分钟，同错） |
| **口径差异 1** | stats.json 的 `ctf-gui1` 块是**旧快照**（文件时间 19:03，轨迹导出 19:15）：只记 7 次请求 / 输出 48505 token；轨迹实际已有 16 步 / 输出 72472 token。**ctf 的一切统计以轨迹表为准** | 两文件 mtime 与该集仍在进行 |
| **口径差异 2** | stats.json 的 `toolErrors` 三场都写 0，与轨迹表头的 7 / 15 / 1 矛盾，取轨迹表 | trace 文件末尾"工具报错"节逐条可数 |
| **口径差异 3** | 思考摘要每步只保留前 170 字，本文所有"原文片段"都可能被截断（用 `…` 标示） | 表头说明 |
| 时间写法 | 时刻一律到分钟；中位数等每步指标用秒（这是原始数据精度，不做换算伪装） | — |

---

## 1. 三场基本盘

| 集 | 步数 | 起止时刻 | 墙钟 | 有效工时 | 压缩次数 | nudge | 工具报错 | 输出 token | 缓存命中 | 结局（自报） |
|---|---|---|---|---|---|---|---|---|---|---|
| 圈地 land | 97 | 13:54 → 16:23 | 149 分钟 | 120 分钟（含 27 分钟中断在外） | 4 | 11 | 7 | 256188 | 93.7% | 8:2 胜 greedy、平均面积 851 vs 606；16:22 硬截止 |
| 炸弹人 bomberman | 149 | 16:38 → 18:32 | 114 分钟 | 101 分钟 | 3 | 14 | 15 | 220713 | 96.7% | 8 seeds 5 胜 1 平 2 负；四人局 81 回合零报错 |
| 夺旗 ctf | 16（**进行中**） | 18:40 → 19:11+ | ≥31 分钟 | 31 分钟 | 0 | 1 | 1 | 72472 | 快照失真 | 两局 10:44、3:31 大败，正在逐帧定位 |

三场合计 **262 步、252 分钟有效工时、549373 个输出 token、23 条工具报错、7 次压缩、26 次压缩提醒**。
全程只有 `run_code` 一个工具（95 / 148 / 7 次调用），**0 次求助人类、0 次联网**。

---

## 2. 第一集 · 圈地 land（97 步）

### 主线

**读题（1.1–1.5，13:54 内 5 步、共 31 秒）**：TASK.md → RULES.md → 文件大小+starter bot → game.py → referee.py+greedy anchor。读得极快，但只是"过一遍"，没有当场核对协议字节格式——这个欠账在后面爆了 47 步。

**一次性设计（1.6，13:54 开始、14:29 结束，34.9 分钟，输出 84894 token）**：整场 29% 的时间花在这一步上。它在这一步里做了博弈论推导并写下"Game Mechanics Summary - 1v1: 40×40 board, 600 turns…"，同时顺手"check clock/compiler"。方案是**全局规划式**：算领地、算切断、算对手。

**第一版落地（1.7–1.11，14:36–14:47）**：1.7 开写时它自己惊觉"33 minutes have already elapsed… my budget is 90 minutes. Let's move fast."；1.8 发现 `printf("%d %c\n")` 里的 `\n` 被工具层吃掉，整份重写；1.9、1.11 两次响应压缩提醒折叠上下文；1.10 写出 v2。这 5 步里没有任何一次真实对局。

**第一次自测（1.12，14:48）**：跑本地裁判 10 局 vs greedy anchor。1.13（14:49）判读结果："My bot is timing out on every turn (10 timeouts, max_ms 0.0 = not a single valid move)."——**仗还没开始打，棋一步都没下出来**。

**协议排错期（1.13–1.58，14:49–15:07，46 步、17 分钟，平均一步 22 秒）**：这是全场最大的一块消耗。手段链是：读 referee 启动逻辑（1.14–1.15）→ 造合成 turn-0 prompt（1.19）→ 用文件 stdin 直接喂二进制（1.20–1.27，发现"文件能答、管道不答"）→ strace（1.32、1.38、1.48）→ 插 stderr 阶段标记（1.34、1.37、1.41）→ 最小复现程序（1.54–1.56）→ 1.58 确认"the raw `read(0)` returns immediately (54, then 107)"，把 fread 换成裸 read(0)。

**打法返工第一轮（1.59–1.70，15:07–15:14）**：跑通了，但 2:8 输给 greedy（1.60），改完方向候选反而 1:9（1.62）。它开始用 replay 逐帧找死因，1.67（15:10）定位到"All my deaths: reason 'wall', pos=[20,27] — respawn spawn position… I keep dying at the spawn point on every death…"，1.69（15:14）修垂直候选 → 3:7。

**压缩后重新读题（1.71–1.76，15:15–15:26）**：1.71 折叠整段调试；1.72（15:16）第一件事是"Read TASK.md rules"，接着 1.73 读 game.py、1.74 读自己的 bot、1.75 读 greedy anchor、1.76（15:26，7.4 分钟）逆向 greedy 的 makePlan。**压缩把规则细节冲掉了，它选择重读源文件而不是相信摘要。**

**推翻方案（1.77，15:29）**：放弃全局规划，整份改写成"局部袋子(bag)"策略。代价立刻显现：1.80（15:29）"Way worse! 1:9… There's something fundamentally broken."——比重写前的 3:7 倒退了。1.78 又踩了一次 printf `\n` 被吞（与 1.8 同一错误，相隔 40 步）。

**爬升与版本对比（1.83–1.93，15:33–15:52）**：逐帧追路径（1.83、1.87）、重读 decide()（1.84）、修 done 判定与袋子生长（1.85）、修 BFS 首步（1.88）→ 1.89（15:43）4:6、平均面积 608 vs 776（对比此前 234 vs 926）→ 1.91（15:47）7:3、790 vs 622 **首次反超** → 1.92–1.93（15:49–15:52）针对"seed 3 那局死了 63 次"加出生点驻守/绕环 → 8:2、814 vs 598。**这一段的特征是每次改动都同时报比分+平均面积两个数字，是全场最有纪律的时期。**

**中断与收尾（15:52:44 服务崩溃 → 2.1，16:22）**：恢复后第一步就自报状态"State: 8:2 vs greedy, average 851 vs 606… About 10 minutes left. Remaining tasks:"，只跑了四人混测。2.2（16:22）"The hard stop has been reached (137 minutes elapsed…)"。**定稿前没有再动过策略代码**，最后一次改动是 15:52 的驻守补丁。

### 关键转折点

| 步号 | 时刻 | 转折性质 | 当时思考原文 |
|---|---|---|---|
| 1.6 | 14:29 | 定下第一版技术路线（全局规划） | "Now I fully understand the game. Let me think deeply about strategy. ## Game Mechanics Summary - 1v1: 40×40 board, 600 turns, 2 players, symmetric spawns (180° rotation)." |
| 1.7 | 14:36 | 自我加压、开始提速 | "33 minutes have already elapsed. There's about 86 minutes left until the hard stop, and my budget is 90 minutes. Let's move fast." |
| 1.13 | 14:49 | **战线转移**：从打法转到进程协议 | "My bot is timing out on every turn (10 timeouts, max_ms 0.0 = not a single valid move)." |
| 1.32 | 14:53 | **承认协议理解错** | "The bot is alive but not responding. It's blocking on fread. In other words, my understa…" |
| 1.44 | 15:00 | 假进展：插桩脚本没落盘却自称 OK | "Only two markers exist in the source! The python script from the previous step claimed "OK" and BUILT, but the insertions…" |
| 1.55 | 15:06 | 最小复现成功 | "Reproduced it with a minimal program!… not even "mini: read1"!! The first fread(buf, 1, 1MB, stdin) didn't return…" |
| 1.58 | 15:07 | **换技术路线：stdio → 裸 read(0)** | "Confirmed: the raw `read(0)` returns immediately (54, then 107). Next, apply this fix… replace fread with read(0, …)" |
| 1.60 | 15:08 | 跑通，回到打法问题 | "Progress! The bot is now working (responds in 0.2ms). But it's losing to greedy 2:8, and the death counts are extremely high…" |
| 1.67 | 15:10 | 找到致命行为模式（出生点撞墙） | "Now it's completely clear: **All my deaths: reason 'wall', pos=[20,27] — respawn spawn position…**" |
| 1.72 | 15:16 | 压缩后重读题目 | "Now that the context has been organized, let me continue debugging the remaining issues…" |
| 1.77 | 15:29 | **推翻自己的路线**，整份重写为局部袋子策略 | "OK: "the same file can be repeated" — for the melee self-test, I can pass my own file 4 times…" |
| 1.80 | 15:29 | 重写导致倒退 | "Way worse! 1:9, and the death count is huge (4-14 times). There's something fundamentally broken." |
| 1.91 | 15:47 | 首次反超 + 开始双指标版本对比 | "Big progress: **7:3, average 790 vs 622**!… But game 5 (seed 3, I'm B): **deaths [0, 63]!!!**" |
| 2.2 | 16:22 | 收手 | "The hard stop has been reached (137 minutes elapsed — the session was interrupted and the clock exceeded the deadline)." |

---

## 3. 第二集 · 炸弹人 bomberman（149 步）

### 主线

**读题（1.1–1.7，16:38–16:42，7 步 3.8 分钟）**：README/RULES → engine/engine.py（权威模拟）→ arena 驱动 → baseline.cpp → build.py。1.4（16:41）就查了时钟并复述规则。这一集开局比第一集干净得多。

**一次性设计 + 写码（1.8，16:54，12.3 分钟，30700 token）**：判断基准不弱——"baseline.cpp is actually a pretty decent bot (time-expanded reachability, potential fields, denial, etc.)"，并选定**在 C++ 里复刻引擎做前向模拟**这条重路线。

**当场否定自己（1.9，17:04，9.7 分钟，24213 token）**：因为它在 1.8 留了占位符——"I ended up leaving placeholders in the code. I had started writing in a sloppy manner. So now, I'll write the complete, clean version in one go." 三场里最明确的一次自我推翻。

**编译错误地狱（1.10–1.23，17:04–17:09，14 步、4.5 分钟）**：`\n` 被吞（1.12）、narrowing（1.15/1.18）、`gNow0` 声明顺序（1.16）、`DSC[5]="UDLRS"` 少一位（1.19）、**第 67 行括号不平衡吃掉 1.17–1.23 共 7 步 1.5 分钟**，中间还用 `od` 十六进制 dump 才数清括号，最后 1.23 改用 python 程序化改行。

**协议排错期（1.25–1.84，17:10–17:41，60 步、26 分钟，平均一步 26 秒）**：与 land 同构、且更长。
1.25 "Timeout on turn 0!…" → 1.30 自测只有 32ms，出现"我的测法和裁判的测法不一致"这个元问题 → 1.32 读 arena.py 的 reader thread（`readline(257)`、行长/行尾判 failure）→ 1.35 "When stdin stays open (without EOF), the bot outputs nothing for 4 seconds. When stdin is closed (my benchmark), it outputs in 32ms." → 1.45 strace 确认 `read(0)=310` 后再阻塞 → **1.52–1.57 误判 6 步**：它认定二进制没更新（"either the build didn't actually recompile (cached?)"），1.57 才发现"The compilation failed — so the old binary got tested again (that's why there was no change)." → 1.65–1.66 第二次压缩后明确按摘要续查（"Compaction complete. Continue debugging the pipe hang. From the compacted summary:…"）→ 1.73–1.74 上 gdb，看到 fread 断点后 `0 S 1` 打出"GOLD"，但**把 gdb 当成变量**（1.76 "So the variable is **GDB** — or timing!"）→ 1.83 补 `#include <unistd.h>` → 1.84 "Fixed! Using the raw `read()` syscall…" → 1.86（17:41）arena 零报错、`max_ms 234ms`。

**从"能跑"到"能赢"（1.87–1.115，17:42–18:00）**：先花 6 步（1.87–1.93）解析 replay（HTML 内嵌 JSON，正则贪婪匹配失败多次），然后 1.94–1.97（17:44–17:48）逐行核对引擎 step 语义、1.97–1.100 修箱子可通行（`old_string` 多处命中又吃 2 步报错）。1.108（17:52）"Seeds 1 and 2: I'm still placing a bomb on my own cell at (1,1) on turn 0, dying on turn 4"，1.110（17:53）"DEPTH 1: all actions v≈1502-1507, myS=6 — including d=4 pl=1 (stay+bomb)!!!"——**所有动作估值同分**，说明模拟或评估里有系统性 bug，但它此时还没找对方向。

**服务恢复 + 目标切换（2.1，18:06，3.5 分钟）**："The service has recovered. Time is running short (about 40 minutes remaining out of the 120-minute window). **Top priority: make sure the bot reliably works and submit it.**" 这是本场唯一一次明确降级目标。

**真正的根因（2.11–2.27，18:20–18:29）**：2.11 用 replay 里的 `input_text` 精确复现 T3 决策；2.12（18:22）"**Major discovery.** The reproduction of A3 shows that all actions (d=0..4, pl=0) are getting myS=6, v=1505.0!"；2.25（18:28，**全局第 140 步**）"**Jackpot.** All d=0..4 are moving me to (3,2)!!! Even d=4 (stay, (0,0) offset) → (3,2)!!"；2.27（18:29，第 142 步）定位到 `oppActions` 循环遍历了包括自己在内的所有玩家，把自己的 `dir[i]` 也覆盖掉了——**stepNode 一直在用被污染的 dir**。这个 bug 从 17:04 写完 v1 就存在，直到 18:29 才修掉，**带病运行 133 步、85 分钟**。

**版本对比与翻盘（2.29–2.30，18:29–18:30）**："Huge improvement: 5 wins, 1 draw… 2 losses. The bot is now placing lots of bombs (7-46) and killing the baseline…"

**定稿前（2.31–2.34，18:31–18:32）**：删调试代码、跑四人局（2.33 "81 turns, zero errors across all 4 bots — protocol is clean."）、看自己第 64 回合死于连锁炸弹，然后结束。**最后 8 分钟做的是稳定性验证，没有再改估值。**

### 关键转折点

| 步号 | 时刻 | 转折性质 | 当时思考原文 |
|---|---|---|---|
| 1.8 | 16:54 | 选定"复刻引擎 + 前向模拟"重路线 | "baseline.cpp is actually a pretty decent bot (time-expanded reachability, potential fields, denial, etc.)…" |
| 1.9 | 17:04 | **推翻自己**，整份重写 | "I ended up leaving placeholders in the code. I had started writing in a sloppy manner. So now, I'll write the complete, clean version in one go." |
| 1.23 | 17:09 | 放弃肉眼改字符，改用脚本改行 | "Still no match. Let me use python/sed to fix line 67 programmatically…" |
| 1.25 | 17:10 | **战线转移**：打法问题 → 协议问题 | "Timeout on turn 0! My bot took longer than 2000ms on the first turn. Why?…" |
| 1.35 | 17:13 | 定位到 file stdin 与 pipe stdin 的分叉 | "When stdin stays open (without EOF), the bot outputs nothing for 4 seconds." |
| 1.57 | 17:24 | 从"二进制没更新"的错误假设里爬出来 | "The compilation failed — so the old binary got tested again (that's why there was no change)." |
| 1.76 | 17:37 | **误判**（把 gdb 当变量） | "Major discovery: **The FIFO case also hangs**… So the variable is **GDB** — or timing!" |
| 1.84 | 17:41 | **换技术路线：fread → 裸 read()（与 land 同一个解）** | "Fixed! Using the raw `read()` syscall, the bot now works even with the Python pipe stdin…" |
| 1.86 | 17:41 | 跑通即判负，转胜率问题 | "The arena is now working — protocol fixed, no errors… But: **I lost**…" |
| 1.110 | 17:53 | 识别出系统性 bug 的存在（但没定位） | "DEPTH 1: all actions v≈1502-1507, myS=6 — including d=4 pl=1 (stay+bomb)!!!" |
| 2.1 | 18:06 | **决定收手降级目标** | "Time is running short (about 40 minutes remaining out of the 120-minute window). Top priority: make sure the bot reliably works and submit it." |
| 2.25 | 18:28 | **挖到最大根因** | "**Jackpot.** All d=0..4 are moving me to (3,2)!!!… `stepNode` is ignoring `dir` complet…" |
| 2.30 | 18:30 | 版本对比证明修复有效 | "Huge improvement: 5 wins, 1 draw… 2 losses… killing the baseline (opponent died in 5 out of 8 ga…" |

---

## 4. 第三集 · 夺旗 ctf（16 步，**进行中，不作定论**）

**读题（1.1–1.5，18:40–18:44，5 步 3.8 分钟）**：README/RULES → 引擎与辅助脚本 → submission/bot.cpp 模板 → baseline.cpp 全文。规则复述很稳（1.3，18:43）："This is a capture-the-flag game with 2-15 factions, each of which controls 3 units… 400 turns total. Map sizes: 2 factions → 23, 3-5 → 31…"

**设计（1.6，13.5 分钟，于 18:57 结束，输出 32886 token，占当前全场 43.5%）**：先逆向 baseline（"Greedy task assignment: flags…, chasing enemy carriers (only when m…)"），动作名直接是"Check time budget and compiler"。

**先草稿后写入（1.7，19:00，3.1 分钟）**："There's about 74 minutes left. Alright, let me write bot v1."，动作是 "Draft bot v1 code (**review before writing**)"。1.8（19:04）真正写入时它自查出一个度量用错："Made a mistake in the draft: the `manhDist(id, fp, U)` inside the flag loop is wrong — I need the BFS distance from the enemy to the flag, not the Manhattan distance. Act…"。**这是前两场没出现过的"写前自查"，但样本只有 16 步，是否稳定改变不确定。**

**首测到跑通只花 2 分钟（1.9–1.13，19:04–19:06，5 步 2.2 分钟）**：1.11（19:05）"The bot crashed on the first turn (segfault, code -11)"，立刻建 ASan 版复现；1.13（19:06）定位"Crash at line 106 of initFields: `homeField[t] = bfsSet(cells);` — move assignment of vector<int>. Why SEGV? `homeField` is a global `vector<vector<int>>` of size 0! I ne…"，修完就打完两局。**注意：它这一场没有踩前两场的 fread 管道坑（至少到 19:11 为止没花步数在上面），但它也没在文本里提过"上次这个坑"，无法确认是吸取了教训还是还没撞上。**

**进入效果返工（1.14–1.16，19:07–19:11）**："It's working now, but losing badly: 10 vs 44, 3 vs 31. Something is very wrong…"，然后逐帧读 32–36 回合，1.16（19:11）"Frame 32: My units 1, 2 are at (9,9), (9,10) — right next to my own base…"。到导出处（19:15）**刚把问题从"能不能跑"切到"为什么拿不到分"，尚未开始第二轮改码。**

---

## 5. 跨集共性

### 5.1 稳定重复的优点

1. **先读引擎再动手，而且读权威实现**：三场第一动作都是读 README/RULES + engine/referee + baseline 源码（land 1.1–1.5、bomberman 1.1–1.7、ctf 1.1–1.5），并且会去读裁判的进程接管逻辑（land 1.14、bomberman 1.31–1.32）。
2. **主动查钟，能报出剩余分钟数**：land 1.6 动作含 check clock、1.7"86 minutes left / budget 90"、2.1"About 10 minutes left"；bomberman 1.4 check clock、2.1"about 40 minutes remaining out of the 120-minute window"；ctf 1.6 Check time budget、1.7"about 74 minutes left"。三场都没有到截止前才想起时间。
3. **疑难用系统级手段而非猜**：strace（land 1.32/1.38/1.48、bomberman 1.41/1.61）、gdb 断点（bomberman 1.73–1.74）、ASan（ctf 1.11）。
4. **最小复现**：land 1.54–1.56 用 mini 程序复现 fread；bomberman 1.34/1.40/1.71 复刻裁判协议；ctf 1.12 单独复现崩溃。
5. **服从上下文压缩提醒，并在压缩后能续上**：compact 折叠动作 land 5 次（1.9/1.11/1.71/1.90/2.3）、bomberman 2 次（1.13/1.65）；bomberman 1.66 明确"From the compacted summary:…"后接着干。
6. **用 replay 逐帧而不是只看胜率**：land 1.63/1.67/1.83/1.87、bomberman 1.89/2.5/2.10/2.11、ctf 1.15/1.16。
7. **临期能切目标**：bomberman 2.1（18:06）把"变强"降级为"确保能跑并交卷"；land 2.2（16:22）接受硬截止并交付。

### 5.2 稳定重复的缺点

1. **同一个坑跨集重踩，最贵的一次是 fread 管道阻塞**：land 1.12–1.58 花 47 步/17 分钟，bomberman 1.24–1.84 花 61 步/26 分钟，**合计 108 步、43 分钟、占两场有效工时（221 分钟）的 20%**。两场的最终解都是"裸 `read(0)` + `#include <unistd.h>`"（land 1.58，bomberman 1.83–1.84），第二场完全是在重新发现第一场的答案。
2. **`printf` 里的 `\n` 被工具层吞掉，踩了 4 次**：land 1.8、land 1.78（相隔 40 步）、bomberman 1.12、bomberman 1.58（这次是 python heredoc 补丁里再踩）。
3. **工具调用写法反复翻车**：23 条工具报错里 **17 条是同一类**（74%）——往 JS/TS 模板字符串里塞带引号的 shell/heredoc，或访问 SDK 返回结构方式不对（`Expected ','`、`Unterminated template`、`module code`、`TypeError`）。land 全部 7 条都是这一类；1.48–1.51 为了同一条 strace 连发 4 步、3 次语法报错；bomberman 2.18/2.27/2.31 各踩一次同款。另有 5 条 `old_string` 未命中/多处命中、1 条参数序列化失败。
4. **倾向整份重写而不是增量改，且重写会把已验证的东西丢掉**：land 4 次整写（1.7/1.8/1.10/1.77）、bomberman 明确"write the complete, clean version in one go"（1.9）。代价可量化：land 1.70（15:14）已到 3:7，1.77（15:29）整份重写后 1.80（15:29）跌到 1:9，**从 3:7 到 8:2 共花掉 24 步、38 分钟（15:14–15:52）**。
5. **"我以为我改好了"这类元错误反复出现，每次都烧掉一段步数**：land 1.44–1.47（插桩脚本自称 OK 但标记没进源码，4 步/2.4 分钟误判阻塞位置）、bomberman 1.52–1.57（编译失败却以为在跑旧二进制，6 步/1.6 分钟）、bomberman 1.73–1.76（把 gdb 当成变量）。三场都没有建立"改动落盘 + 编译成功"的验证动作。
6. **最致命的 bug 发现得最晚**：bomberman 的 `oppActions` 覆盖自身 `dir`（2.25–2.27，18:28–18:29，全局第 140–142 步）从 17:04 写完 v1 就存在，**带病运行 133 步、85 分钟**，期间它对 baseline 每 seed 皆败，而它一度把原因归到评估权重（1.115，18:00 加 urgency/center）上。
7. **压缩后的第一动作常是重读源文件**：land 1.72–1.75 连读 4 步（TASK.md → game.py → 自己的 bot → greedy）。注意这只是**可观察到的行为**，"摘要丢了规则细节"是合理猜测而非结论——同目录的 `compaction-drift.md` 做过压缩前后动作重跑比对，结论是"没有发现可归因于压缩的漂移或返工"，两份文档口径不同（本文数步数，那份数重跑），不要合并成一句因果判断。
8. **没有把前一场结论写成外部备忘**：三场的 cwd 不同，轨迹里没有任何一步是"回看上一场的笔记"；第 2 场对管道 stdin 的处理与第 1 场完全从零开始。

### 5.3 一个说不清的地方（不编造）

- land 2.2 自报"137 minutes elapsed"，而它 1.7 自报预算是 90 分钟；墙钟 13:54–16:22 实为 148 分钟（其中 27 分钟是服务中断）。**无法从轨迹判断 137 这个数怎么来的**，只能确认它当时认为已越过硬截止。同目录 `scores.md` 记的本地时限是"90 建议 / 120 硬停"一档，与 1.7（90 分钟）、bomberman 2.1（120 分钟窗口）两处自述对得上，所以**"137 分钟"这个数不要直接上口播**，它是模型自己的计时口径。
- ctf 1.12 猜测"Did the bash sandbox block writing to /tmp?"，未证实即被后续步骤绕过；bomberman 1.106–1.107 也怀疑"something is swallowing the output of multi-command bash calls"，同样没定论。**这两处属于模型自己的未验证假设，不应写成机制结论。**
- 本文所有"战绩"都是**轨迹里模型自报的比分**（land 8:2 vs greedy、bomberman 5 胜 1 平 2 负 vs baseline），不是本地挑战赛或正式赛的分数；最终得分与跨集不可比的口径警告见同目录 `scores.md`。

---

## 6. 量化指标

### 6.1 报错/返工消耗（阶段窗口由本文件逐条指认，可按窗口重算）

| 集 | 纯报错排查 | 报错排查时间占比 | 再加效果返工（步数） | 再加效果返工（时间） |
|---|---|---|---|---|
| 圈地 | 47 步 / 97 步 = **48%**（1.12–1.58，14:48–15:07，17 分钟） | **14%** | **82 步 = 85%**（再加 1.59–1.93 打法返工 29 步 + 1.71–1.76 压缩重读 6 步） | **62 分钟 = 52%** |
| 炸弹人 | 75 步 / 149 步 = **50%**（编译 1.10–1.23 14 步 4.5 分钟 + 协议 1.24–1.84 61 步 26.2 分钟） | **31%** | **106 步 = 71%**（再加 1.85–1.115 语义/估值 31 步） | **50 分钟 = 50%** |
| 夺旗 | 4 步 / 16 步 = 25%（1.10–1.13，19:04–19:06，2 分钟） | 7% | 7 步 = 44% | 7 分钟 = 23%（进行中，仅供占位） |

一句话：**两场完整比赛都是"一半步数在排错、一半时间在返工"**，且报错期步数占比高、时间占比低（land 48% 步数只吃 14% 时间，因为排错期平均一步 22 秒）。

### 6.2 从开始写代码到第一次跑通本地裁判

| 集 | 第一版代码落盘 | 第一次跑通裁判 | 用时 | 从题目下发算起 | 跑通判据 |
|---|---|---|---|---|---|
| 圈地 | 14:36（1.7 写完 bot.cpp 并编译） | 15:08（1.60：裁判 10 局跑完、每步 0.2ms 出招） | **32 分钟** | 74 分钟 | 裁判完整跑完且无 timeout |
| 炸弹人 | 16:54（1.8 skeleton 落盘；完整 v1 是 17:04） | 17:41（1.86：arena `errors:[0,0]`、`max_ms 234ms`） | **47 分钟**（从完整 v1 算 37 分钟） | 63 分钟 | 裁判零错误零超时 |
| 夺旗 | 19:04（1.8 写入 v1） | 19:06（1.13：打完两局，不崩） | **2 分钟** | 26 分钟 | 仅"不崩"，两局 10:44/3:31 大败；**进行中** |

注：这里的"落盘"取该步结束时刻（口径见第 0 节），所以是"第一版代码写完"而不是"开始写"；land 那一步本身花了 7.1 分钟思考+写盘。

### 6.3 单步耗时与最长的步

| 集 | 中位步耗时 | p90 | 最长步 | 长思考步（≥3 分钟） |
|---|---|---|---|---|
| 圈地 | 19 秒（stats.json 记 19.5 秒） | 174 秒 | 1.6：34.9 分钟 = 全场 **29%**，一次性博弈论设计，输出 84894 token | 8 步 / 59% 时间 |
| 炸弹人 | 18 秒（stats 21.9 秒） | 72 秒 | 1.8：12.3 分钟 = 全场 12%，设计 + skeleton，输出 30700 token | 5 步 / 34% 时间 |
| 夺旗 | 32.5 秒（stats 旧快照 26.7 秒，勿用） | 386 秒 | 1.6：13.5 分钟 = 全场 44%，baseline 逆向 + 设计，输出 32886 token | 3 步 / 64% 时间（仅 16 步样本） |

**最长的步全都在"写第一版之前"**：三场的设计步（1.6 / 1.8 / 1.6）合计 **61 分钟，占三场总工时 252 分钟的 24%**，输出 token 都在 3 万以上。第二长的步分别是 land 1.76（7.4 分钟，逆向 greedy）、bomberman 1.9（9.7 分钟，整份重写 v1）、ctf 1.8（3.4 分钟，写 v1）。

极短步（≤6 秒）：land 20 步、bomberman 24 步、ctf 4 步，**共 48 步（占 18%）**，集中在读文件、grep、语法报错重试这几类，说明排错期是"高频盲试"节奏。

### 6.4 语言与自我纠正

| 指标 | 圈地 | 炸弹人 | 夺旗 |
|---|---|---|---|
| 可见思考文本字符（每步前 170 字） | 15858 | 24383 | 2138 |
| 其中中文字符 | **0** | **0** | **0** |
| 动作描述里中文字符 | 0 | 0 | 0 |

三场合计 42379 字符的可见推理文本里，**中文 0 个字符（0.0%），英文 100%**；题目和恢复指令是中文，运行时上下文快照是英文。**结论：中文题目 → 全英文推理，三场一致**（口径：只看可见前 170 字）。

"自我纠正"句式确实密集（按出现该句式的步数计）：

| 句式 | 圈地 | 炸弹人 | 夺旗 |
|---|---|---|---|
| `Wait` / `Wait a sec` | 8 / 4 | 6 / 2 | 0 / 0 |
| `No wait`（明确自我否定） | 1 | 4 | 1 |
| `Now I can see / now it's clear`（想通） | 4 | 9 | 0 |
| `Found it / Jackpot / GOLD / Major discovery`（定位成功宣告） | 3 | 7 | 0 |
| `Hmm`（迟疑） | 2 | 2 | 0 |
| **兜底模板句 `I need to investigate this further. Let me check the details.`** | **8** | 1 | 0 |

那 8 次模板句全部落在排错/失败段（1.8、1.50、1.51、1.54、1.57、1.61、1.64、1.70），**同一句英文一字不差地重复，是它没头绪时的固定开场**；炸弹人只在 1.40 用过一次。

---

## 7. 口播要点（可直接念）

1. 三场加起来 262 步、252 分钟纯机器时间，模型全程只有 `run_code` 一个工具，**一次都没求助、一次都没联网**。
2. 圈地开场它一口气想了 **35 分钟**、吐 **84894 个 token** 才写第一行代码——这一步单独吃掉全场 29% 的时间。
3. 从第一版代码写完到裁判肯认它的第一步棋：圈地 **32 分钟**（14:36→15:08），炸弹人 **47 分钟**（16:54→17:41），夺旗只花 **2 分钟**（19:04→19:06）。
4. 同一个坑（`fread` 在管道上卡死，必须换裸 `read(0)`）在两场各踩一遍：**108 步、43 分钟、占两场时间 20%**，第二场完全在重新发现第一场已经找到的答案。
5. `printf` 里的 `\n` 被工具层吃掉，三场踩了 **4 次**，圈地那两次之间还隔了 **40 步**。
6. 23 条工具报错里 **17 条（74%）是同一类**：往 JS 模板字符串里塞带引号的 shell，或者取返回结构的方式不对；圈地 15:02 到 15:03 为了同一条 strace 连发 **4 步、错 3 次**。
7. 圈地把自己的比分从 2:8 修到 8:2 用了 44 分钟（15:08→15:52），但 15:29 那次整份重写让它**从 3:7 退回 1:9**，多花 **38 分钟**才爬回来。
8. 炸弹人最大的一颗雷到 **18:28、全局第 140 步**才挖出来：`oppActions` 把自己的方向也覆盖了，**前面 85 分钟、133 步全在带病跑**。
9. 三场都很会看钟：圈地说"还剩 86 分钟、我预算 90"，炸弹人说"120 分钟窗口还剩 40"，夺旗说"还剩 74 分钟"——**没有一场是拖到截止才发现时间没了**。
10. 上下文一共压缩 **7 次**、系统提醒 **26 次**，它每次都照做；但压缩完第一件事经常是**回头重读题目**（圈地 15:16 起连读 4 步）——重读是事实，是不是摘要丢了东西别当结论念。
11. 圈地有 **48% 的步数**在排错、却只占 **14% 的时间**——因为排错期平均一步只有 **22 秒**，而设计期一步 **354 秒**；它是用密集盲试在换答案。
12. 42379 个字符的可见推理文本里，**中文字符 0 个**：中文题目、纯英文思考，三场一致；而它没头绪时会一字不差地重复同一句英文，圈地里重复了 **8 次**。

注：夺旗此刻仍在跑（截至 19:11 共 16 步、31 分钟），已跑通裁判但两局打成 10:44、3:31，**口播里别把它当定论**。

---

## 8. 附录 A：阶段窗口（便于重算）

圈地：读题+设计 1.1–1.6（6 步 35.4 分钟）｜写 v1/v2 1.7–1.11（5 步 18.4 分钟）｜协议排错 1.12–1.58（47 步 17.2 分钟）｜打法调试 1.59–1.70（12 步 7.1 分钟）｜压缩+重读 1.71–1.76（6 步 11.5 分钟）｜重写+调试 1.77–1.93（17 步 26.2 分钟）｜收尾 2.1–2.4（4 步 4.2 分钟）。

炸弹人：读题 1.1–1.7（7 步 3.8 分钟）｜设计+写 v1 1.8–1.9（2 步 22.0 分钟）｜编译错误 1.10–1.23（14 步 4.5 分钟）｜协议排错 1.24–1.84（61 步 26.2 分钟）｜replay/引擎/估值 1.85–1.115（31 步 19.1 分钟）｜恢复后收尾+dir 覆盖 2.1–2.34（34 步 24.9 分钟）。

夺旗：读题 1.1–1.5（5 步 3.8 分钟）｜设计+草稿 1.6–1.7（2 步 16.6 分钟）｜写 v1 1.8–1.9（2 步 3.5 分钟）｜首回合崩溃 1.10–1.13（4 步 2.1 分钟）｜落后→逐帧 1.14–1.16（3 步 5.0 分钟）。

## 附录 B：内部工具分布（stats.json）

| 集 | bash | read | edit | write | grep | glob | compact_region | job_kill | 合计 |
|---|---|---|---|---|---|---|---|---|---|
| 圈地 | 80 | 6 | 13 | 3 | 0 | 0 | 4 | 0 | 106 |
| 炸弹人 | 109 | 25 | 29 | 32 | 6 | 3 | 2 | 1 | 207 |
| 夺旗 | 1 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 11（旧快照） |

圈地的 `bash:80 vs write:3+edit:13` 说明它改代码主要靠 shell 脚本/here-doc 落地，而不是编辑工具——这与 5.2 第 5 条（"以为改好了但没生效"）直接相关。炸弹人的 write/edit 明显更多，也更早改用脚本改行（1.23）。
