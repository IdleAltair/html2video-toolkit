#!/usr/bin/env python3
"""按成品 index.html 实际用到的字符，把 Regular/Bold 两个字重子集化成 WOFF2。
文案变了（新增汉字）就要重跑本脚本，再 node build.mjs。"""
import subprocess, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"
ASSETS = ROOT / "assets"
chars = sorted(set(HTML.read_text(encoding="utf-8")))
# 兜底：把可能动态拼出来的数字/标点/常用符号全带上
chars += [chr(c) for c in range(0x20, 0x7f)]
chars = sorted(set(chars))
txt = ASSETS / "_glyphs.txt"
txt.write_text("".join(chars), encoding="utf-8")
print("唯一字符 %d 个" % len(chars))
for weight, src in ((400, ASSETS / "NotoSansSC-Regular.otf"), (700, ASSETS / "NotoSansSC-Bold.otf")):
    if not src.exists():
        src = ROOT.parent / "NotoSansSC-Regular.otf" if weight == 400 else None
    out = ASSETS / ("noto-%d.woff2" % weight)
    subprocess.check_call([sys.executable, "-m", "fontTools.subset", str(src),
                           "--text-file=%s" % txt, "--flavor=woff2", "--output-file=%s" % out,
                           "--layout-features=kern,liga,clig,calt,vert", "--no-hinting", "--desubroutinize"])
    print("%s -> %s  %.0f KB" % (src.name, out.name, out.stat().st_size / 1024))
