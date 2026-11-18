# -*- coding: utf-8 -*-
"""从「单一数据源」生成两份定稿文档，避免手抄漂移：

  dubbing/字幕.txt   行首整片绝对秒数 + 逐字台词（轴取 data/cues.json，页名取 dubbing/pages.json）
  README.md          页面清单表直接抓 PLAN.md 的「26 页结构」那张表，只把序号补成两位

用法：python3 pipeline/mkdocs.py
"""
import io, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cues = json.load(io.open(os.path.join(ROOT, "data", "cues.json"), encoding="utf-8"))
meta = {p["page"]: p["title"] for p in json.load(io.open(os.path.join(ROOT, "dubbing", "pages.json"), encoding="utf-8"))}
plan = io.open(os.path.join(ROOT, "PLAN.md"), encoding="utf-8").read()
total = cues["total"]


def tc(s):
    s = int(round(s))
    return "%dmin%ds" % divmod(s, 60) if s >= 60 else "%ds" % s


# ---------- 字幕.txt ----------
out = ["# 口播字幕（定稿）｜轴 = data/cues.json 的实测音频时长，成片 %.2fs（%.2f 分钟）" % (total, total / 60),
       "# 行首是整片绝对时间（该句第一帧），不是页内相对时间；台词逐字照口播稿，配音用的是念法变体（数字转中文数词等）",
       "# 生成：python3 pipeline/mkdocs.py"]
last = None
for r in cues["sentences"]:
    if r["page"] != last:
        last = r["page"]
        out.append("# 第 %d 页 · %s" % (last, meta.get(last, "")))
    out.append("%s %s" % (tc(r["start"]), r["text"]))
lastp = cues["sentences"][-1]["page"]
if lastp < len(cues["pages"]):
    out.append("# 第 %d 页 · 完（无口播，静默落幕 %.1fs）" % (len(cues["pages"]), total - cues["pages"][-1]["start"]))
