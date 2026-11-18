# arena-video · 数据驱动的解说视频分镜工程

把「AI 算法对抗大赛 · 本地 27B 参赛」（圈地 / 炸弹人 / 夺旗三场）的比赛数据，
做成一套**可录屏成片的 HTML 分镜演示页 + 口播逐字稿**。

- **画面是口播的配图，不是阅读材料**：每页一个主视觉（内联 SVG 图），屏幕字集中放在 `.screen` 里，
  `check.mjs` 断言每页 ≤80 字符。技术细节撤到简介 / 置顶评论 / 本文件。
- 数据是单一事实来源：token 账、成绩、逐回合比分、看表记录**全部来自 `data/`**，构建时注入页面，HTML 里不手抄。
- 版式 2026-10-04 从深色底翻成**浅色（暖米纸 + 红黑构成主义）**，代码块保留深底当剪报。
- 双击 `index.html` 即可打开（`file://` 直接可用，无外部依赖、无需起服务）。

> 本工程构建**只到生成 `index.html` 为止**：不录屏、不渲染成片、不评分、不改也不编译参赛代码。
> 评测（`challenge.py --full`）是单独一步，只读比赛项目、结果写进它自己的 `challenge-runs/<时间戳>/`。

---

## 目录结构

    arena-video/
      script/
        口播稿.md                 ★ 24 页逐字稿（画面 / 屏幕字 / 口播 / 必现数字），他逐字审，是硬卡点
      data/                     数据层（从 WSL 比赛项目只读复制而来，勿手改）
        stats.json                三场 token / 请求 / 压缩 / 报错账单（含加时）
        trace-{land,bomberman,ctf}-gui*.md   逐回合轨迹（步号 · 时刻 · 耗时 · token），正赛/加时按 turn 切
        time-cost.json / .md      逐步时间归因（活动类别占比、长考步、墙钟/有效工时）→ 时间去向页
        clock-reads.json          看表逐条记录（时刻 / 阶段 / 是否单独 / 调用方式 / 读数）→ 彩蛋页
        ctf-diag8-scores.json     夺旗八方局逐回合比分（diag8.json 401 帧抽稀成 81 点 × 8 方）→ 第 17 页折线
        legacy-scores.json        只留「不是评测成绩」的事实：模型自测读数、版本链、噪声量级、memcpy / 权重等源码常量
        challenge-full.json       ★ 大样本复核结果（challenge.py --full），由 full2json.mjs 解析生成
        ctf-faults.json           ★ 夺旗段错误的分档分布（ctf-faults.py 从逐局 结果.jsonl 数出来，成绩表只有总数）
        bomb-noise.json           ★ 炸弹人同赛程只差并发的逐局终分比对（旧 w7 批次，490 局里 273 局不同）
        bomb-blind-zone.json      ★ 十人档逐局回放数出来的「死在火焰盲区」比例：正赛版 79.4% vs 同局九家 50.4%
        compaction-evidence.json  ★ 三份 trace 逐行解析出的压缩取证（含每条命中的原文）+ .md 人读版
        compaction-page.json      ★ 上面那份的筛选结果，第 23 页只读它（不手抄数字）
        session-recovery-probe.json ★ 原始 session 日志（zstd 多帧）里回读工具的真实调用计数
        clip-candidates.json      ★ 177 局本机回放的节目效果打分（第 25 页之前的录屏候选）
        full-src/                 上面那份 JSON 的原始成绩表（从 challenge-runs 拷来留证，勿手改）
        compaction-counts.md      压缩次数权威计数（正赛 10 / 含加时 18）
        score-integrity.md        成绩完整性审计（误报在自测里；三场配置不统一）
        failure-analysis.md       三场成败归因（能力 vs 环境、自我纠错实例）
        scores.md                 成绩 / 用时 / 思考语言 /「加时赛」一节
        land-challenge-ratings.{md,json}   圈地·本机参赛轮成绩
        bomberman-bt.json / bomberman-汇总.md   炸弹人·本机参赛轮 BT 与对战统计
        official/                 三场正式赛参照成绩（更大样本，不含本机 27B）
        prompts/*.txt             三场提示词原文（画面已不用，留作出处）
        llama-launch.bat          llama.cpp 启动参数（原样抄，一字未改）
      src/                      分镜构建源（五件套）
        p_top.txt                 文档头 + <style> 开
        p_style.css               浅色主题 / 大字号 / 2560×1440 / 红黑构成主义 + SVG 图元样式
        p_mid.txt                 闭合样式 + body 骨架（HUD / 擦除转场 / stage / 落幕）+ 数据注入点
        p_script.js               数据访问层 + SVG 图元库 + 24 页构建 + 翻页/纯净屏/全屏/落幕交互
        p_end.txt                 闭合标签
      build.mjs                 拼五件套 + 把 data/ 注入为 window.__DATA__ → index.html
                                （注入时解析：按 turn 号切正赛/加时、裁 time-cost 聚合、汇总看表记录、
                                  读入 full 大样本与 legacy 小样本两张成绩表）
      index.html                构建产物（勿手改，改 src/ 后重建）
      dubbing/字幕.txt            全片口播文案（TTS 输入；由 pipeline/dub.mjs 从稿子生成，勿手改）
      logs/ot*.log                大样本评测的运行日志（进度与局数计数）
      pipeline/
        check.mjs                 全量体检：构建一致性 + 数据口径交叉校验 + 无浏览器渲染断言 + 文案/文档同步
        layout.mjs                版式体检：无头 Chrome + CDP 逐页量内容底边（走 ?anim=0，量的是终态）
        anim-probe.mjs            入场动效实测：无头 Chrome 里按 40ms 采样首根条宽度 / 折线 dashoffset
                                  （用法 node pipeline/anim-probe.mjs 13 ".fig svg .lnpath"）
        shot.mjs                  逐页截图：node pipeline/shot.mjs 1,4,17 → %TEMP%/arena-shot/pNN.png
        full2json.mjs             解析 data/full-src/ 的成绩表（含 bomb-ctl* 三组）→ data/challenge-full.json
        ctf-faults.py             从夺旗逐局 结果.jsonl 数段错误（分档 / 报错原文 / 最慢回合）→ data/ctf-faults.json
        bomb-noise.mjs            比对炸弹人两组同赛程、只差并发的 results.json，数终分不同的局数 → data/bomb-noise.json
        bomb-blind-zone.py        扫十人档回放，按 memcpy 截断线（第 313 格）分桶数本机与同局对手的炸死 → data/bomb-blind-zone.json
        compaction-evidence.mjs   解析 data/trace-*.md：折叠事件 / 重放税 / 两类探针，每条命中贴原文 → data/compaction-evidence.{json,md}
        compaction-page.mjs       把 evidence 筛成第 23 页的形状（剔掉「写 README」冒充「读 README」这类误报）→ data/compaction-page.json
        session-recovery-probe.mjs 流式解 WSL 的 session.v4.jsonl.zstd，按真名数回读工具的调用 → data/session-recovery-probe.json
        clip-mining.mjs           扫本机参与的全部回放，按节目效果打分排序 → data/clip-candidates.json
        dub.mjs                   从 script/口播稿.md 生成 dubbing/字幕.txt（页码分节 + 按 3.74 字/秒粗排时间）
        bomb-ctl.py               炸弹人固定赛程对照：直接调 evaluate.py 传 --seed，三组各只动一个变量
        ot3_bomb_w2.py            （已被 bomb-ctl.py 取代）炸弹人 full 档 --workers 2 复跑，未钉赛程
        ot3-wait-run.sh           等前面的评测退出后再启动下一轮，避免并发抢核
        cuts.json                 剪辑表（单一数据源，当前为空，待录屏后填）
        _scriptcheck.mjs          稿子体检：禁词 / 页码连续 / 每页屏幕字 ≤80 / 口播字数与时长
        _syncsecs.mjs             按 3.74 字/秒把稿子里每页「口播（N 秒）」标注同步成实测值
      README.md                 本文件

---

## 快速开始

    node build.mjs                        从 src/ + data/ 重建 index.html
    node pipeline/check.mjs               全量体检（退出码非 0 即有 FAIL）
    node pipeline/layout.mjs              版式体检（1920×1080 逐页量底边；有破版页则退出码 1）
    node pipeline/shot.mjs 1,4,13,17,19   截代表页看图（2560×1440，与成片同构图）
    node pipeline/_scriptcheck.mjs        稿子体检（禁词 / 屏幕字 / 时长账）
    node pipeline/dub.mjs                 改完稿子重排字幕（dubbing/字幕.txt 是产物，别手改）

三道门都要过：`check.mjs` 管事实与口径，`layout.mjs` 管真溢出，`_scriptcheck.mjs` 管稿子。

> `check.mjs` 里「每页 ≤1,700 字符」只是代理指标：2026-10-04 有 4 页字符数达标却实际溢出视口（第 10 页超出 488px）。
> 真正的门槛是 `layout.mjs`——它等 `document.fonts.ready` 之后再量，中文 webfont 加载前后的差异不会被漏掉。

录最终成片时，URL 加 `?clean=1` 隐藏底部 HUD；或放映中按 `F`。

### 键位（沿用 llm-html2video 约定）

    → / 空格 / PageDown   下一页       ← / PageUp   上一页
    Home / End            首页 / 末页   1-9          跳到对应页
    F                     纯净屏：隐藏底栏 + 隐藏鼠标（不走浏览器全屏 → 无「按 Esc 退出全屏」提示条）
    P                     当前内容块「假全屏」铺满窗口（同样不走浏览器全屏）
    末页 → / 点击          拉绳落幕：黑红幕布垂落 → 纯黑（Esc / ← 复位可重录）

---

## 录屏（整片自动）

    index.html?cue=1&auto=1&clean=1

- \`cue=1\`：页面元素按 \`data/cues.json\` 的配音时间轴逐个淡入——进页时标题先就位，屏幕字 → 卡片 → 事实卡 → 口径注依次出现，每页从该页时长的 6% 起、到约 61% 止。
- \`auto=1\`：每页播完自动翻下一页（时点取自配音实测时长），整片 15.2 分钟一条龙，中途不用碰键盘。
- \`clean=1\`：隐藏底部 HUD（等同按 F）。

单页补录就去掉 \`auto\`，进页与那一段配音同时起表。

## 页面清单（27 页）

| # | 页 | 主视觉 | 数据来源 |
|---|---|---|---|
| 01 | 开场 · 选手登场 | 云端模型一排 + 本机形象位 | 内联（`.ava` 是 27B 角色图占位，待补） |
| 02 | 开场 · 本地环境 | 四张配置卡 + 时限对照大字 | 环境事实 + `data/llama-launch.bat` |
| 03 | 开场 · 三场规则 | 三个真机画面视频槽 | 规则事实（待录屏填 cuts.json） |
| 04 | 开场 · 正赛的 token 账 | 横向条形（本机三场 vs 云端区间） | `splits.reg` + 官方赛后复盘表 |
| 05 | 圈地 · 34.9 分钟长考 | 时间轨道，长考段涂黑 | `splits.land` + `time-cost.topSteps` |
| 06 | 圈地 · 交卷 | 同表横比柱（十家） | `challenge-full.land.main.ratings` |
| 07 | 圈地 · 自测 851 对评测 427 | 两根条对照 | `land-areas.json` + `legacy.land.selftest` |
| 08 | 圈地 · 加时七版全负 | 左两张策略卡 + 右横比柱（本机两根：正赛版 / 加时终版） | `challenge-full.land.{main,ot}.ratings` |
| 09 | 炸弹人 · 41 分钟 11 次报错 | 时间轨道 + 报错点密集段 | `time-cost.errTimes`（逐条时刻） |
| 10 | 炸弹人 · 交卷 | 同表横比柱（十家），基准虚线 | `challenge-full.bomb.ctl_ctlmain.ratings`（与标题同表） |
| 11 | 炸弹人 · 两档赢人多的那档输 | 分档六根条（本机 + 基准各三） | `challenge-full.bomb.ctl_ctlmain.bySize` |
| 12 | 炸弹人 · 四版才摸到根因 | 左两张策略卡 + 右横比柱（本机两根，钉同一套赛程） | `bomb.ctl_{ctlmain,ctlot}.ratings` |
| 13 | 炸弹人 · 半张棋盘看不见火 | 人数—格数折线 + 25×25 棋盘后 313 格灰掉 + 代码行 | `legacy.memcpy` + 引擎边长公式现算 |
| 14 | 夺旗 · 十四分钟十一次看表 | 时间轨道 + 11 个看表点 | `clock-reads.ctf` |
| 15 | 夺旗 · 交卷 | 同表横比柱（十二家），负值向左 | `challenge-full.ctf.main.ratings` |
| 16 | 夺旗 · 54 局全是两方局 | 54 格实心 + 3/5/8 方档空框 | `legacy.ctf.main.selftestGames` |
| 17 | 夺旗 · 三个单位钉在家里 | 八方局逐回合折线 + 正赛 / 加时两张策略卡 | `ctf-diag8-scores.json` + `legacy.weights` |
| 18 | 夺旗 · 负 327 变负 108 | 同表横比柱（本机两根：v9 / v13） | `challenge-full.ctf.{main,ot}.ratings` |
| 19 | 收尾 · 名次折线 | 三点三线（正赛→加时）+ 事实卡（换代码 / 名次 / 十人档） | `challenge-full.bomb.ctl_*` + `challenge-full.*.{main,ot}` + `bomb-noise.json` |
| 20 | 收尾 · 两本账 | 正赛 / 加时两栏表 | `splits`（步数 / token / 工时 / 报错 / 压缩） |
| 21 | 收尾 · 时间去向 | 三条分类色带 | `time-cost.categories` |
| 22 | 收尾 · 缺的不是时间 | 本机三场 vs 正式赛区间条 | `splits.reg.minutes` |
| 23 | 收尾 · 主动压缩的代价 | 四根探针条（两条读数为 0） | `compaction-page.json`（筛自 `compaction-evidence.json`） |
| 24 | 附录 · 靠谱的执行模型 | 三场看表轨道 + 方式计数 | `clock-reads`（逐条，页面复算） |
| 25 | 完 · 拉绳落幕 | 大字 + 幕布 | — |

> 页数 23 → 24：删掉冷开场与「口径」整页（时限、外壳、样本量在第 02 页已摆明，观众看得出不可比），
> 新增正赛 token 账、名次折线、两本账、看表彩蛋四页；八方局那段画面从冷开场挪到第 17 页。

---

## 与 llm-html2video 复用了哪些约定

- **五件套拼装**：`p_top / p_style.css / p_mid / p_script.js / p_end` 拼成单个 `index.html`；构建前 `node --check p_script.js`。
- **纯净屏 F / 假全屏 P**：都不走浏览器原生全屏，避免录屏里出现「按 Esc 退出全屏」提示条。
- **斜切擦除转场**：切页三层色带 skewX 擦除（浅底版中间层换成纸白）。
- **拉绳落幕**：末页灯绳下拉 → 黑红幕布垂落 → 纯黑，Esc/← 复位可重录。
- **剪辑表单一数据源**：`pipeline/cuts.json` 字段与旧工程一致。
- **字幕.txt → IndexTTS**：`Xs 文案` / `XminYs 文案` 每句一行，`#`/`【` 分节行被解析器跳过（用于标注页码）。
- **中文字体**：绝对路径引用 `llm-html2video/NotoSansSC-Regular.otf`，不复制 8MB 字体。

> 当前**没有任何录屏**，视频槽（`[data-clip]`）显示「待录屏」条纹；27B 角色图未到位，`.ava` 是虚线占位框。

---

## 待补清单（TODO）

1. **实机录屏（真机拍的，不是回放）** —— 页面里还挂着 REC 占位的就是这些：
   - 第 03 页三个「加时实况」槽：`land` / `bomb` / `ctf`（三场各录一段真机跑起来的画面）
   - 第 09 页 `bomb_term`：41 分钟里 11 次编译报错的终端实况
   - 第 13 页 `bomb_main_run` / `bomb_ot_run`：同一套赛程、只差代码的两版各跑一段
   回放类（`land_duel` / `ctf_zero` / `ctf_duel` 与炸弹人四条）已由 Qoder 侧出片接进 `clips/`。
2. **炸弹人四条回放重录** —— 旧片是改模板前录的，已请 Qoder 按新模板重出（`bomb_solo` / `bomb_melee` / `bomb_ot` / `bomb_blind`）。
3. **配音与字幕** —— 日语稿与 TTS 已出（`script/口播稿.ja.md`、`dubbing/tts_clips/`、`dubbing/字幕.srt`、`data/cues.json`），
   整片 15.2 分钟；**合入成片留到最后一步**，`dubbing/字幕.*.txt` 都是 `pipeline/dub.py` 的产物，别手改。
4. **合成** —— 需要 ffmpeg 时用 WSL 里的 `/home/altair/mamba/envs/ninfer/bin/ffmpeg`（9.0.2，带 libx264 / aac / libvpx），不必另装。

---

## 数据口径提醒（重要）

### 三场之间
- **三个总分没有共同单位**：圈地是「greedy=0、该模式最强=100」的归一化分，炸弹人与夺旗是「基准=0、400×log10、不封顶」的
  Bradley-Terry 实力值；**不能平均成一个总分**，也不能横向比大小。
- 本机跑的是小样本参赛轮 + 自定的 `ptc-local-concise` 预设 + 放宽到 90/120 分钟的墙钟；
  正式赛各家用自己的脚手架与节奏，且**正式赛表里没有本机**。观众从第 02 页就该自己看出这两批数不可比。

### 小样本参赛轮 vs 大样本复核（2026-10-04 新增的一层）
每场又用 `challenge.py --full` 重跑了一遍大样本（圈地 1128 局、炸弹人 1320 局含 3 人档、夺旗 1016 局含 8 档人数），
**名次和分数都变了**，页面优先读 `challenge-full.json`，小样本只作对照。
正赛版和加时终版各跑一轮，才有同一尺度下的「正赛 → 加时」：

| 场 | 小样本（参赛轮） | full 大样本 | 大样本下正赛 → 加时 |
|---|---|---|---|
| 圈地 | 正赛 4.7 · 第 8/12 · 混战 Elo −282 对随机锚点 −286<br>加时 4.9 · 第 8/12 | 正赛 6.1 · 第 8/10 · 单挑 12.2（Elo 90）· 混战 0.0（Elo −314）对随机锚点 −487<br>加时 6.8 · 第 8/10 · 单挑 12.3 · 混战 Elo −259 对随机锚点 −488 | **6.1 → 6.8：涨 0.7**<br>95% 区间 1.5–10.8 / 1.2–11.1，宽 9 分以上，0.7 分仍小于区间宽度 |
| 炸弹人 | 正赛 56.44 · 第 8/11<br>加时 144.54 · 第 8/11 | 正赛版 63.62 · 第 10/10<br>加时终版 116.38 · 第 8/10（**同一套 1320 局赛程**，`--seed 20261004`、并发 2，逐局同座位同地图） | **63.62 → 116.38（+52.76）**，名次 10 → 8<br>十人档 1.65 对基准 2.45 → 3.68 对 2.30，故障 1 局 → 0 局 |
| 夺旗 | 正赛 −202 · 第 12/12 · 故障 0 局<br>加时 −49 · 第 10/12 | 正赛 −346 · 第 12/12 · **故障 14 局（全在 13 方档）**<br>加时 −52 · 第 9/12 · 故障 8 局 | −346 → −52（涨 294），名次 12 → 9<br>与 小样本的 12 → 10 同向，这条结论稳 |

四处被大样本改写的说法，页面与稿子都按新口径改：
1. **「圈地加时涨了 0.2 分」** → 受控并发重跑后正赛版 6.1、加时终版 6.8：涨 0.7 分，但仍小于 9 分宽的置信区间。
   七版全部净负这一条没变，改口成「四十分钟没能把它推上去」。
2. **「混战档基本就是随机水平」** → 小样本混战 Elo −282 与随机锚点 −286 只差 4 分，看着像；大样本差 172 分（−313 对 −485），
   混战分确实是 0.0（该档最高分归一化后本机垫底），但「≈闭眼乱走」这句不成立。
3. **「v13 引入段错误」** → 反了。正赛版 v9 就崩，而且 14 局**全在 13 方档**，
   加时终版 v13 降到 8 局、集中在 10 / 13 两方档（2 ＋ 6 局）。两版报的都是「进程已退出（代码 −11）」，
   单回合 `max_ms` 最高 v9 5.72ms / v13 3.50ms（受控并发重跑后的读数），离 50ms 时限很远，是段错误不是超时。分档分布由 `pipeline/ctf-faults.py`
   从逐局 `结果.jsonl` 数出来存进 `data/ctf-faults.json`。
4. **「并发 7 → 2 影响成绩」这类说法一律作废**（本 README 与稿子 v6 都写过，已撤）。第一轮 --full 的并发是
   `challenge.py` 内置的 `workers = min(8, cpu//2)`，本机 14 核即 7——十人局一轮同时开 7 局就是 70 个进程抢 14 个核。
   2026-10-05 用同一套赛程、受控并发重跑了三场，结论见 [RERUN-REPORT.md](RERUN-REPORT.md)：那是机器的负载问题，不是策略差异。

### 炸弹人固定赛程与受控并发（2026-10-04 起，2026-10-05 重跑）

直接调 `tournament/evaluate.py`（只有它暴露 `--seed`），`--seed 20261004`、`--sizes 2 3 10`、`--seeds 1`、`--workers 2`：

| 组 | 代码 | 并发 | BT | 名次 |
|---|---|---:|---:|---:|
| `rerun-main-w2-1005-100059` | 正赛交卷版 | 2 | **63.62** | 10/10 |
| `rerun-ot-w2-1005-103544` | 加时终版 | 2 | **116.38** | 8/10 |
| `rerun-ot-w1-s10-1005-103544` | 加时终版 · 十人档 24 局配对参照 | 1 | —（切片，不做成绩） | — |
| （旧）`ctl-main-w7-105906` | 正赛交卷版 | 7 | 58.47 | 10/10 |
| （旧）`ctl-ot-w7-110757` | 加时终版 | 7 | 103.43 | 8/10 |
| （旧）`ctl-ot-w2-111642` | 加时终版 | 2 | 125.64 | 8/10 |
| （旧）`20261004-045254` | 加时终版 | 7 · 随机赛程 | 75.64 | 10/10 |

**旧批次一律不采信**：并发 7 在这台 14 核机器上是超卖（十人局同时开 7 局 = 70 个进程），量到的是机器负载而不是策略；
早先那条「换代码 +44.96 / 换赛程 +27.79 / 换并发 7→2 +22.21」的三向拆解整体作废（三组都落在并发 7 的批次上）。
2026-10-05 用同一套 seed、把并发压到 2 重跑两个版本各 1320 局，判读见 [RERUN-REPORT.md](RERUN-REPORT.md)。

- 两份 `schedule.json` 已逐局核对：1320 条 entries 的 size / seed / roster 完全一致（本机那格按 build 目录名归一化）。
- **并发有没有在改分，用配对对照验过**：从加时终版那份赛程里抽十人档前 24 局冻结成 `--schedule`，
  只把 `--workers` 从 2 降到 1，同 seed、同座位、同地图重跑（`rerun-ot-w1-s10-*`）。本机场均分 **3.385（w1）对 3.5（w2）**，
  差 0.115 分，没有系统性漂移 → w2 的读数可采信。
- 并发动摇分数的机制在源码里：`submission/bot.cpp:483` 的 `gDeadlineMs=(T==0)?1400.0:(heavy?25.0:40.0)`，
  第 449 行一超就 `gTimeUp=true` 退出迭代加深——CPU 抢不过别人时搜索直接变浅。`pipeline/bomb-noise.mjs`
  逐局比过旧的那两组（w7 对 w2），`data/bomb-noise.json` 记下 **490 局里 273 局终分不同**（两人档 2/20、三人档 144/270、十人档 127/200）。
- **更正一条早先的误判**：「正赛版源码没留存」是拿源码哈希去比了 `identity.json` 的 `bot_hashes`——那是
  `evaluate.py:159` 记的**编译后二进制**哈希，两者本就不该相等。源码一直在 `contestants/archive/pre-selfiter-20261003/`，
  sha256 前缀 `2d9c83320600` 与旧 `ctl-main-w7` 的 build 目录名 `bot-2d9c83320600` 对平，加时终版同理。
  所以第 19 页的折线现在三条线全连，第 10 页的横比柱也换成与标题同表的那十家。
- `challenge.py` 硬编码默认并发 `workers = min(8, cpu//2)`，本机 14 核即 7；十人局同时开 7 局 = 70 个进程抢 14 核（5:1 超卖）。
- 大样本成绩表原样拷在 `data/full-src/`，`pipeline/full2json.mjs` 负责解析；重跑评测只需换文件、重跑脚本。

### 横比柱与入场动效（2026-10-04 下午加的一层）
- **三场统一成"交卷一张横比柱、加时一张横比柱"**，加时那张同时摆正赛交卷版与加时终版两根本机条，
  这样"新旧效果对比"和"跟其他模型横比"在同一张图上读完。柱子一律读 `challenge-full.<场>.<档>.ratings`，
  也就是**与标题那个分数出自同一轮 --full 的那张表**——之前第 10 页喂的是正式赛那张表（含本机 56.44），两张表混在一页，已修。
  对手池读该页最后一轮的表；两版本机各读自己那一轮，mini 里写明。圈地两版能放一起是因为两表都以"该模式最强 = 100"归一化、
  两轮第一名都是 Sonnet 5；炸弹人那一对还额外钉了赛程（见上一节）。
- **动效**：条形从基准线往外长（`growX`，按行号 `--i` 错峰 34ms）、折线描边（`draw`，用 `pathLength="1"` 免算真实长度）、
  末端圆点最后弹出、页内顶层块自上而下 `rise`。
  **起始态一律只写在 `@keyframes` 的 `from` 里，静态规则不放 `opacity:0` / `stroke-dasharray`**——
  否则 `?anim=0` 只关掉 animation 会让元素永久不可见。
- **`?anim=0` 是给量版式用的**：`layout.mjs` 走这个开关量终态；`shot.mjs` 保留动效并把切页后的等待提到 1700ms
  （条形最长一条 = 块延迟 + 行延迟 + 620ms ≈ 1.05s，加擦除转场 620ms，1700ms 才拍得到终态）。
- **动效不能靠读 CSS 验收**：页面是运行时渲染的，`index.html` 里根本没有 `<rect>`。
  `pipeline/anim-probe.mjs` 开无头 Chrome 实测采样，第 6 页首根条 0 → 714.7px、724ms 到位、17 个中间取值。
  **采样必须用 `setInterval`，不能用 `requestAnimationFrame`**——无头 Chrome 不保证逐帧驱动 rAF，会得到"一条都没采到"的假阴性。
- `check.mjs` 里那条"六张横比柱齐备"是按 `<svg>` 内的条形根数与 `<text>` 标签数的，
  **不能拿整页 HTML 做子串匹配**：SVG 坐标是长小数（`width="484.78…"` 里就含 `4.7`），
  而 4.7 正是要拦的小样本旧分数——这条断言在改成 `strip()` 之前是个假阳性陷阱。
  它同源计算、抓不到"数据本身少一家"，所以另加一条拿 `data/full-src/` 原文独立核对的断言。

### 第 13 页的火焰盲区与第 23 页的压缩代价（2026-10-04 傍晚补的两条硬账）

**火焰数组截断不是"潜在风险"，是量得出代价的。** `memcpy(R.flame, FL, 625)` 只拷 625 字节，而 `int16_t flame[625]`
该拷 1250 —— 于是格号 ≥313 的那半边棋盘上，火对它不存在。`pipeline/bomb-blind-zone.py` 逐帧扫了正赛版十人档
200 局（`rerun-main-w2-1005-100059`，受控并发 w2）：本机被炸死 199 次，**161 次（80.9%）死在盲区**，而它平时只有 27.7% 的时间站在那半边；
同局其余九家（看得见整张盘）是 50.9%，正好等于盲区面积比 313/625。加时终版那一行改成
`625*sizeof(int16_t)`，同一比例降到 41.5%（对照组 49.9%）。这条把第 13 页原来那句
「正赛测过的每一局都在 bug 不发作的区间」推翻了 —— 那句只对**它自己测的两方局**（169 格）成立，口播已改成这个说法。

**主动压缩的代价分两块，探针两条。** 三场 `compaction/summary` 共 18 次，其中 16 次是模型自己调 `compact_region`
折的、2 次引擎接管（都在炸弹人，带 `usage`）。写笔记那一步 32–198 秒；真正的大头是折叠后第一步要重放，
缓存命中从折叠当步的 138,714 一律掉回 10,055–10,653，最狠的一次重放 113,294 token。
- 探针一「有没有回头搜被折叠的历史」：**0 次**。注意 `session_query` 不是工具名（那是 `stats.json` 的归因标签），
  真名是 `session_event_read` 一族（`packages/session-query/tool-session-query/src/index.ts:66-115`），
  而且确实挂了机、系统提示和每次折叠回执里都逐字教过用法 —— 按真名在原始 session 日志里数，模型自写的调用三场全 0。
  日志里 141 次出现这些名字全是引擎写的文本，别拿它当"用过"。
- 探针二「有没有重复劳动」：重做同一处编辑 **0 对**；跨折叠把同一份文件重读一遍 **6 处**（evidence 原始口径 10 对，
  `compaction-page.mjs` 剔掉了"写 README"冒充"读 README"和同一步按两个关键字重复计数的）；
  同一类错误跨折叠复发 **2 例**（圈地 14:37→15:29 隔 70 步 3 次折叠、炸弹人 17:05→17:24 隔 46 步 1 次折叠）。
  哪一对算真复发是**人工判的**（判据是把两边原文逐行读过），步号 / 时刻 / 中间几次折叠全部回 evidence 取数。

### 加时窗口（每场追加 40 分钟自迭代）的写法约束
- 三场加时期间各发生过一次服务崩溃。页面**只保留「崩了一次、续跑」这一事实**，
  **不写停机时长、不写任何形式的补偿时间数字、不写计时器实现细节**；稿子、字幕、README 同样遵守。
  `check.mjs` 同时断言本工程没有那份中断台账文件，且产物 / 字幕 / README 无相关口径。
- 加时步数用 trace 口径（夺旗 47 步），与 `scores.md` 的窗口记录一致；`build.mjs` 里注明夺旗不能用 `fromTurn=2`
  （turn 2 起点 20:30 是正赛期间那句「有没有试过自迭代」，算进加时会得到 49 步）。

### 仍然有效的两处口径细节
- **请求数 ≠ 步数**：`stats.json` 的 143 / 205 / 124 是**模型请求数**（合计 472），trace 表的 141 / 203 / 124 是**步数**（合计 468），
  差的是没进表的步。两个数在第 20 页并列出现。
- **438.5 分 vs 424 分**：前者是 `stats.json` 的 `stepMs.totalMin` 之和（含压缩系统步与步尾延迟），
  后者是逐步耗时求和（正赛 327 + 加时 98）。画面统一用 424 这套，因为它能按阶段拆。
