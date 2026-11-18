"""把过长的首尾静音裁到统一上限（只裁不补），并复测接缝。"""
import glob, io, json, os
import numpy as np
import soundfile as sf

SR = 24000
HOP, WIN = int(0.01 * SR), int(0.03 * SR)
CAP = 0.15          # 首尾各最多留 150ms
SRC = r"$TMP\tts\dub-zh-norm"
DST = r"$TMP\tts\dub-zh-final"
os.makedirs(DST, exist_ok=True)

CHARS = {r["file"]: r["chars"] for r in json.load(io.open(r"$TMP\tts\dub-zh\durations.json", encoding="utf-8"))}


def envelope(x):
    fr = np.array([np.sqrt(np.mean(x[s:s + WIN] ** 2)) for s in range(0, max(1, len(x) - WIN), HOP)])
    thr = fr.max() * 10 ** (-40 / 20)
    v = fr > thr
    i0, i1 = int(np.argmax(v)), len(v) - int(np.argmax(v[::-1]))
    return i0 * HOP, i1 * HOP, v


rows, cut = [], 0
for p in sorted(glob.glob(os.path.join(SRC, "[0-9][0-9].wav"))):
    f = os.path.basename(p)
    x, sr = sf.read(p)
    x = x if x.ndim == 1 else x.mean(axis=1)
    a, b, v = envelope(x)
    lead, tail = a / SR, (len(x) - b) / SR
    nl = min(lead, CAP) if lead > CAP else max(lead, 0.02)
    nt = min(tail, CAP) if tail > CAP else max(tail, 0.02)
    if lead > CAP or tail > CAP:
        cut += 1
    s0 = max(0, int(a - nl * SR))
    s1 = min(len(x), int(b + nt * SR))
    y = x[s0:s1]
    sf.write(os.path.join(DST, f), y, SR, subtype="PCM_16")
    speak = v[int(a / HOP):int(b / HOP)].sum() * HOP / SR
    rows.append({"file": f, "sec": round(len(y) / SR, 3), "chars": CHARS[f],
                 "speak": round(speak, 3), "rate": round(CHARS[f] / speak, 2) if speak > 0.05 else 0,
                 "pad": round(len(y) / SR - speak, 3)})
    if lead > CAP or tail > CAP:
        print(f"  {f} 首尾静音 {lead*1000:.0f}+{tail*1000:.0f}ms -> {nl*1000:.0f}+{nt*1000:.0f}ms")

io.open(os.path.join(DST, "durations.json"), "w", encoding="utf-8").write(
    json.dumps(rows, ensure_ascii=False, indent=1))

rate = [r["rate"] for r in rows]
pad = [r["pad"] for r in rows]
jumps = [abs(rate[i + 1] - rate[i]) / ((rate[i + 1] + rate[i]) / 2) for i in range(len(rate) - 1)]
gap = []
for i in range(len(rows) - 1):
    gap.append((rows[i]["pad"] + rows[i + 1]["pad"]) / 2)
tot = sum(r["sec"] for r in rows)
print(f"\n裁了 {cut} 句。最终 {len(rows)} 句，语音总长 {tot:.1f}s = {tot/60:.1f} 分钟")
print(f"净语速：中位 {np.median(rate):.2f}  P10 {np.percentile(rate,10):.2f}  P90 {np.percentile(rate,90):.2f}")
print(f"相邻句语速落差：中位 {np.median(jumps)*100:.1f}%  最大 {max(jumps)*100:.1f}%")
print(f"首尾静音合计：中位 {np.median(pad)*1000:.0f}ms  最大 {max(pad)*1000:.0f}ms")
print(f"相邻句交界间距：中位 {np.median(gap)*1000:.0f}ms  最大 {max(gap)*1000:.0f}ms")

buf = []
for r in rows:
    x, _ = sf.read(os.path.join(DST, r["file"]))
    buf.append((x if x.ndim == 1 else x.mean(axis=1)).astype(np.float64))
mix = np.concatenate(buf)
sf.write(os.path.join(DST, "preview_full.wav"),
         (mix / max(1e-9, np.abs(mix).max()) * 0.9).astype(np.float32), SR, subtype="PCM_16")
print(f"试听轨 -> dub-zh-final/preview_full.wav  {len(mix)/SR:.1f}s = {len(mix)/SR/60:.1f} 分钟")
