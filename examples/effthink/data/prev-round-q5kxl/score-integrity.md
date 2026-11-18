# 成绩完整性审计：本地 27B 三场「精简挑战赛」是否存在评测口径/工具误报

审计时间：2026-10-03。审计方式：**全程只读**（只读代码、只读结果文件、只用 python 解析既有 JSON，未发起任何对局、未编译、未运行 challenge.py/arena.py/referee.py）。
根目录：`$HOME/deepseek-harness/workplace/meow-ai-arena`，下文相对路径均以此为根。

一句话结论：**三场分数都不存在「工具把差的评成好的」这类高估**；真实误报方向恰恰相反——模型自己的本地自测（只打最弱基准）系统性高估了它，而精简挑战赛对它的多人局面惩罚比正式赛更重。唯一需要修正读数的是炸弹人的 `max_ms≈450ms`，那是**工具统计口径**造成的可读性误报，不是判罚漏网。

---

## 1. 结论表

| 场次 | 分数 | 可信度评级 | 主要依据（文件:行号） | 若误报，量级与方向 |
|---|---|---|---|---|
| 圈地 `land-gui2` | 总分 4.7、第 8/12；单挑 Elo +48、混战 Elo −282 | **可信**（评测口径侧）；**它的自测 8:2 / 851 是偏高** | 裁判与正式赛同一份文件：`md5(contestants/runs/land-gui2/engine/referee.py)=md5(land/workspace/engine/referee.py)=545bb2ef009ab344eb9cb149393d29b0`；精简赛 vs 正式赛单挑平均面积逐 bot 对照 `land/challenge-runs/20261003-183117/ratings.md:25-37` 与 `land/results/ratings.md:24-35`：12 个 bot 平均绝对偏差 6.8%、排名 0 逆转 | 分数**无误报**。落差 851→427 全部来自对手组成：按对手拆解（`land/challenge-runs/20261003-183117/results.jsonl` 逐局统计）它对 random 909、greedy 680、sol 142、astra 114。自测 851 vs 精简赛同对手（greedy）680 = **约 +25% 的窄样本偏差**，属自测偏高，不属评测误报 |
| 炸弹人 `bomberman-gui1` | BT 56.44、第 8/11 | **准确**（无超时漏判）；但在 50 ms 上限下**余量极薄、读数易误判** | 首回合豁免见 `contestants/runs/bomberman-gui1/engine/arena.py:129` 与正式赛口径 `bomberman/CONDITIONS.md:39`（「回合预算 50 毫秒（首回合 2000 毫秒）」）；直接证据 `bomberman/challenge-runs/20261003-183608/replays/00002.json` frames[1] `response_ms=[0.745, 486.06]` | 分数**未被高估**：330 局 11 549 个非首回合中仅 5 次故障（0.04%）。反向风险是**略偏低**：精简赛 7 并发（`.../performance.json` `"workers": 7`）在 14 核上跑 10 人档＝70 进程/14 核＝5:1 超卖，正式赛是 4 并发。10 人档 1.584 只建立在**唯一一张地图**（`schedule.json` 10 人档 220 局全为 seed 507854603）上，单图偏差量级待实测 |
| 夺旗 `ctf-gui1` | BT −202、第 12/12 | **可信且偏乐观**（真实值更差）；不存在超时误报 | 耗时充裕：`ctf/challenge-runs/20261003-204338/games/结果.jsonl` 逐局 `max_ms` 统计，它中位 2.95 ms、最差 7.88 ms（全 180 局 0 故障，全员 0 故障）；非确定性来源 `contestants/runs/ctf-gui1/engine.py:85` | 数值**偏乐观**：精简赛 BT 相对正式赛整体向 0 收缩（`ctf/results/ratings.md:7-18` 与 `20261003-204338/games/成绩.md:7-19` 对照，11 个共同选手平均差 54 分、最大 120 分，强手 ratio 0.58–0.84）。按同比例外推，−202 在正式口径下约 **−250 ～ −350**。另：该成绩对应的是 v9 二进制（`ctf/workspace/build/bot-c3105258b3cc`），评测后源码已被自迭代覆盖数个版本，见疑点 3 与 3.5 |

---

## 2. 四个疑点逐条展开

### 疑点 1（炸弹人回合限时矛盾）——结论：属 **(b) 首回合 `initial_ms=2000` 所以合法**，并叠加一个**工具统计口径缺陷**

#### 1.1 `ProcessBot.receive()` 到底怎么判

`contestants/runs/bomberman-gui1/engine/arena.py:58-71`（关键原文）：

```python
def receive(self,turn,limit):
    deadline=self.sent+limit/1000
    try:
        if self.bad.is_set():return None,'io:'+self.failure,0
        stamp,line=self.q.get(timeout=max(0,deadline-time.perf_counter()))
        if line is None:return None,'stdout_closed',max(0,(stamp-self.sent)*1000)
        if stamp<self.sent or stamp>deadline:return None,'timing',max(0,(stamp-self.sent)*1000)
        match=re.fullmatch(rb'(0|[1-9][0-9]{0,5}) ([UDLRS]) ([01])\r?\n',line)
        if not match or int(match[1])!=turn:return None,'protocol',(stamp-self.sent)*1000
        return (match[2].decode(),int(match[3])),'',(stamp-self.sent)*1000
    except queue.Empty:
        if self.bad.is_set():return None,'io:'+self.failure,limit
        if self.p.poll() is not None:return None,'process_exit',limit
        return None,'timeout',limit
```

判罚是**硬的**：`stamp>deadline` 返回 `'timing'`、无响应返回 `'timeout'`，两条都在 `arena.py:132-137` 走 `errors[i]+=1` 并把该 bot 加入本回合 `forfeits`（fail-closed，注释见 `arena.py:136`）。所以 **(a)「只统计不判罚」不成立**，**(c)「超时判定看无响应而不是慢」也不成立**——慢同样判罚。

`limit` 的来源在 `arena.py:129`：

```python
a,err,ms=b.receive(g.turn,initial_ms if g.turn==0 else move_ms)
timings[i]=ms
max_ms[i]=max(max_ms[i],ms)          # arena.py:131 — 无 turn 条件，首回合混入
```

#### 1.2 450 ms 严格只能来自 turn 0

代码级演绎（不是猜测）：`errors=[0,0]` 意味着 1.1 中所有报错分支都没触发；而除 `arena.py:67` 成功分支外，任何 `ms>50` 都必然伴随 `errors>0`。成功分支还要求 `stamp<=deadline`，故 `ms<=limit`。非 0 回合 `limit=50` ⇒ 其 `ms≤50`；`max_ms` 要达到 455 只能来自 `limit=initial_ms=2000` 的 **turn 0**。

