# -*- coding: utf-8 -*-
"""稿子 -> TTS 输入（日语）与中文对照（字幕），以及从真实音频反推时间轴。

用法：
  python3 pipeline/dub.py                 生成 dubbing/字幕.ja.txt（TTS 输入）+ 字幕.zh.txt（中文对照）
  python3 pipeline/dub.py --timeline <dir>  读 <dir>/NN.wav 的真实时长，产出 dubbing/字幕.srt 与 data/cues.json
                                            逐句 wav 配日语稿（111 句）还是中文稿（72 句），按句数自动判定
"""
import json, subprocess, pathlib, re, sys, wave

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "script"
DUB = ROOT / "dubbing"
GAP = 0.6          # 句间气口（秒）
TAIL = 11.5  # 收尾页（「完」）没有口播，但在 cues 里占一条：分镜排程按 pages 推进，缺它就永远到不了最后一页、落幕也不触发；11.5s = 落幕前留白 + 沉海 2.6s + 纯黑收尾

CPS_JA = 5.6       # 日语粗排速率（字/秒），只用于占位时间戳，不参与成片


def _sections(text):
    ms = [m for m in re.finditer(r"^### (\d\d)[ \t]*(.*)$", text, re.M)]
    for k, m in enumerate(ms):
        end = ms[k + 1].start() if k + 1 < len(ms) else len(text)
        yield int(m.group(1)), m.group(2).strip(), text[m.end():end]


def zh_spoken(body):
    m = re.search(r"\*\*口播（[^）]*）\*\*：?", body)
    if not m:
        return ""
    tail = body[m.end():]
    tail = re.split(r"^\s*-?\s*\*\*", tail, flags=re.M)[0]
    return tail.split("---")[0].strip()


def ja_spoken(body):
    s = body.split("---")[0].strip()
    return "" if s.strip() in ("", "（無）", "(無)") else s


def sentences(text):
    out = []
    for para in re.split(r"\n+", text):
        t = para.replace("*", "").replace(chr(96), "").strip()
        if not t:
            continue
        buf = ""
        for ch in t:
            buf += ch
            if ch in "。！？；…":
                out.append(buf.strip()); buf = ""
        if buf.strip():
            out.append(buf.strip())
    return [s for s in out if len(s) > 1]


