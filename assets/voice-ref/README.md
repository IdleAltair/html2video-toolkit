# 牢大百科音源 → 中文女声配音（BreezeTTS Direction）

2026-10-06 做完的一条配音线：从《谁最会说人话？我抓了 6 个 AI 挑战地狱级测试！【牢大百科 10】》
的 12 个区间分离人声当音色参考，用 BreezeTTS 2 合 arena-p3r 口播稿 72 句中文女声。
定稿已被 dsh 用进 4K 成片 `$OUTPUT_DIR\arena-video-4k-中文版.mp4`（387.13s / 4K60 / -16.1 LUFS）。
本目录是这条线的全部可复用件，`$TMP\tts\` 已清空，别再去找。

## 目录

    voice-ref/       12 段分离人声（44.1k / 立体声）+ ref_t06_from0.6s.wav（真正用的参考，14.00s）+ ref_text.txt
    out/zh-72/       72 句定稿 NN.wav（00 = 第一句，按字幕有效行序）+ durations.json + preview_full.wav（330.9s）
    models/          BS-Roformer karaoke ckpt（204MB）+ config yaml —— 去 BGM 用
    scripts/         全套脚本原样保留（30 个 .py/.sh，见下"脚本里的路径"）+ subtitle_lines.txt（当轮取的那几句文本）
    ab/              试听件：breeze-laoda2/（Breeze 四句，其中 01.wav 是用户说最好的一条）、
                     indextts-laoda2/（同四句的 IndexTTS 版）、seed-exp/（同句四 seed 对照）、
                     speed-ladder/（六档语速梯度 speed_ladder.wav + 单档 e1…e5/veryslow，用户按这个挑的档）
    母本             ../raw/谁最会说人话？我抓了6个AI挑战地狱级测试！【牢大百科10】.mp4（233MB，12 区间从这里抽）

## 复跑四步

1. **抽轨 + 切片** `scripts/extract.sh`（WSL 跑，ffmpeg 用 `$HOME/mamba/envs/ninfer/bin/ffmpeg`）。
   12 个区间（秒）写死在脚本的 `SEG` 表里：26-32 / 118-130 / 271-282 / 324-332 / 400-414 / 495-518 /
   563-579 / 638-651 / 758-774 / 844-855 / 908-920 / 1039-1049。
2. **去 BGM** `audio-separator` + BS-Roformer karaoke。
   - ckpt 必须叫 `bs_roformer_karaoke_anvuew.ckpt`：audio-separator 按内置 `models.json` 清单匹配文件名，
     config yaml 不随包发，两个文件一起放 `--model_file_dir` 才能离线用。
   - 输入要带 ±3s 上下文（`mk-in.sh`），分离后再裁回区间（`finalize.py`）—— 直接切区间会让首尾的人声被模型吃字。
   - 命令：`audio-separator in -m bs_roformer_karaoke_anvuew.ckpt --model_file_dir models --output_format WAV --single_stem Vocals`
   - 纯 CPU，1.6–4× 实时。
   - 验收：`leak12.py`（间隙残留）配 `leakref.py`（反向对照）。12 段实测残留 -39.5 ~ -52.7 dB；
     "只下混不经模型"的基线是 -22.0 dB，模型把它压到 -44.0 dB，差 21.9 dB —— 没有这条对照，-40 dB 说明不了什么。
3. **合成** 先起 BreezeTTS 常驻 API（跑法见 `../breeze-tts/本地部署.md`，不要 CLI 循环），再 `scripts/dub_all.py`。
   - Direction 模式 = `ref_audio` + `ref_text` + `instruction`（+ `cfg_scale=4`）。**纯 Clone 传 cfg_scale 会 500**。
   - `ref_text` 必须与参考音频逐字对应，见 `voice-ref/ref_text.txt`。
   - 72 句墙钟 762s（RTF ≈ 2.8，比实时慢）。响应是 24k / mono / s16le **裸 PCM 无 WAV 头**，脚本自己包。
4. **拉平** `norm-speed.py`（atempo 到净语速 8.02 字/秒，±10% 带内不动，实际拉了 24 句）
   → `trim-pads.py`（超长尾静音裁到 150ms 上限，只裁不补，6 句）→ `seams2.py`（复测接缝）。

## 交付规格：dsh 定的三条硬要求，别破

不淡入淡出、不响度归一化、不补首尾静音。这三件都在合成端统一处理（每句 8ms 淡入淡出、整轨 -16 LUFS、
按样本号精确落位），先做了反而让拼接对不齐。
（8ms 是 dsh 那边的取值；自己拼整片时按下面那条量一遍再定长度，别照抄。）

## 语速为什么是 8.02 而不是 dsh 的 3.0

dsh 的 3.0 字/秒来自「按字数」数日语，基数偏低：同一把尺实测日语 111 句 / 3,884 字符 → **4.56 字/秒**。
定档最终按用户耳朵走：`ab/speed-ladder/speed_ladder.wav` 是六档梯度样音，用户挑「第 4–5 档之间、更接近 4」，
对应净语速 8.02 字/秒。参考原声（牢大百科本人）净语速 7.29，归一后 72 句落在 7.02–8.57。
整片语音 330.9s，dsh 的时间轴 387.13s（含气口）。

「净语速」= 扣掉首尾静音和句内停顿后的字/秒，分母用去标点字符数。用整句时长算会被短句失真：
≤12 字短句的"字/秒"低全在小分母上，不是真慢。

## 踩过的坑（只留结论）

- **音色相似度不能当质量分**。CAMPPlus embedding 余弦跟人判**负相关**：人判最好的 `01` 余弦 0.723 是全场最低，
  人判差的 `03` 余弦 0.882 是全场最高。语速、句内停顿两项也复现不了人的排序。质量只能试听。
- **whisper 不能当中文 CER**。它输出繁体 + 同音字替换，实测把正确合成判成 27.7% 错。
- **BreezeTTS 没有语速参数**，只能靠 `instruction` 引导，而措辞与语速**不单调**：
  "非常缓慢从容"实测 4.98，"字与字之间拉开距离"反而 2.63。想控制语速只能事后 atempo。
- **逐句独立合成必然自带句末降调**，这是"句间突兀"的主因，时域处理治不了。
  能治的是另外两件：语速离散（拉平后相邻句落差中位 11.7% → 4.3%）和尾静音参差（交界间距最大 1150ms → 160ms）。
- **参考音频前 1 秒有上一个人说话的残音**，包络/能量探针测不出"人声类污染"（它不是噪声），
  靠用户试听发现，再用包络定位到 0.48–0.68s 的停顿、从 0.6s 重裁 14s。
- **分离后总 RMS 只降 0.2–1.1 dB 不等于失败**：这条音轨的伴奏比人声低 17 dB，理论差正是 0.2 dB。

## 整片返工一轮的实操结论（2026-10-11，Coder390 评测片 106 句）

同一套音源又跑了 106 句整片，三轮试听返工下来的结论，按"下次能直接用"写：

- **`cfg_scale` 4→2 只收紧停顿、不动音色**（实测最长空拍中位降约 0.15s，音色无变化）。这是比措辞更好使的第一个旋钮。
- **可用率是能算出来的**：拿用户听感标注跟指标交叉，`字/秒 ≥ 5.8 且 最长空拍 ≤ 0.45` 的成品可用率 89%。
  择优就按 `|cps-目标| + 4×max(0, 空拍-0.45)` 取最小，峰值 <0.25 直接判废（句首吞字/音量塌）。
  这条口径不是长度混杂造出来的：分档看过，短句长句都成立。
- **「质感」是指标的盲区**。字/秒和空拍都达标的句照样会被否（25、57、89 那类），换 seed 六次听感几乎一样 ——
  质感不由这两个指标决定，只能耳朵终检。**同一句换 seed 的改变量，远小于把文本拆开重合成**。
  真要换韵律就得动喂入方式：句 1 拆两段各抽 seed，段间留 0.30s 气口再拼回一句，韵律立刻不同 ——
  代价是分段读得快（段本身 7.0 / 7.2 字/秒），得 atempo 降 13% 才回到 6，尾音会有点发黏。
- **temperature 不是语速的杠杆**。runtime 里写死 0.9，猴补丁降到 0.5 之后句子反而更长更空（一句 52% 是静音）。
  API 也没暴露它。想控语速只有 atempo。
- **文本归一化的坑是一句一句实测出来的**，逐条都不能省：行首 `Xs`/`XminYs` 占位时间戳会被念出来；
  U+2212 的 `−` 和数字前的半角 `-` 都不读负号，得换成汉字「负」；`@handle` 会把整句吞掉（22 字只出 1.76s）；
  `Q5_K_XL` 会念出"下划线"，改 `Q5KXL`；`GB`/`bit` 换成「吉字节」「比特」；
  **四位以上阿拉伯数字必须转中文数词**（914450、84894、2436 都实测读错过），千分位逗号和 `%` 反而读得对，别动。
- **句数是不能动的量**。嫌句子太短要加时长，用**扩写**（"下面看柱状图"→"下面把这一场画成柱状图看"），
  别拆成两句 —— 拆句会让 cues 轴、页时长、视频槽全错位。
- **±15% 的 atempo 听不出来，可以放心用来拉平整片语速**；超过 15% 才开始有尾音发黏的风险。
  钳在 ±15% 仍够不到目标的句（这次 21 句里有 10 句），只能重抽或改文本。
- **≤12 字短句的"字/秒"别跟长句用同一把尺**：分母太小，3.65 字/秒那种全是失真。
- **句间气口和换页气口要分开**。两者共用一个 GAP 时翻页是零气口的。
  换页留白取 1.0s、句间 0.6s；换页值必须大于播放器的翻页提前量（这里 `CUE_LEAD=0.55`），否则会先开口再切页。
- **成片音轨按 `cues.sentences[].start` 逐句落位**，不要自己按固定 GAP 累加 —— 气口一改就错位。
  落完拿每句 wav 的实测时长跟 `cues.dur` 比，差 >0.01s 就说明 cues 没跟音频同步，当场报错比后期对不上强。

- **混音别让 ffmpeg 做 mono→stereo 上混，也别用 amix 垫配乐**。实测这一版 ffmpeg（Lavf62.3.100）把单声道人声上混成立体声时
  整轨凭空掉 **3.0 dB**（除以 √2），`amix` 就算写了 `normalize=0` 也照样压约 2 dB。
  改成人声自己复制成两声道、与配乐在 numpy 里相加，再编 AAC —— 混音前后同段 RMS 差回到 ±0.1 dB 内。
  查这条的方法：把成片音轨解码回来跟原始人声轨**同区间**比 RMS，别信 `volumedetect` 配 `-ss` 快速 seek 的数（那会只量到片段尾巴）。
  后来照抄 dsh 的 ffmpeg 链时，这两处是用 `pan=stereo|c0=c0|c1=c0`（显式复制，不走自动上混）+ `amix=...:normalize=0` 绕开的，
  实测与 numpy 相加的结果差 ±0.1 dB —— 结论保留"隐式衰减存在"，不必保留"必须用 numpy"。

- **拼接音轨前先看句边界的样本跳变，别默认 TTS 片段首尾是零**。106 句里有 4 句以非零样本起收（句 95 首样本 0.186、
  句 19 首样本 0.161、句 84 末样本 0.151、句 42 首样本 0.058），落进静音就是阶跃 → 咔哒。dsh 用每句 8ms 淡入淡出，
  我照抄后发现 8ms 偏长：句 95 的塞音在 2ms 处已经冲到 0.689，8ms 线性淡变把它按到 0.179（约 -11 dB），削的是爆破音本体。
  量了 1/2/3/4/6/8ms 六档：**2ms（48 样本）就已经把全片句边界最大台阶压到 0.00006、淡变窗内新增的单样本跳变 ≤0.009**
  （语音自身的单样本跳变最大 0.79，所以 0.009 完全埋在里面），而窗内最大削幅从 8ms 的 0.51 降到 0.28。定 `FADE_MS=2`。
  反向验证两件事：淡变窗以外的样本必须与未淡变的落位轨**逐位相等**（实测 0 处差异），以及别把淡出写成淡入
  ——第一版增益式写反，句 84 的边界台阶原样留着，还在每句尾段挖了个凹口。

- **`sidechaincompress` 会把混音链塌成单声道**。人声和配乐都是按立体声喂进去的，出来 `channels=1` —— 这个滤镜按 mono 处理，
  自动插的 aformat 把两路都降成单声道。口播视频人声居中本来就是标准做法，所以没去救立体声，但别以为自己做对了。
- **出片前先复用同一条链，别自己重发明**。dsh 的 `.arena-preview.py`（在 `~/deepseek-harness/workplace/`）已经把
  「人声 loudnorm -16 / 配乐 -13dB + 带通 / 侧链避让 / amix normalize=0 / ass 烧字幕 / +faststart」跑通并出过成片，
  本轮直接照抄成 `pipeline/compose.py`，只去掉它专为 CDP 抓屏帧率漂移写的 retimed 一步。
  查这类现成实现：会话日志是 zstd 多帧（`~/.dsh/sessions/*/*/session*.jsonl.zstd`，WSL 里没有 zstd CLI，
  用 Node 的 `zstdDecompressSync` 扫 magic + 逐帧缩边能全解出来），再按产物名（`*.video-retimed.sub.mp4`）反查脚本最快。
- **OBS 路线录出来一定是无声的**：脚本给 Chrome 带了 `--mute-audio`，实测音轨 -91 dB 数字静音，
  所以配乐只在后期叠一次。另外 `--kiosk` 全屏窗口自己带焦点，那句"等 90 秒要人点一下页面"实际不需要人。

本轮的脚本在 `../arena-effthink/pipeline/`：`dub_breeze.py`（全量合成）→ `dub_pick.py`（多 seed 抽卡+按上口径择优，
`--reselect` 只重算选择不费 GPU）→ `dub_fit.py`（±15% 对齐，`--src/--out/--plan` 可换目录）→
`dub_preview.py`（返工期整片试听，取件链带来源标注）→ `dub_apply.py`（落正式目录，旧件一律归档不删）→
`join_preview.py`（按 cues 出成片音轨 + 时间码表，每句首尾 `FADE_MS` 淡变去咔）。

## 未做（等用户点名才动）

- 句末独立降调：要连续 2–3 句一次合成、再按停顿切回单句 wav。
- `15/29/43.wav` 三句超短句被加速 1.6–1.7×：可以对 ≤12 字句豁免语速归一重出一版。

## 环境（不随归档走）

- **audio-separator venv**：`$TMP\tts\.venv`（1.2G，Python 3.12.10 + torch 2.14.1 + audio-separator 0.47.0 +
  onnxruntime 1.30.0 + librosa 1.0.0）。**没归档**（体积大、可重建），但**也没删**，重建只需：
  `python -m venv .venv && .venv/Scripts/pip install audio-separator onnxruntime audioread librosa soundfile`
  注意 CLI 启动即 `subprocess.check_output(["ffmpeg","-version"])`，Windows 侧 ffmpeg 必须在 PATH（用 `../bin/ffmpeg.exe`）。
- **BreezeTTS 2**：venv 在 WSL ext4 `$HOME/breeze-tts-env/.venv`，权重 `../breeze-tts-2/`，
  部署与边界见 `../breeze-tts/本地部署.md`。
- **IndexTTS-2.5 对照版**：`../index-tts/.venv`（Windows），runner 是 `scripts/run-laoda-zh.py`；
  它把参考音频硬截前 15 秒，且 `--lang` 默认是 JA，跑中文要显式 `--lang ZH`。
- **许可**：BreezeTTS 权重与**自托管产物**归 BreezeBlue Research and Non-Commercial License —— 配音成品无商用权利。

## 脚本里的路径

`scripts/` 下 30 个脚本按当轮工作目录写死了 `$TMP\tts` / `$TMP/tts`，原样保留没改（改了就没实测过）。
复跑前按需改这几处：`extract.sh` 的 `SRC`（母本 mp4 现在在 `../raw/`）和 `OUT`、`mk-in.sh`/`center.sh` 的 `OUT`、
`dub_all.py` 的 `SRC`（字幕源，原为 dsh 泳道 `~/deepseek-harness/workplace/arena-p3r-sample/dubbing/字幕.zh.txt`）与 `OUT`、
`norm-speed.py` 与 `trim-pads.py` 的 `SRC`（链路：`out/` 原始 → `-norm` → `-final`）。