直接观察证实（不是演绎）——`bomberman/challenge-runs/20261003-183608/replays/00002.json`：

```
names ['GPT-6 Astra', '你的 bot']   errors [0, 0]   max_ms [1.25, 486.06]
frame turn=1  response_ms [0.7454890001099557, 486.0649360016396]   <- 这一帧记录的是 turn 0 的应答
frame turn=2  response_ms [0.27333600155543536, 40.155053000489715] <- turn 1
frame turn=3  response_ms [0.22980399808147922, 40.16918699926464]  <- turn 2
```

首回合 486 ms、之后稳定 40 ms，与上面的演绎完全吻合。（`frames[k]` 对应 `arena.py:139-140`：`g.step` 之后才 `frame.update(response_ms=timings)`，所以 `turn=k` 的帧存的是第 `k−1` 回合的应答。）

#### 1.3 正式赛口径同样是「首回合 2 秒」，所以没有「本该大量超时」

- `bomberman/CONDITIONS.md:39`：「正式成绩：扩展赛 8930 局，2–10 人每档总权重 1/9，**4 并发，回合预算 50 毫秒（首回合 2000 毫秒）**。……**0 运行错误**。」
- `bomberman/README.md:10`：「每回合限时 50 毫秒（首回合 2 秒）。」
- `ctf/workspace/engine.py:77`：`TIME_LIMITS = (2.0, 0.05)   # 首回合 2 秒，之后每回合 50 毫秒`
- `ctf/RULES.md:56`：「第一回合 2 秒（含程序启动），之后每回合 50 毫秒……」
- `arena/README.md:21`：「每回合限时默认首回合 2 秒、之后 50 毫秒，对机器负载敏感」

`ctf/CONDITIONS.md:11` 的「按每局最慢一回合算……离 50 毫秒的上限都有余量」是**对除首回合以外的回合的观测陈述**（夺旗工具本身就把首回合单独统计，见 1.5），不是「所有回合都 50 ms」的规则。因此**不存在「正式赛用 50 ms 严判就会让 450 ms 变超时」的情形**：首回合 2 s 是写进正式赛口径的。

`environment.move_ms` 是 `arena.py:147-148` 在 `play()` 内部用**实际收到的形参**写出的，因此 `tools/sp/g1.json`/`g2.json` 里的 `"move_ms": 50, "initial_ms": 2000` 就是真判罚阈值（不是 CLI 默认值的回显）。自测产物也证明自测没放宽限时：`contestants/runs/bomberman-gui1/tools/run_seeds.sh:3` 的命令不带 `--move-ms`，8 个 `rs1x.json` 全为 `environment.move_ms=50`、`errors=[0,0]`、`Mine` 的 `max_ms` 355–465 ms（`Base` 只有 0.5–0.8 ms）。

#### 1.4 真正的风险不是「高估」，而是「非首回合贴着上限」且这个事实被 max_ms 掩盖

对 330 局全部 replay 逐帧统计（脚本 `/tmp/an_bomb.py`，样本 11 549 个非首回合）：

| 选手 | 非首回合中位 | p90 | p99 | max | 每局最慢一回合·中位 | ·p90 | ·最差 | >50 ms 的回合 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **你的 bot** | **40.33** | **42.19** | **45.52** | **50.49** | **43.64** | **48.03** | **50.49** | **1** |
| GPT-6 Astra | 2.32 | 5.59 | 18.14 | 23.48 | 14.14 | 19.46 | 23.48 | 0 |
| DeepSeek V4.1 Flash | 1.96 | 3.64 | 6.77 | 20.69 | 7.83 | 11.93 | 20.69 | 0 |
| GPT-6 Sol | 1.74 | 3.31 | 6.47 | 17.19 | 7.69 | 10.83 | 17.19 | 0 |
| Opus 5.5 | 1.36 | 3.01 | 6.11 | 17.65 | 7.23 | 11.03 | 17.65 | 0 |
| GLM 5.3 | 0.69 | 2.58 | 5.71 | 15.37 | 6.71 | 10.77 | 15.37 | 0 |

（其余 MiMo / Kimi / Qwen / 豆包 / Base 非首回合中位 0.83–1.16 ms，最差回合 15.3–17.8 ms，全部 0 越界。）

全部 5 次故障只发生在这一个 bot 身上，且全在 10 人档：

```
error kinds:  你的 bot {'kind:timeout': 4, 'kind:timing': 1}
matches with nonzero errors: 5  -> 00231.json / 00242.json / 00251.json / 00252.json / 00267.json  (均 10 人局)
```

它的非首回合耗时是全体对手的 **17–58 倍**，每局最慢一回合中位 43.6 ms、p90 48.0 ms，即**已经在 50 ms 判罚线内侧运行**。首回合也不便宜：`g1.json` 453.8 ms、`g2.json` 448.7 ms、精简赛里中位 486.4 ms、4 人自测 `tools/r4.json` 达 782.7 ms（仍 < 2000 ms）。

#### 1.5 工具口径缺陷：三场 `max_ms` 语义不一致，这是 450 ms「看起来矛盾」的根源

| 场次 | 是否把首回合计入 `max_ms` | 代码 | 容差 |
|---|---|---|---|
| 炸弹人 | **计入**（无 turn 判断） | `contestants/runs/bomberman-gui1/engine/arena.py:131` `max_ms[i]=max(max_ms[i],ms)` | 无，严格 deadline |
| 圈地 | **不计**（`if turn > 0`） | `land/workspace/engine/referee.py:129-130` `if turn > 0:  # 第 0 回合含进程启动时间，不计入` | `GRACE_MS = 15`（`referee.py:28, 97`，实际阈值 65 ms，注释「do not rely on it」） |
| 夺旗 | **分开统计** | `arena/core.py:166-170` `if self.calls == 1: self.first_seconds = spent else: self.max_seconds = max(...)`；报告见 `core.py:208-213` | 无，严格 deadline；另有 `MAX_STRIKES = 3` 连续失败出局（`core.py:31, 178-182`） |

后果：炸弹人的 `max_ms` 永远等于「首回合冷启动」，把真正危险的 40 ms 完全遮住。而自迭代 harness 的安全判据只看错误数——`contestants/runs/bomberman-gui1/tools/selfplay.sh:43`：