def stamp(sec):
    s = int(round(sec))
    if s < 60:
        return "%ds" % s
    return "%dmin%02ds" % (s // 60, s % 60)


def build():
    zh = list(_sections((SCRIPT / "口播稿.md").read_text(encoding="utf-8")))
    ja = {n: ja_spoken(t) for n, _, t in _sections((SCRIPT / "口播稿.ja.md").read_text(encoding="utf-8"))}
    jl, zl, meta = [], [], []
    clock = 0.0
    for n, title, body in zh:
        zs = sentences(zh_spoken(body))
        js = sentences(ja.get(n, ""))
        if not js and not zs:
            continue
        if len(js) != len(zs):
            print("!! 第 %d 页中日句数不一致：中 %d / 日 %d" % (n, len(zs), len(js)))
        jl.append("# —— 第 %d 页 · %s ——" % (n, title))
        zl.append("# —— 第 %d 页 · %s ——" % (n, title))
        meta.append({"page": n, "title": title, "first": len(jl) - 1, "count": max(len(js), len(zs))})
        for i in range(max(len(js), len(zs))):
            jt = js[i] if i < len(js) else ""
            zt = zs[i] if i < len(zs) else ""
            if jt.strip():
                jl.append("%s %s" % (stamp(clock), jt))
            if zt.strip():
                zl.append("%s %s" % (stamp(clock), zt))
            clock += len(jt) / CPS_JA + GAP
        jl.append(""); zl.append("")
    hdr = ("# 由 pipeline/dub.py 从 script/口播稿.%s 生成，勿手改。\n"
           "# 格式：行首 Xs / XminYs 是起始占位（真正的轴由音频实测反推）。\n")
    DUB.mkdir(exist_ok=True)
    (DUB / "字幕.ja.txt").write_text(hdr % "ja" + "\n".join(jl) + "\n", encoding="utf-8")
    (DUB / "字幕.zh.txt").write_text(hdr % "md" + "\n".join(zl) + "\n", encoding="utf-8")
    (DUB / "pages.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    tot = sum(m["count"] for m in meta)
    print("[dub] %d 页 / %d 句；占位总长 %.1f 分钟" % (len(meta), tot, clock / 60))


def envelope(path):
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def parse_lines(path):
    """读 dub 生成的 字幕.xx.txt：返回 [(页码, 页标题, 句子)]"""
    out, page, title = [], None, ""
    for l in path.read_text(encoding="utf-8").split("\n"):
        if l.startswith("# —— 第"):
            m = re.match(r"# —— 第 (\d+) 页 · (.*) ——", l)
            page, title = int(m.group(1)), m.group(2)
            continue
        if not l.strip() or l.startswith("#"):
            continue
        m = re.match(r"^\S+\s+(\S.*)$", l)
        if m and page:
            out.append((page, title, m.group(1).strip()))
    return out


def timeline(clipdir):
    d = pathlib.Path(clipdir)
    files = [p for p in d.glob("*.wav") if re.fullmatch(r"\d+", p.stem)]
    files.sort(key=lambda p: int(p.stem))
    ja = parse_lines(DUB / "字幕.ja.txt")
    zh = parse_lines(DUB / "字幕.zh.txt")
    # 逐句 wav 配哪套稿子看句数：日语女声按 字幕.ja.txt 逐句出（111 句），
    # 中文女声按 字幕.zh.txt 逐句出（72 句）。两套句数不同，配错会让整片页轴错位。
    if len(files) == len(zh):
        lines, lang = zh, "zh"
    elif len(files) == len(ja):
        lines, lang = ja, "ja"
    else:
        raise SystemExit("!! wav %d 句，与日语稿 %d 句 / 中文稿 %d 句都对不上" % (len(files), len(ja), len(zh)))
    rows, t = [], 0.0
    for f, (pg, ti, tx) in zip(files, lines):
        with wave.open(str(f), "rb") as w:
            dur = w.getnframes() / float(w.getframerate())
        rows.append({"wav": f.name, "page": pg, "start": round(t, 3), "dur": round(dur, 3), "text": tx})
        t += dur + GAP
    # 每页：起止 = 该页首句起点 → 末句终点
    pages, seen = [], {}
    for r in rows:
        if r["page"] not in seen:
            seen[r["page"]] = len(pages)
            pages.append({"page": r["page"], "start": r["start"], "end": round(r["start"] + r["dur"], 3), "n": 1})
        else:
            p = pages[seen[r["page"]]]
            p["end"] = round(r["start"] + r["dur"], 3); p["n"] += 1
    for p in pages:
        p["dur"] = round(p["end"] - p["start"], 3)
    # 中文 SRT
    if lang == "zh":
        # 音频本身就是逐句中文：字幕直接用它自己的开口/收口，不再摊
        subs = [{"page": r["page"], "start": r["start"], "end": round(r["start"] + r["dur"], 3), "text": r["text"]}
                for r in rows]
    else:
        # 日语音频 + 中文对照稿：句数不等，按字数把每页真实时长分给该页各句
        subs = []
        for p in pages:
            zs = [x[2] for x in zh if x[0] == p["page"]]
            if not zs:
                continue
            total = sum(len(s) for s in zs) or 1
            cur = p["start"]
            for k, s in enumerate(zs):
                share = p["dur"] * len(s) / total
                a = cur
                b = p["end"] if k == len(zs) - 1 else cur + max(1.2, share - 0.12)
                subs.append({"page": p["page"], "start": round(a, 3), "end": round(min(b, p["end"]), 3), "text": s})
                cur = b + 0.12
    # 收尾页：无口播、纯静默占位
    # 收尾页前留一拍（1.5s）：最后一句念完不要立刻翻页
    t = round(t + 1.5, 3)
    tail = {"page": (pages[-1]["page"] + 1 if pages else 1), "start": round(t, 3),
            "end": round(t + TAIL, 3), "n": 0}
    tail["dur"] = round(tail["end"] - tail["start"], 3)
    pages.append(tail)
    t = tail["end"]
    (ROOT / "data" / "cues.json").write_text(json.dumps(
        {"total": round(t, 3), "gap": GAP, "pages": pages, "sentences": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    out = []
    for i, s in enumerate(subs, 1):
        out.append("%d\n%s --> %s\n%s\n" % (i, srt(s["start"]), srt(s["end"]), s["text"]))
    (DUB / "字幕.srt").write_text("\n".join(out), encoding="utf-8")
    # cues 是**构建期内联**进 index.html 的（build.mjs 读 data/cues.json 写 window.__CUES__）。
    # 改了 cues 不重建，页面用的还是旧轴：录出来的翻页点对不上、最后一页也可能到不了。
    html = ROOT / "index.html"
    if html.exists() and html.stat().st_mtime < (ROOT / "data" / "cues.json").stat().st_mtime:
        print("[dub] cues.json 比 index.html 新 —— 自动重建 index.html")
        subprocess.run(["node", "build.mjs"], cwd=str(ROOT), check=True)
    print("[dub] 页 %d / 日语句 %d / 中文字幕 %d 条；成片时长 %.1f 分钟" % (len(pages), len(rows), len(subs), t / 60))


def srt(s):
    ms = int(round(s * 1000))
    h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); sec, ms = divmod(ms, 1000)
    return "%02d:%02d:%02d,%03d" % (h, m, sec, ms)


if __name__ == "__main__":
    if "--timeline" in sys.argv:
        timeline(sys.argv[sys.argv.index("--timeline") + 1])
    else:
        build()
