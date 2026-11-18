# -*- coding: utf-8 -*-
"""口播稿-分页.md → tts.json（逐句，带页号）。"""
import io, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MD = os.path.join(ROOT, "narration", "口播稿-分页.md")
OUT = os.path.join(ROOT, "tts", "tts.json")

rows, page = [], 0
for line in io.open(MD, encoding="utf-8"):
    h = re.match(r"^##\s+p(\d+)", line)
    if h:
        page = int(h.group(1)); continue
    m = re.match(r"^\s*(\d+)\.\s+(.+?)\s*$", line)
    if m and page:
        rows.append({"i": len(rows) + 1, "page": page, "text": m.group(2)})

json.dump(rows, io.open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("句子", len(rows), "→", OUT)
for p in sorted({r["page"] for r in rows}):
    print("  p%02d" % p, sum(1 for r in rows if r["page"] == p), "句")