```python
    if f or not d.get('valid_for_scoring', True):
        bad.append(s)
```

`f = sum(errs)`。所以 harness 判定「干净」的门槛是 `errors==0`，**不含任何余量检查**。这解释了模型为什么自述「协议完全干净、不会掉线」——它按 harness 给的字段确实没读到自己每回合 40 ms。属于**工具/口径造成的读数误报**，但不是**分数误报**。

#### 1.6 关于 `汇总.md` 里「10 人档 1.584 低于 Base 2.822」

`bomberman/challenge-runs/20261003-183608/汇总.md:18-28`：10 人档你的 bot 合计分 1.584、第一率 0%，同档 Base 2.822、第一率 0%（Base 也只 0%，但分高 1.8 倍），其余 9 个选手 3.275–8.186。5 次故障分布在 200 局里的 5 局，且 fail-closed 只丢单回合（不判出局），**解释不了 1.584 与 2.822 的差距**。所以 10 人档垫底是真实表现，不是超时误报。但这一档的 220 局**全在同一张地图**（`schedule.json`：`{2: 种子 242073136, 110 局}`、`{10: 种子 507854603, 220 局}`，`distinct seed per size = {2:1, 10:1}`），单图偏差量级待实测（见第 3 节）。

---

### 疑点 2（圈地 851 vs 427）——结论：**配置可比，落差全部来自对手组成；8:2 的自测对正式赛没有预测力**

#### 2.1 两边的引擎与地图配置**完全相同**，所以「不可比」的说法不成立

- 裁判文件同一份：`md5(contestants/runs/land-gui2/engine/referee.py) = md5(land/workspace/engine/referee.py) = 545bb2ef009ab344eb9cb149393d29b0`（实测）。
- 单挑地图尺寸/回合数由 `players` 唯一决定：`land/workspace/engine/game.py:11-20` `DEFAULT_CONFIG = {'width':40,'height':40,'max_turns':600, ...}`；`game.py:28-29` `config_for(players)` 返回 `MELEE_CONFIG if players==4 else DEFAULT_CONFIG`（48×48，`game.py:23`）。自测 1v1 与精简赛 1v1 都走 `DEFAULT_CONFIG`。
- 棋盘**没有随机障碍**，seed 只决定出生点与初始朝向：`game.py:32-60 make_start(seed, cfg)`，`Game.__init__`（`game.py:63-89`）除 spawn 外 `owner` 全为 −1。
- 座位/先后手两边都轮换：精简赛 `land/tournament/round_robin.py:123-125` 每张图 `for swap in (False, True)`；混战 `round_robin.py:141-145` `for rot in range(4)` 全座位轮换。自测 `land/workspace/engine/referee.py:255-262`（`per_map = n`，1v1 换边、混战轮座）。
- 唯一实质差异是 **seed 段与并发**：正式赛 `--maps 200` → seed 1000–1199（`land/CONDITIONS.md:11`「每对 200 张图」）；精简赛 `land/challenge.py:36` `maps, rounds = ("6","12") if full else ("2","4")` → 实测 `results.jsonl` 单挑只出现 `distinct duel seeds: [1000, 1001]`；自测 `referee.py:242` `--seed` 默认 1，`--games 10` → seed 1–5。并发：`land/challenge.py:35` `jobs = str(max(1, min(8, (os.cpu_count() or 2) // 2)))`（本机 `nproc`=14 ⇒ 7）；自测 `referee.py:243` `--jobs` 默认 **1**。

#### 2.2 面积 427 是真实水平，不是窄图抽样造成的

用精简赛（2 图）与正式赛（200 图）的**同一批 bot**做逐 bot 面积对照（`20261003-183117/ratings.md:25-37` vs `land/results/ratings.md:24-35`）：

```
random     chal=108  off= 85  +27.1%      greedy   chal=538  off=501  +7.4%
sol        chal=967  off=847  +14.2%      mimo     chal=900  off=839  +7.3%
sparring   chal=1216 off=1158 +5.0%       mystery  chal=341  off=321  +6.2%
glm        chal=612  off=586  +4.4%       kimi     chal=646  off=623  +3.7%
sonnet-5   chal=1255 off=1229 +2.1%       opus     chal=1025 off=1044 -1.8%
astra      chal=987  off=973  +1.4%       deepseek chal=317  off=315  +0.6%
mean |dev| = 6.8%   max |dev| = 27.1%   rank inversions = 0 / 66
```

2 张图就还原了 200 张图下的面积与**完整名次序**。所以精简赛的 427 不是抽样噪声。

#### 2.3 851→427 的落差按对手逐场拆解，得到决定性答案

对 `land/challenge-runs/20261003-183117/results.jsonl` 的 312 条单挑记录按对手聚合（每对手 4 局＝2 图 ×2 换边）：

| 对手 | 它的面积 | 对手面积 | 胜-负 | 它的被杀 |
|---|---:|---:|---:|---:|
| anchor-random | 909 | 199 | 4-0 | 0.8 |
| mystery-model | 717 | 520 | 4-0 | 1.2 |
| **anchor-greedy** | **680** | 788 | 3-1 | 1.0 |
| kimi-k3 | 594 | 776 | 1-3 | 2.2 |
| deepseek-4.1f | 594 | 416 | 3-1 | 2.8 |
| glm-5.3 | 430 | 948 | 0-4 | 4.0 |
| opus-5.5 | 309 | 1249 | 0-4 | 2.2 |
| anchor-sparring | 259 | 1315 | 0-4 | 4.0 |
| mimo-2.6-pro | 195 | 1328 | 0-4 | 6.0 |
| sonnet-5 | 175 | 1408 | 0-4 | 5.0 |
| gpt-6-sol | 142 | 1275 | 0-4 | 3.8 |
| gpt-6-astra | 114 | 1411 | 0-4 | 9.5 |
| **全部 12 对手** | **427** | 969 | 15-33 | 3.5 |

- 对最弱的 3 档（random / mystery / greedy）它拿 680–909；对 6 个强手只有 114–309（6 强手均值 199）。**面积几乎完全由对手强度决定，与地图尺寸/回合数无关。**
- 自测 851 的对手集是「只有 greedy」。同一对手（greedy）下精简赛给 680，自测给 851 ⇒ 约 **+25% 窄样本/不同 seed 段的乐观偏差**（10 局、seed 1–5、串行单局）。
- 自测命令原文（`contestants/report/compaction-land-gui2.md:235`）：
  ```
  TEST: cd submission && g++ -O2 -std=c++20 bot.cpp -o bot_test; python3 engine/referee.py submission/bot.cpp anchors/greedy.cpp --games 10 [--seed N --replay-dir dbg/replay];
  melee: submission/bot.cpp anchors/greedy.cpp anchors/greedy.cpp anchors/random.cpp --games 4.
  ```
  混战自测的对手池是 **greedy + greedy + random**（两个重复的 greedy 加一个 random），这是全场最弱的 4 人组合。它的混战自测结论「avg rank 2.5」却连这个组合都拿不下第一。