p = os.path.join(ROOT, "dubbing", "字幕.txt")
io.open(p, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
print("[docs] 字幕.txt：%d 句 / %d 页标注 -> %s" % (
    len(cues["sentences"]), len([l for l in out if l.startswith("# 第")]), p))

# ---------- README.md ----------
sec = plan.split("## 26 页结构")[1].split("## ")[0]
tbl = []
for l in [x for x in sec.splitlines() if re.match(r"^\| \d", x)]:
    c = [x.strip() for x in l.strip("|").split("|")]
    rng = re.match(r"^(\d+)\s*[–-]\s*(\d+)$", c[0])
    if rng:      # PLAN 里同构段是一行区间（如 9–13），README 必须逐页成行，闸门才数得出 26 行
        for n in range(int(rng.group(1)), int(rng.group(2)) + 1):
            tbl.append("| %02d | %s | %s同构段之一；本段五页：%s | %s |" % (n, meta.get(n, c[1]), c[1], c[2], c[3]))
    elif c[0].isdigit():
        tbl.append("| %02d | %s | %s | %s |" % (int(c[0]), c[1], c[2], c[3]))
npages = len(cues["pages"])
if len(tbl) != npages:
    raise SystemExit("!! PLAN.md 的页表展开成 %d 行，与 cues 的 %d 页对不上，README 会过不了闸门" % (len(tbl), npages))
print("[docs] README 页面清单：%d 行（渲染页数 %d）" % (len(tbl), npages))

rm = """# Coder390 性能测评 · 视频工程

一页一页验证「后训练微调把思考长度砍掉之后，成绩到底掉多少」。测试载体是三场公开算法比赛
（圈地 / 炸弹人 / 夺旗），被测是 `Qwen3.8-27B` 的 Coder390 Q4LynnStyle 档，对照是 unsloth 原版 Q5_KXL。
产物是一个自包含的展示页 + 按口播实测时长排出来的时间轴，录屏后配中文人声成片。

叙事背景、关键数据与已定口径写在 PLAN.md（给外部评审读的自包含简报），这份 README 只讲怎么跑。

## 跑起来

    node build.mjs                      # src/*.js|css + data/*.json + cues 内联成 index.html
    node pipeline/check.mjs             # 内容与数字闸门（断言期望值独立写死，与数据件不同源）
    node pipeline/layout.mjs            # 版式闸门：26 页 × 多视口，破版 0 才算过
    start index.html?cue=1&auto=1         # 按 cues 自动翻页、带口播轴；纯看画面加 &clean=1
    python3 pipeline/mkdocs.py          # 重生成 README.md 与 dubbing/字幕.txt（本页即其产物）

数据读数源三件，改数字只改这里，页面与断言都从它取：

- `data/model-compare.json` — 唯一读数源，每个数带出处
- `data/iterations.csv` — 逐轮改动台账（参数、自战读数、判定、版本文件是否留存）
- `data/iterations-stats.json` — 自迭代窗口的分段统计

## 26 页清单

| # | 页 | 内容 | 主视觉 |
|---|---|---|---|
__TBL__

## 配音

106 句中文口播，BreezeTTS 2 克隆（牢大百科音源），逐句 wav 在 `dubbing/tts_clips/`（`NN.wav`，句序即文件号）。

    python3 pipeline/dub_breeze.py                 # 全量合成，已有句跳过
    python3 pipeline/dub_pick.py                   # 抽卡择优（多 seed × 两套措辞 × cfg2，双卡并行）
    python3 pipeline/dub_fit.py                    # ±15% atempo 拉平语速
    python3 pipeline/dub_preview.py                # 返工期整片试听 + 时间码表，不动正式目录
    python3 pipeline/dub_apply.py --go             # 落正式目录（被换下的旧件一律归档，不删）+ 重排 cues
    python3 pipeline/join_preview.py               # 按 cues.sentences[].start 拼成片音轨 dubbing/deck_audio.wav
    python3 pipeline/mixdeck.py                    # 叠配乐出成片音轨 dubbing/deck_mix.m4a（人声原样、BGM 0.35）
    python3 pipeline/mixdeck.py --voice            # 只出人声：OBS 已把页面配乐录进视频时叠这条
    python3 pipeline/dub.py --timeline dubbing/tts_clips   # 只重排轴：data/cues.json + 字幕.srt + 字幕.zh.txt
    python3 pipeline/mkdocs.py                     # 改完稿/页表重出本页与 dubbing/字幕.txt

气口：句间 0.6s、换页 1.0s（换页值必须大于播放器 `CUE_LEAD=0.55`，否则会先开口再切页）。
成片音轨长度与 `data/cues.json` 的 total 逐样本相等，录屏时按 `dubbing/成片时间码.txt` 起音即可对位。
念法变体（负号、`Q5KXL`、四位以上数字转中文数词等）写在 `pipeline/dub.py` 的 `tts_text()`，
逐句对照在 `dubbing/tts.json`（`srt` 是逐字稿、`tts` 是喂给 TTS 的写法）。
返工口径与踩坑记在 `../laoda-zh-dub/README.md`。

**许可**：BreezeTTS 权重与自托管产物归 BreezeBlue Research and Non-Commercial License，这条配音没有商用权利。

## 出片

    node pipeline/record-obs.mjs --password <OBS 密码> --seconds 626   # OBS 录无声画面，落盘形如 $OUTPUT_DIR/*.mkv
    python3 pipeline/compose.py --video "<那个 mkv>"                   # 烧字幕 + 叠音轨 -> out/成片-*.mp4

录屏走 OBS 的 obs-websocket（工具 → WebSocket 服务器设置：启用 / 4455 / 密码）。脚本把当前场景切成「窗口采集」、
用 '--kiosk' 起全屏 Chrome，并且**等页面拿到焦点才开录**（Windows 不允许后台进程抢焦点，否则第一页会录成别的窗口）。
Chrome 带 '--mute-audio'，实测录出来的音轨是 -91 dB 数字静音 —— 配乐与人声都在 compose 阶段叠，不存在两遍配乐。

'compose.py' 的滤镜链复用 dsh 在 '.arena-preview.py' 里跑通的那套（人声 loudnorm -16 / 配乐 -13dB + 70–13000Hz 带通 /
侧链避让 / 'amix=normalize=0' / '+faststart'），只去掉它的 retimed 一步 —— 那步是修 CDP 抓屏的帧率漂移，
OBS 的 NVENC 输出恒定帧率不需要。实测成片音轨综合响度 -16.6 LUFS；音轨是单声道，
因为 ffmpeg 的 'sidechaincompress' 会把链塌成 mono，而口播视频人声居中本就是标准做法，没去救立体声。
"""
rm = rm.replace("__TBL__", "\n".join(tbl))
p = os.path.join(ROOT, "README.md")
io.open(p, "w", encoding="utf-8", newline="\n").write(rm)
print("[docs] README.md -> %s" % p)
