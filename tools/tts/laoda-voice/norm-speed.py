"""按净语速做时间拉伸（atempo，不变调）。
夹取策略：净语速压进 靶值 ±10% 之内，区间内的句子一律不动 ——
避免把 5 字短句加速 1.7 倍反而更怪。原始文件保留在 dub-zh/。
"""
import io, json, os, subprocess, sys
import numpy as np
import soundfile as sf

FF = r"$DESKTOP\screenshot\llm-html2video\bin\ffmpeg.exe"
SRC = r"$TMP\tts\dub-zh"
DST = r"$TMP\tts\dub-zh-norm"
TARGET = 8.02          # 你挑中那档样音的净语速
BAND = 0.10            # 允许 ±10%，区间内不动
SR = 24000
HOP, WIN = int(0.01 * SR), int(0.03 * SR)

os.makedirs(DST, exist_ok=True)
rows = json.load(io.open(os.path.join(SRC, "net_rates.json"), encoding="utf-8"))


def net_rate(p, chars):
    x, sr = sf.read(p)
    x = x if x.ndim == 1 else x.mean(axis=1)
    fr = np.array([np.sqrt(np.mean(x[s:s + WIN] ** 2)) for s in range(0, max(1, len(x) - WIN), HOP)])
    v = fr > fr.max() * 10 ** (-40 / 20)
    if not v.any():
        return None
    i0, i1 = int(np.argmax(v)), len(v) - int(np.argmax(v[::-1]))
    sp = v[i0:i1].sum() * HOP / SR
    return chars / sp if sp > 0.05 else None


done = kept = 0
lines = []
for r in sorted(rows, key=lambda x: x["file"]):
    f = r["file"]
    src, dst = os.path.join(SRC, f), os.path.join(DST, f)
    lo, hi = TARGET * (1 - BAND), TARGET * (1 + BAND)
    rt = r["rate"]
    if lo <= rt <= hi:
        subprocess.run([FF, "-v", "error", "-y", "-i", src, "-c:a", "pcm_s16le", dst], check=True)
        kept += 1
        continue
    k = TARGET / rt                       # >1 加速，<1 减速
    subprocess.run([FF, "-v", "error", "-y", "-i", src, "-filter:a", f"atempo={k:.4f}",
                    "-ar", str(SR), "-ac", "1", "-c:a", "pcm_s16le", dst], check=True)
    new = net_rate(dst, r["chars"])
    lines.append((f, r["chars"], rt, k, new, r["total"], round(os.path.getsize(dst) / 2 / SR, 2)))
    done += 1

print(f"不动 {kept} 句（已在 ±10% 内），拉伸 {done} 句")
print(f"{'文件':>8} {'字数':>4} {'原净速':>7} {'atempo':>7} {'复测净速':>8} {'原时长':>7} {'新时长':>7}")
for f, n, rt, k, new, tot, nt in sorted(lines, key=lambda z: z[2]):
    print(f"{f:>8} {n:4d} {rt:7.2f} {k:7.3f} {new if new else float('nan'):8.2f} {tot:7.2f} {nt:7.2f}")
a = [x[4] for x in lines if x[4]]
if a:
    print(f"\n被拉的这些句：复测净语速 min {min(a):.2f} max {max(a):.2f}（靶值 {TARGET}）")