- 混战正式口径（48×48、4 人）：`ratings.md:55` 它平均面积 **152**、平均被杀 **10.0**、第一名 0%、平均名次 3.75；`anchor-random` 是 123 / 5.9 / 3.56，`anchor-greedy` 475 / 5.2 / 2.85。它的 Elo −282 对 random 锚点 −286（`ratings.md:19`）。
- 参赛源文件身份已核对，无张冠李戴：`sha256(land/challenge-runs/20261003-183117/entries/your-bot@you#1/bot.cpp) = sha256(contestants/runs/land-gui2/submission/bot.cpp) = 92ddf4003956…`。

**判定**：属「自测样本太窄导致的乐观偏差」，**不属**「两边配置根本不同、不可比」。8:2 胜 greedy 之所以对正式赛毫无预测力，是因为它按构造就只回答「能不能打赢 greedy」这一个子问题——而第 8 名的成因是它打不过 6 个强手（0-4 全败）和 4 人混战。三场的多人/混战档同时崩盘（圈地混战 −282、炸弹人 10 人档垫底含 Base），这是同一个能力缺陷的两个读数，不是两起误报。

---

### 疑点 3（夺旗非确定性）——结论：**噪声幅度 ≈ 它一整局的平均分；「207:242」作为比分已失去意义**；座位轮换能抵消座位效应但不能抵消 flag_seed

#### 3.1 非确定性来源与不可复现性

`contestants/runs/ctf-gui1/engine.py:79-86`（原文）：

```python
    def __init__(self, n, seed=1, flag_seed=None):
        ...
        self.rng = random.Random(seed)   # 只用来生成地图
        # 旗子出现在哪个旗点用另一个随机数决定，不传时每局现取，不能从地图反推
        self.flag_seed = secrets.randbits(64) if flag_seed is None else flag_seed
        self.flag_rng = random.Random(self.flag_seed)
```

`engine.py:230` 把 `flag_seed` 放进 `header()` 下发给 bot。三个引擎文件与 workspace 正式版**逐字节相同**（`md5`：`engine.py=a2f3162e…`、`core.py=6319158c…`、`arena.py=91e66b86…`，workspace 与 contestants/runs 两侧一致，`diff` 无输出），所以自测、精简赛、正式赛**跑的是同一个带随机的引擎**。

`arena.py batch`（`contestants/runs/ctf-gui1/arena.py:77-88`，原文）：

```python
def batch(specs, games, seed, workers):
    """多局对战：每张地图把座位完整轮换一圈（n 方就是 n 局），再换下一张地图。"""
    ...
    for k in range(games):
        r = k % n
        jobs.append((programs[r:] + programs[:r], names[r:] + names[:r], seed + k // n))
```

轮换只保证**座位/基地**均衡（`seed + k//n` 让 `games = m*n` 时每人坐遍 n 个座位、跨 m 张图）。**它对 `flag_seed` 无能为力**——`batch`/`play` 都调用 `core.run_match(Game, programs, names, seed)`（`arena.py:57, 73`）而不传 `flag_seed`，于是每局 `secrets.randbits(64)` 重摇。结论：`--seed` 相同、命令相同、二进制相同，**同一串自测也不会重现同一比分**。

`ctf/tournament/README.md:15` 主办方已明示这一点：「旗子每次刷新在哪个旗点用的是单独的随机数（每局现取，为了防止从地图反推），**所以逐局比分不会和原赛完全相同**，但总排名应当一致。」`arena/core.py:12` 也注明时限取 `Game.TIME_LIMITS`。

#### 3.2 幅度实测（用既有 180 局的「同图 + 同配对 + 座位互换」配对照出）

精简赛每档 3 张图，2 人档每张图把每对选手换边各打一次（`ctf/challenge-runs/20261003-204338/games/结果.jsonl`）。同 `map_seed`、同两名选手、座位互换的两局之间，**唯一变量就是 flag_seed**（外加座位本身）。这样的配对局共 21 组。节选：

```
size2 map668271260  GPT-6.1 Sol      vs 豆包 Seed 2.1 Turbo   A=(28,25)  B=(37,8)   |dSol|=9  |d豆包|=17
size2 map1746937730 Kimi K3          vs 豆包 Seed 2.1 Turbo   A=(8,3)    B=(39,2)   |dKimi|=31 |d豆包|=1
size2 map1746937730 GPT-6 Astra      vs GPT-6.1 Sol           A=(25,28)  B=(31,23)  winner_changed=True
size2 map1746937730 Fable 5.1        vs Sonnet 5.5            A=(27,24)  B=(24,25)  winner_changed=True
size2 map668271260  DeepSeek V4.1F   vs 你的 bot              A=(26,15)  B=(28,12)  |dDeepSeek|=2 |dbot|=3
size2 map1746937730 Opus 5.5         vs 你的 bot              A=(33,12)  B=(35,16)  |dOpus|=2  |dbot|=4
size2 map1165851475 MiMo V2.6 Pro    vs 你的 bot              A=(21,17)  B=(27,15)  |dMiMo|=6  |dbot|=2
```

统计：单局一方得分的**平均绝对变化 4.14 分、中位 3.0 分**；**21 组里有 2 组（10%）直接翻转胜者**。

而它在整场的**平均每局得分只有 3.98 分**（62 局，标准差 4.56，全 13 人里最低；Base 基准 9.99±5.99，Sol 14.61±7.69）。也就是说：**一次 flag_seed 重抽造成的得分抖动，量级上就等于它一整局的全部得分。**

同时 `结果.jsonl` 记录里没有 `flag_seed` 字段（键只有 `['faults','id','map_seed','max_ms','score','seats','seconds','size','stats','turns']`），所以既有数据无法把这 4.14 分进一步拆成「座位效应」与「落旗随机」两部分——上面的 4.14 是**两者之和的上界**。这是本报告里必须标注的关键不确定项（见第 3 节待实测项 C）。

