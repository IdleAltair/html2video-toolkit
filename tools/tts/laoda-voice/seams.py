"""接缝体检 + 归一版试听轨。
量三件事（归一前 vs 归一后对比）：
  ① 相邻句净语速落差（忽快忽慢）
  ② 相邻句交界处的静音总长（间距忽长忽短）
  ③ 首尾静音长度分布
"""
import glob, io, json, os
import numpy as np
import soundfile as sf

SR = 24000
HOP, WIN = int(0.01 * SR), int(0.03 * SR)
CHARS = {r["file"]: r["chars"] for r in json.load(io.open(r"$TMP\tts\dub-zh\durations.json", encoding="utf-8"))}


def stats(p):
    x, sr = sf.read(p)
    x = x if x.ndim == 1 else x.mean(axis=1)
    fr = np.array([np.sqrt(np.mean(x[s:s + WIN] ** 2)) for s in range(0, max(1, len(x) - WIN), HOP)])
    thr = fr.max() * 10 ** (-40 / 20)
    v = fr > thr
    if not v.any():
        return 0, 0, 0
    i0, i1 = int(np.argmax(v)), len(v) - int(np.argmax(v[::-1]))
    lead = i0 * HOP / SR
    tail = (len(v) - i1) * HOP / SR
    speak = v[i0:i1].sum() * HOP / SR
    return lead + tail, speak, CHARS[os.path.basename(p)] / speak if speak > 0.05 else 0


def report(tag, d):
    ps = sorted(glob.glob(os.path.join(d, "[0-9][0-9].wav")))
    pad, rate, tot = [], [], 0.0
    per = []
    for p in ps:
        a, s, r = stats(p)
        pad.append(a); rate.append(r); tot += a + s
        per.append((os.path.basename(p), a, s, r))
    jumps = [abs(rate[i + 1] - rate[i]) / ((rate[i + 1] + rate[i]) / 2) for i in range(len(rate) - 1)]
    print(f"\n=== {tag} ===")
    print(f"语音总长 {tot:.1f}s = {tot/60:.1f} 分钟")
    print(f"净语速：中位 {np.median(rate):.2f}  P10 {np.percentile(rate,10):.2f}  P90 {np.percentile(rate,90):.2f}  极差 {max(rate)-min(rate):.2f}")
    print(f"相邻句语速落差：中位 {np.median(jumps)*100:.1f}%  P90 {np.percentile(jumps,90)*100:.1f}%  最大 {max(jumps)*100:.1f}%")
    print(f"首尾静音：中位 {np.median(pad)*1000:.0f}ms  P90 {np.percentile(pad,90)*1000:.0f}ms  最大 {max(pad)*1000:.0f}ms")
    worst = sorted(range(len(jumps)), key=lambda i: -jumps[i])[:5]
    print("落差最大的 5 个交界：", [(ps[i][-10:-4], f"{jumps[i]*100:.0f}%") for i in worst])
    return per


a = report("归一前 dub-zh", r"$TMP\tts\dub-zh")
b = report("归一后 dub-zh-norm", r"$TMP\tts\dub-zh-norm")

# 归一版整片试听轨（句间不额外加静音，就用各句自带的首尾静音，模拟 dsh 直接拼接的效果）
buf = []
for p in sorted(glob.glob(r"$TMP\tts\dub-zh-norm\[0-9][0-9].wav")):
    x, sr = sf.read(p)
    buf.append((x if x.ndim == 1 else x.mean(axis=1)).astype(np.float64))
mix = np.concatenate(buf)
sf.write(r"$TMP\tts\dub-zh-norm\preview_full.wav",
         (mix / max(1e-9, np.abs(mix).max()) * 0.9).astype(np.float32), SR, subtype="PCM_16")
print(f"\n试听轨 -> dub-zh-norm/preview_full.wav  {len(mix)/SR:.1f}s = {len(mix)/SR/60:.1f} 分钟（句间未加额外静音）")
