#!/usr/bin/env python3
"""生成烧录用的 ASS 中文字幕：轴来自 data/cues.json 的日语实测时长。

中文字幕是按页写的（72 条），日语配音是逐句的（111 句）。做法：
每页的中文行按**字数比例**落到该页音频区间上，再把每条边界**吸附到最近的日语句间停顿**里，
这样断句永远落在自然气口上，而不是句子中间。

    python3 pipeline/mksub.py [--pages 1-3] [-o dubbing/subtitle.zh.ass]
"""
import argparse, json, re
from pathlib import Path

PRJ = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--pages", default=None, help="如 1-3，缺省全部")
ap.add_argument("-o", "--out", default=str(PRJ / "dubbing" / "subtitle.zh.ass"))
ap.add_argument("--size", type=int, default=76, help="字号（PlayRes 2560x1440）")
ap.add_argument("--marginv", type=int, default=60, help="字幕底边距（PlayResY 1440）；页面自带 tagline 那几页要压到它下面")
ap.add_argument("--boxalpha", default="C8", help="底框透明度，ASS 两字节 alpha：00 全不透明 / FF 全透明")
ap.add_argument("--nobox", action="store_true", help="不用底框，改用描边+阴影")
a = ap.parse_args()

cues = json.loads((PRJ / "data" / "cues.json").read_text(encoding="utf-8"))
rows = cues["sentences"]

# 中文字幕：按页分组
zh_pages, cur = {}, None
for line in (PRJ / "dubbing" / "字幕.zh.txt").read_text(encoding="utf-8").splitlines():
    m = re.match(r"^#\s*—+\s*第\s*(\d+)\s*页", line)
    if m:
        cur = int(m.group(1)); zh_pages.setdefault(cur, []); continue
    if line.startswith("#") or not line.strip() or cur is None:
        continue
    zh_pages[cur].append(re.sub(r"^\S+\s+", "", line.strip()))

# 日语：按页分组
ja_pages = {}
for r in rows:
    ja_pages.setdefault(r["page"], []).append(r)


def wrap_cn(z, limit):
    """中文字幕一行放不下就折两行：优先在标点处断，其次在最长一段的中间断。ASS 里用 \\N 换行。"""
    z = re.sub(r"([，。、；：！？])\\1+", r"\\1", z)
    if len(z) <= limit:
        return z
    mid = len(z) // 2
    best, bi = None, None
    for i, ch in enumerate(z):
        if ch in "，。、；：！？":
            d = abs(i - mid)
            if best is None or d < best:
                best, bi = d, i
    if bi is None or best > limit // 2:
        # 没有合适标点：在空格或中点断
        sp = z.rfind(" ", 0, mid + 8)
        cut = sp if sp > limit // 3 else mid
    else:
        cut = bi + 1
    return z[:cut].rstrip() + "\\N" + z[cut:].lstrip()

def ts(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return "%d:%02d:%05.2f" % (h, m, s)

HEAD = """[Script Info]
ScriptType: v4.00+
PlayResX: 2560
PlayResY: 1440
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
""" + ("Style: ZH,Noto Sans SC,%d,&H00FFFFFF,&H00FFFFFF,&H%s30100A,&H%s30100A,-1,0,0,0,100,100,.6,0,%d,%d,%d,2,90,90,%d,1"
         % (a.size, a.boxalpha, a.boxalpha, 1 if a.nobox else 3, 0 if a.nobox else 3, 3 if a.nobox else 0, a.marginv)) + """

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

lo = hi = None
if a.pages:
    p1, _, p2 = a.pages.partition("-")
    lo, hi = int(p1), int(p2 or p1)

out, kept = [HEAD], 0
for pg in sorted(ja_pages):
    if lo and not (lo <= pg <= hi):
        continue
    js, zlines = ja_pages[pg], zh_pages.get(pg, [])
    # 字号放大 2.5× 后一行只放得下 ~18 字：先把长句按标点拆成 ≤36 字的若干段，逐段显示
    LIM = max(12, int(2380 / a.size))
    def _split(z, limit=LIM * 2):
        parts, cur = [], ""
        for ch in z:
            cur += ch
            if ch in "，。、；：！？" and len(cur) >= limit * 0.55:
                parts.append(cur); cur = ""
            elif len(cur) >= limit:
                parts.append(cur); cur = ""
        if cur.strip(): parts.append(cur)
        return parts
    def _bbox(row, c0, c1):
        s = row["start"] + c0 * row["dur"]
        e = row["start"] + c1 * row["dur"] - 0.06
        return s, (s + 0.8 if e - s < 0.8 else e)
    if len(zlines) == len(js):
        # 中文配音：稿子本身就是逐句中文、与本页句数 1:1，逐句把自己的字按字数摊进**这一句的窗口**，
        # 字幕和人声因此锁在同一句上（旧日语轴中日句数不等，只能用下面的整页摊派 + 气口吸附）。
        for row, z in zip(js, zlines):
            parts = _split(z); C2 = sum(len(p) for p in parts) or 1; cum2 = 0.0
            for p in parts:
                s, e = _bbox(row, cum2 / C2, (cum2 + len(p)) / C2); cum2 += len(p)
                out.append("Dialogue: 0,%s,%s,ZH,,0,0,0,,%s" % (ts(s), ts(e), wrap_cn(p, LIM)))
                kept += 1
        continue
    zs = [p for z in zlines for p in _split(z)]
    if not zs:
        continue
    A = js[0]["start"]; B = js[-1]["start"] + js[-1]["dur"]
    # 日语句间停顿的中点（可用的断句点）
    gaps = [(js[i]["start"] + js[i]["dur"] + js[i + 1]["start"]) / 2 for i in range(len(js) - 1)]
    C = sum(len(z) for z in zs)
    cum, marks = 0, [A]
    for z in zs[:-1]:
        cum += len(z)
        raw = A + (cum / C) * (B - A)
        # 单句页没有句间气口可吸附（gaps 为空），退回纯按字数摊，否则 marks 比 zs 短、后面要越界
        marks.append(min(gaps, key=lambda g: abs(g - raw)) if gaps else raw)
    marks.append(B + 0.6)
    for i, z in enumerate(zs):
        s = marks[i] + (0 if i == 0 else 0.0)
        e = marks[i + 1] - 0.06
        if e - s < 0.8:
            e = s + 0.8
        out.append("Dialogue: 0,%s,%s,ZH,,0,0,0,,%s" % (ts(s), ts(e), wrap_cn(z, LIM)))
        kept += 1
Path(a.out).write_text("\n".join(out) + "\n", encoding="utf-8")
print("%s  %d 条" % (a.out, kept))