按每档等权 + BT 平滑（`arena/bt.py`，`成绩.md:3`「区间按地图重抽样 200 次」），每档只有 3 张图时噪声直接进档分：夺旗 5 人档所有人 BT 全面塌陷——

| 选手 | 精简赛 5 人档 | 正式赛 5 人档 |
|---|---:|---:|
| GPT-6 Astra | 9 | 236 |
| Fable 5.1 | 14 | 209 |
| GPT-6.1 Sol | 33 | 185 |
| Sonnet 5.5 | 44 | 156 |
| Opus 5.5 | 8 | 170 |
| DeepSeek V4.1 Flash | 18 | 130 |

强 6 名 5 人档均值：精简 21.0 vs 正式 181.0，**收缩 88%**。这是「每档等权 + 每档 3 图 + flag_seed 逐局重抽」叠加出的系统性衰减，与选手强弱无关。

#### 3.3 「207:242」的可信度

出处：`contestants/report/trace-ctf-gui1.md:80`（模型自述原文）——
`Final state: - submission/bot.cpp = v9 (compiles OK, 10-seed verified: 207:242, net -3.5/game)`。

- 结构上没问题：n=2、games=10 ⇒ 5 张图 × 2 座位完整轮换，座位偏倚已抵消。
- 但对手只有 `baseline`（练习基准，正式赛 BT ≡ 0，见 `ctf/results/ratings.md:13`），与圈地「只打 greedy」、炸弹人「只打 Base」同构——三场自测**全部只打最弱基准**。
- 统计上脆弱：净 −3.5 分/局，而 3.2 测得单局一方得分抖动约 4.14 分（上界，含座位项）。即便按保守 SD≈5 分算，10 局均值的标准误 ≈ 1.6 分/局，−3.5 只有约 2σ；且这 10 局**不可复现**（3.1）。
- 反向校验：它的 207:242（净 −3.5/局、约 0.55 得分率）方向上与精简赛 BT −202（第 12 名、低于基准 9.99 vs 它 3.98）并不矛盾——两边都说它不如基准。所以夺旗这场的问题是**噪声与不可复现**，而不是方向错误。

#### 3.4 一个必须写进视频的时间线问题：−202 已无法用当前代码复现

- 评测产物：`ctf/challenge-runs/20261003-204338/config.json` 指向 `contestants/runs/ctf-gui1/submission/bot.cpp`，`build_dir = ctf/workspace/build`；实际使用的二进制 `ctf/workspace/build/bot-c3105258b3cc`（mtime 20:43，与评测同刻）。
- 当前源码：`sha256(contestants/runs/ctf-gui1/submission/bot.cpp) = b4733ed380f2…`，mtime **21:26**（晚于评测）。构建名内嵌源码摘要（`bomberman/tournament/run.py:39-40` `digest = hashlib.sha256(src.read_bytes()).hexdigest()[:12]`），故 `c3105258b3cc ≠ b4733ed380f2` ⇒ **被评的 v9 源码已被自迭代覆盖**。
- 自述佐证：`trace-ctf-gui1.md:84`（21:12）「v9 was −202 points in the official evaluation, and came in dead last out of 12 players. … the user is giving me an additional 40-minute self-iteration window」。
- 对照另外两场可复现：圈地评测源与当前源 SHA **相同**（`92ddf4003956…`）；炸弹人评测源与当前源 **相同**（`2d9c83320600…`，即 `bomberman/workspace/build/bot-2d9c83320600`；`identity.json` 里 `"你的 bot": "f6161264dbfd…"` 是编译后二进制的哈希）。

#### 3.5 两条独立交叉验证（都支持「夺旗 −202 不是误报」）

**(1) 噪声幅度被 27B 自己独立测到。** `contestants/runs/ctf-gui1/ITERATION_LOG.md` 有一行自测：

```
| v13 vs v13 座位对照 | 同代码不同座位 | 14.5 vs 12.5 | - | 10.8 vs 9.5 | 5.3 vs 4.7 | 确认 ±1.5-2 为座位噪声, ×3 与无×3 差异在噪声内 |
```

它用「同代码、不同座位」的 batch **多局平均分**测得抖动 ±1.5～2 分；我用 180 局的换边配对测得**单局**绝对抖动 4.14 分（3.2）。两者换算自洽（10 局均值的标准误 ≈ 4.14/√10 ≈ 1.3～1.5）。⇒ 3.2 的噪声量级不是我的孤立估计，是被评者自己也得出的结论。

**(2) v9 多人档垫底的成因已被它自己定位，且与评测工具无关。** 同一文件「关键复盘」：

```
1. v9 多人档死因: 中心枪 33 + 围剿 32 永远高于旗任务 ~0.1, 3 单位钉死本基地 350 回合 0 分。SW 门一刀解决"蹲守"问题。
2. 8 方漏斗 (v13, seed5 回放): 我方 pickups=20 与最强 baseline (19-20) 持平, captures 1 vs 13 —— 覆盖率够了, 死在携旗转化…
3. 5 方最稳 (9.0-10.8, 第 3-4 名), 8 方仍有差距 (4.7 vs 7.3), 3 方与基准同池。
```

即：得分低来自**任务优先级写错导致单位蹲守**（`captures 1 vs 13`），不是超时、不是判罚、不是口径。这与 3.3 里 `max_ms` 中位 2.95 ms、180 局 0 故障互相印证。

**版本仍在实时推进**（审计过程中的实测）：`submission/bot.cpp` 的摘要在 21:26 为 `b4733ed380f2`，21:38 已变为 `8b39f1ba5bf6`；同目录新增 `v13.cpp`/`v13a.cpp`/`v13u.cpp`/`v14.cpp` 与 `build/bot-78585060fd24`。⇒ 被评的 v9（`bot-c3105258b3cc`）与当前代码之间已隔数个版本，**−202 只能作为 v9 的历史成绩引用，不可当作「本地 27B 的夺旗水平」**。

---

### 疑点 4（精简挑战赛 vs 正式赛口径差）——结论：**排名同向、数值不同尺度；三场之间配置不统一，其分数不应横向平均**

#### 4.1 配置对照（全部来自代码与产物，非估计）

