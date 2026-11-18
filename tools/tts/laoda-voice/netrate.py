"""净语速：扣掉首尾静音与句内停顿，只算真正在说话的时间，再对字数。
用来区分"短句的固定开销假象"和"真的念拖了"。
"""
import glob, io, json, os, re
import numpy as np
import soundfile as sf

SR = 24000
HOP, WIN = int(0.01 * SR), int(0.03 * SR)
rows = {r["file"]: r for r in json.load(io.open(r"$TMP\tts\dub-zh\durations.json", encoding="utf-8"))}

out = []
for p in sorted(glob.glob(r"$TMP\tts\dub-zh\*.wav")):
    f = os.path.basename(p)
    x, sr = sf.read(p)
    x = x if x.ndim == 1 else x.mean(axis=1)
    fr = np.array([np.sqrt(np.mean(x[s:s + WIN] ** 2)) for s in range(0, max(1, len(x) - WIN), HOP)])
    thr = fr.max() * 10 ** (-40 / 20)
    voiced = fr > thr
    if not voiced.any():
        continue
    i0, i1 = int(np.argmax(voiced)), len(voiced) - int(np.argmax(voiced[::-1]))
    span = (i1 - i0) * HOP / SR                      # 首末有声点之间
    speak = voiced[i0:i1].sum() * HOP / SR           # 其中真正在说话的
    pad = len(x) / sr - span                         # 首尾静音合计
    n = rows[f]["chars"]
    out.append((f, n, len(x) / sr, pad, speak, n / speak))

out.sort(key=lambda r: r[5])
print(f"{'文件':>9} {'字数':>4} {'总时长':>6} {'首尾静音':>8} {'净说话':>7} {'净字/秒':>7}")
for f, n, tot, pad, sp, r in out:
    flag = "  <-- 偏慢" if r < 5.2 and n >= 20 else ("  <-- 偏快" if r > 8.2 else "")
    print(f"{f:>9} {n:4d} {tot:6.2f} {pad:8.2f} {sp:7.2f} {r:7.2f}{flag}")

rates = [r[-1] for r in out]
pads = [r[3] for r in out]
print(f"\n净语速：min {min(rates):.2f}  中位 {sorted(rates)[len(rates)//2]:.2f}  max {max(rates):.2f}")
print(f"首尾静音：平均 {np.mean(pads):.2f}s  最长 {max(pads):.2f}s")
slow = [r[0] for r in out if r[5] < 5.2 and r[1] >= 20]
fast = [r[0] for r in out if r[5] > 8.2]
print(f"\n真偏慢(≥20字且净语速<5.2) {len(slow)} 句: {slow}")
print(f"偏快(>8.2) {len(fast)} 句: {fast}")
io.open(r"$TMP\tts\dub-zh\net_rates.json", "w", encoding="utf-8").write(
    json.dumps([{"file": f, "chars": n, "total": round(t, 3), "pad": round(pd, 3),
                 "speak": round(sp, 3), "rate": round(r, 2)} for f, n, t, pd, sp, r in out],
               ensure_ascii=False, indent=1))