| 项 | 圈地 | 炸弹人 | 夺旗 |
|---|---|---|---|
| 正式赛规模 | 单挑 26 400 + 混战 3 600（`land/CONDITIONS.md:11-12`） | 8 930 局 2–10 人（`bomberman/CONDITIONS.md:39`） | 32 010 局 2–15 人（`ctf/CONDITIONS.md:55`） |
| 正式赛每档图数 | 每对 200 图，各换边 2 局 | 2–10 人共 9 档等权 | 每种人数 110 图；9–15 人每位选手 2 份同场 |
| 正式赛并发 | 未声明；「全程 0 超时、0 判负」`CONDITIONS.md:13` | **4 并发** `CONDITIONS.md:39` | **性能模式固定 12 并发** `CONDITIONS.md:11` |
| 精简赛人数档 | 单挑全配对 + 4 人混战 | **仅 2、10 两档**（`bomberman/challenge.py:27` `(["2","3","10"],"1") if full else (["2","10"],"1")`） | **仅 2、3、5、8 四档**（`ctf/challenge.py:35` `[2,3,4,5,6,8,10,13] if full else [2,3,5,8]`） |
| 精简赛每档图数 | 2（`land/challenge.py:36`，实测 seeds `[1000,1001]`） | **1**（实测 `distinct seed per size = {2:1, 10:1}`） | 3（`ctf/challenge.py:39` `maps_per_size: 8 if full else 3`） |
| 精简赛并发 | `jobs=min(8,cpu//2)`=7；混战自动减半（`land/challenge.py:35`、`round_robin.py:155`） | 同式默认（`bomberman/tournament/run.py:62`），实测 `"workers": 7`（`performance.json`） | 同式（`ctf/challenge.py:41`），workers=min(8,cpu//2) |
| 精简赛总局数 | 376（312 单挑 + 64 混战） | 330（110 + 220） | 180 |
| 分数尺度 | **greedy=0、该模式最强=100 归一化**（`land/ratings.md:3`） | **BT 400×log10、基准=0 不封顶**（`bt.json` `"scale": "400 * log10(strength / baseline_strength)"`） | 同 BT（`成绩.md:3`） |
| copies | — | — | 精简 `copies:1` vs 正式 9–15 人每位 2 份 |

本机 `nproc = 14`（实测）。⇒ 炸弹人精简赛 10 人档 = 7 workers × 10 进程 = **70 进程 / 14 核（5:1 超卖）**，而正式赛 4 并发 = 40 进程 / 14 核（2.9:1）。这是唯一一处精简赛比正式赛**更**惩罚慢 bot 的地方，方向是让它**偏低**而非偏高。

#### 4.2 同向性：三场都有可查的实证

- **炸弹人**：主办方自己做过「档位覆盖不全」的对照——`bomberman/results/vs-original-2600.md`：只打 2/5/10 三档的 2 600 局版本 vs 覆盖 2–10 九档的 8 930 局版本，**10 个名次逐一完全相同**，BT 差值 0.6～28.8 分（最大 DeepSeek 241.87→270.71 = 28.8；GLM 162.90→175.04 = 12.1；豆包 105.30→95.40 = 9.9；Base 0→0）。⇒ 少打 6 个档**不改名次**，BT 数值误差量级 **±10～30**。
- **圈地**：2 图 vs 200 图，12 个 bot **面积平均偏差 6.8%、名次 0 逆转**（2.2）。
- **夺旗**：4 档 × 3 图 vs 14 档 × 110 图，11 个共同选手 **名次逆序仅 2/55**（Fable↔Sol 争第 2–3、MiMo↔Qwen 争第 7–8），前 6 名集合完全一致；BT **平均绝对差 54 分、最大 120 分**，强手被压缩到 0.58–0.84 倍（Sol 252→146、Opus 196→120、豆包 −307→−187）。置信区间宽度：正式赛约 ±10（`results/ratings.md:7`「246 ~ 263」），精简赛 ±45～95（`成绩.md:19`「−251 ~ −156」）⇒ **不确定性放大约 5～10 倍**。

**综合判断**：精简挑战赛与正式赛**同向（名次可用）**，但**数值不可直接对齐正式赛**：圈地偏差量级 ~7%（面积），炸弹人 ~±30 BT，夺旗 ~±54（极值 120）BT 且存在向 0 的系统性收缩。夺旗的 −202 应按「正式口径下更负（约 −250～−350）」理解（此为按 11 人共同比值的外推，标注为**推断**）。

**三场之间配置不统一**（4.1 表）：人数档覆盖 2 档 / 4 档 / 全部单挑配对，每档图 1 / 2 / 3 张，并发虽同为 7 但每进程负载差 5 倍，分数尺度两种（归一化 0–100 与 BT 无界）。⇒ **4.7 / 56.44 / −202 三个数不存在共同单位，任何"总分/平均"都是伪量纲**。这一点项目文档本身已经写明，应在视频里保留：`land/CONDITIONS.md:44`「这和第 2、3 集"基准 = 0、不封顶"的口径不同，**分数不能跨集直接比较**」；`contestants/report/scores.md:9` 同一警告。三场唯一可比的公共维度是**名次**和**相对基准的位置**。

#### 4.3 与工具相关的两处真实偏差（都指向「自测高估」，不是「评测高估」）

1. 炸弹人 `max_ms` 含首回合（1.5），圈地/夺旗不含 ⇒ 只有炸弹人会报出 400–800 ms 这种"看着超限"的数；且炸弹人 harness 的安全门是 `errors==0`（`selfplay.sh:43`），无余量检查 ⇒ 模型无从得知自己每回合 40 ms。
2. 圈地 `GRACE_MS = 15`（`land/workspace/engine/referee.py:28, 97`）使圈地实际判罚线是 65 ms，比炸弹人/夺旗的严格 50 ms 松 30%。**本场无实际影响**（`results.jsonl` 里它 `max_ms` 最大 2.9 ms，全体 bot `超时 0 / 判负 0`，见 `20261003-183117/ratings.md:25-37, 43-55`），但口径确实不同，写结论时应注明。
3. 夺旗无任何工具嫌疑：`结果.jsonl` 逐局 `max_ms` 中位 2.95 ms、最差 7.88 ms，180 局 `faults` 合计 0（全 13 人 0 故障，400 回合跑满），离 50 ms 上限有 6 倍余量。它的 −202 是纯棋力问题。

---

## 3. 待实测项（我未执行，夺旗停手且 CPU 空闲时由你跑）

所有命令从 Windows 侧 Git Bash 调用，已用 heredoc 规避 `$`/引号问题。**先确认没有别的负载（27B 服务空转或暂停）**，否则 1/2/5 的结论会被负载污染。

**A. 拆出炸弹人「非首回合」的真实耗时，判定 40 ms 是自身复杂度还是并发放大（最高优先）**

```
wsl -d Ubuntu-22.04 bash -s <<'EOF'
cd $HOME/deepseek-harness/workplace/meow-ai-arena/contestants/runs/bomberman-gui1
BD=$HOME/deepseek-harness/workplace/meow-ai-arena/bomberman/workspace/build
# 用被评的那两个二进制本体，避免版本歧义：
#   Mine = $BD/bot-2d9c83320600          （= schedule.json 里「你的 bot」的 bot_spec）
#   Base = $BD/baseline-a4ca3e21d2f8     （= schedule.json 里「Base」的 bot_spec）
python3 engine/arena.py --bots "Mine=$BD/bot-2d9c83320600" "Base=$BD/baseline-a4ca3e21d2f8" \
  --seed 13 --replay /tmp/bomb_serial.html > /tmp/bomb_serial.json 2>&1
python3 - <<'PY'
import json, statistics as st
d=json.load(open('/tmp/bomb_serial.json')); f=d['frames']; n=d['result']['names']
for who in range(len(n)):
    v=[fr['response_ms'][who] for fr in f[2:] if fr.get('response_ms')]  # f[1]=turn0 -> 跳过
    print(n[who], 'turns>0: median=%.2fms p90=%.2fms max=%.2fms' % (
        st.median(v), sorted(v)[int(0.9*len(v))], max(v)))
PY
EOF
```
判据：串行单局下 `Mine` 的 **turn>0 中位**。若 ≤10 ms ⇒ 精简赛那 40.3 ms 主要由 7 并发超卖放大 ⇒ 正式赛（4 并发）下它更安全，**BT 56.44 属偏低**；若仍 35–45 ms ⇒ 是它自身算法开销，**56.44 准确但脆**，换台慢机器就会大面积超时。

**B. 炸弹人 10 人档是否被「唯一一张图」压分（换 3 张图重跑）**

注：`submission/bot.cpp` 的 SHA 前 12 位是 `2d9c83320600`，与已存在的 `bomberman/workspace/build/bot-2d9c83320600` 一致，而 `tournament/run.py:41` 是 `if not exe.is_file()` 才编译 ⇒ **这条命令不会触发 g++**（前提是你没再改 bot.cpp）。`FORMAL` 元素含空格（如 `GPT-6 Astra=…`），必须用 bash 数组传，不能用字符串拼接。

```
wsl -d Ubuntu-22.04 bash -s <<'EOF'
cd $HOME/deepseek-harness/workplace/meow-ai-arena/bomberman
mapfile -t FORMAL < <(python3 -c "
import sys; sys.path.insert(0,'tournament')
from run import FORMAL
print('\n'.join(FORMAL))")
echo "opponents: ${#FORMAL[@]}"
python3 tournament/run.py --output /tmp/bomb_multi \
  --bots "你的 bot=../contestants/runs/bomberman-gui1/submission/bot.cpp" "${FORMAL[@]}" \
  --sizes 10 --seeds 3 2>&1 | tail -25
EOF
```
判据：读 `/tmp/bomb_multi/汇总.md` 的 10 人档「场均合计分」。原值 **1.584（Base 2.822）**。若换图后升到 ≥2.8（追平 Base）⇒ 单图偏差显著，56.44 **偏低**；若仍 <2.0 ⇒ 10 人档垫底为真，与图无关。

**C. 夺旗 flag_seed 噪声的方差分解（把座位效应从落旗随机里摘出来）**

```
wsl -d Ubuntu-22.04 bash -s <<'EOF'
cd $HOME/deepseek-harness/workplace/meow-ai-arena/contestants/runs/ctf-gui1
python3 - <<'PY'
import sys; sys.path.insert(0,'.')
import core
from engine import Game
B='submission/bot.cpp'; L='../../ctf/workspace/baseline.cpp'
def go(seed, fs, order):
    G=Game(2, seed=seed, flag_seed=fs)                      # 显式固定 flag_seed
    res,_=core.run_match(Game,[core.command_for(__import__('pathlib').Path(x),
        __import__('pathlib').Path('build')) for x in order[0]], order[1], seed, record=False)
    return dict(zip(order[1], res['score']))
seeds=range(1,11); fsx=[7,99,12345]
import itertools, statistics as st
rows=[]
for s in seeds:
  for f in fsx:
    a=go(s,f,([B,L],['bot','base'])); b=go(s,f,([L,B],['base','bot']))
    rows.append((s,f,a['bot'],b['bot']))
same_seat=[x[2] for x in rows]; diff_seat=[x[3] for x in rows]
print('flag_seed-only spread within (same seat, same map):')
for s in seeds:
    v=[x[2] for x in rows if x[0]==s]; print('  seed',s,'scores across 3 flag_seed draws:',v,'spread',max(v)-min(v))
print('mean spread =', st.mean([max(x[2] for x in rows if x[0]==s)-min(x[2] for x in rows if x[0]==s) for s in seeds]))
PY
EOF
```
判据：同 seat、同 `map_seed`、只改 `flag_seed` 的三次抽样之间的得分极差。若极差均值 <1 分 ⇒ 4.14 分主要是**座位效应**，flag_seed 无罪，「207:242」只是样本小；若 ≥3 分 ⇒ 落旗随机本身就是主噪声源，**任何 10 局自测比分都不具备可解释性**。

**D. 圈地：把自测的 seed 段换成精简赛的 seed，验证 851→680 是地图还是样本量**

```
wsl -d Ubuntu-22.04 bash -s <<'EOF'
cd $HOME/deepseek-harness/workplace/meow-ai-arena/contestants/runs/land-gui2
python3 engine/referee.py submission/bot.cpp anchors/greedy.cpp --games 10 --seed 1000 2>&1 | tail -15
EOF
```
判据：平均面积。自测（seed 1 起）851、精简赛（seed 1000/1001）680。若改 seed 后落到 ~680 ⇒ 差值纯属 **seed/出生点抽样**；若仍在 ~850 ⇒ 差值来自并发（自测 `--jobs 1` vs 精简赛 7）或对手二进制版本，需另查。

**E. 并发敏感度：同一批 2 人档，workers 1 与 7 各跑一次比 BT**

```
wsl -d Ubuntu-22.04 bash -s <<'EOF'
cd $HOME/deepseek-harness/workplace/meow-ai-arena/bomberman
mapfile -t FORMAL < <(python3 -c "
import sys; sys.path.insert(0,'tournament')
from run import FORMAL
print('\n'.join(FORMAL))")
for w in 1 7; do
  python3 tournament/run.py --output /tmp/bomb_w$w \
    --bots "你的 bot=../contestants/runs/bomberman-gui1/submission/bot.cpp" "${FORMAL[@]}" \
    --sizes 2 --seeds 1 --workers $w >/tmp/bomb_w$w.log 2>&1
done
for w in 1 7; do echo "== workers=$w =="; python3 -c "
import json;d=json.load(open('/tmp/bomb_w$w/bt.json'))
for k,v in sorted(d['ratings'].items(), key=lambda x:-x[1]): print('  %-22s %.2f'%(k,v))
print('  valid_games_by_size', d['valid_games_by_size'])"; done
EOF
```
判据：两次 BT 差值。>20 分 ⇒ 精简赛的并发设置本身参与决定了它的名次，横向比三场必须统一 workers。

**F. 复现夺旗当前代码 vs 被评 v9 的差距（因为当前 bot.cpp 已 ≠ 评测版本）**

```
wsl -d Ubuntu-22.04 bash -s <<'EOF'
cd $HOME/deepseek-harness/workplace/meow-ai-arena
sha256sum contestants/runs/ctf-gui1/submission/bot.cpp
ls -la ctf/workspace/build/ | grep -E 'bot-[0-9a-f]{12}'
EOF
```
判据：确认当前源摘要（现 `b4733ed380f2`）是否等于评测所用 `bot-c3105258b3cc`。不等 ⇒ −202 只能代表 v9；要用当前代码出分需重跑 `python3 ctf/challenge.py contestants/runs/ctf-gui1/submission/bot.cpp`（会覆盖新目录，不影响旧成绩）。

---

## 4. 实证 vs 推断

**我亲眼从代码/数据证实的**（均可复查到具体行号或产物字段）：

1. `contestants/runs/bomberman-gui1/engine/arena.py:58-71` 的超时/慢判是**硬判罚**（`'timing'` 与 `'timeout'` 都 `errors+=1` 并 forfeit，`arena.py:132-137`）；`arena.py:129` 只在 turn 0 用 `initial_ms`；`arena.py:131` 的 `max_ms` **无条件含首回合**。
2. `bomberman/CONDITIONS.md:39` 正式赛口径为「50 毫秒（首回合 2000 毫秒）、4 并发、0 运行错误」；`ctf/workspace/engine.py:77`、`ctf/RULES.md:56`、`arena/README.md:21` 同口径；⇒ 450 ms 合法，不存在「本该大量超时」。
3. `tools/sp/g1.json`/`g2.json`：`move_ms=50`、`initial_ms=2000`、`errors=[0,0]`、`max_ms=[453.8,459.0]/[448.7,453.8]`、`diagnostics=[]`、`turns=227`、`valid_for_scoring=true`。8 个自测 `tools/rs1{1..8}.json` 同样 `errors=[0,0]`、`max_ms` 355–465 ms（Base 0.5–0.8 ms）、`environment.move_ms=50`。
4. 330 局逐帧统计：「你的 bot」非首回合中位 40.33 ms / p99 45.52 ms / max 50.49 ms，其余 10 个 bot 非首回合中位 0.69–2.32 ms；每局最慢一回合中位 43.64 ms、p90 48.03 ms；全场 5 次故障 100% 集中在它、100% 在 10 人档（`timeout`×4 + `timing`×1）。
5. `replays/00002.json` 直接显示 turn 0 应答 486.06 ms、turn 1 起 40.15 ms（同帧同数组，非推断）。
6. 圈地裁判/引擎与正式赛**同一份**（md5 相同）；单挑 40×40 / 600 回合由 `game.py:11-29` 按人数固定；`results.jsonl` 实测单挑只含 seed 1000/1001；按对手聚合面积 909/680/309/114… 全表；12 bot 精简 vs 正式面积 mean|dev|=6.8%、0 名次逆转；评测源 SHA 与当前源一致。
7. `engine.py:85` `flag_seed = secrets.randbits(64)`、`engine.py:83` 注释「只用来生成地图」、`engine.py:230` 下发 `flag_seed`；`arena.py:77-88` batch 只轮换座位、`run_match` 不传 `flag_seed`；`结果.jsonl` 键集合无 `flag_seed`；21 组换边配对 mean|Δ|=4.14 分、中位 3.0、胜者翻转 2/21；它 62 局平均得分 3.98、SD 4.56。
8. 夺旗 `max_ms` 中位 2.95 ms、最差 7.88 ms、180 局 0 故障；三场并发实测 7（`performance.json`），本机 14 核；炸弹人每档仅 1 张图（`schedule.json`）；`ctf/tournament/README.md:15` 与 `scores.md:9`、`land/CONDITIONS.md:44` 的原文警告。
9. `ctf/challenge-runs/20261003-204338/games/成绩.md` 与 `ctf/results/ratings.md` 的 BT 对照：mean|diff|=54、max=120、名次逆序 2/55、5 人档强手收缩 88%。
10. `bomberman/results/vs-original-2600.md`：3 档 vs 9 档 **名次 1–10 完全相同**，BT 差 0.6–28.8。

**我推断的（未直接实测，请标注不确定性）**：

- 夺旗 −202 在正式赛口径下约 **−250～−350**：按 11 个共同选手的精简/正式 BT 比值（0.58–0.84，豆包 −187→−307 即 ×1.64 放大）外推。
- 4.14 分的配对差**同时含座位效应**，因为 `结果.jsonl` 没有 `flag_seed` 字段、无法分离 ⇒ 真实落旗随机噪声 ≤ 4.14 分。待实测项 C 才能定论。
- 炸弹人「偏低」的方向：正式赛 4 并发 < 精简赛 7 并发 ⇒ 超卖更少、对它更有利；但「更有利多少」依赖待实测项 A/E 的数值。
- 圈地自测 851 与精简赛 680 的 +25% 差**可能**来自 seed 段（自测 seed 1–5 vs 精简赛 1000/1001）或 `--jobs 1` vs 7，未分离。待实测项 D。
- 「三场自测全部只打最弱基准 ⇒ 无预测力」是**结构性论断**：三次自测的对手集已用原文证实（`compaction-land-gui2.md:235` greedy；`run_seeds.sh:3` Base；`trace-ctf-gui1.md:80` baseline），但「若自测改打强手会预测到第 8/12 名」属推断。
- 待实测项 A 的两个分支结论（偏低 vs 准确但脆）我目前**没有足够证据二选一**，因为缺 turn>0 的串行数据；本报告不就 56.44 的高估/低估下定论，只判定「不存在 450 ms 导致的高估」。
