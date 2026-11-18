"""t06 开头包络 + 滑窗 F0：找残音与本人说话之间的停顿，并检查段内是否换了说话人"""
import sys
import numpy as np
import soundfile as sf

P = sys.argv[1] if len(sys.argv) > 1 else r"$TMP\tts\vocal\vocal_t06_08m15-08m38.wav"
SR = 44100
x, sr = sf.read(P, always_2d=True)
x = x.mean(axis=1).astype(np.float64)

HOP, WIN = int(0.02 * sr), int(0.05 * sr)
f = np.array([20 * np.log10(np.sqrt(np.mean(x[s:s + WIN] ** 2)) + 1e-12)
              for s in range(0, len(x) - WIN + 1, HOP)])
t = np.arange(len(f)) * HOP / sr

peak = f.max()
thr = peak - 30          # 比峰值低 30dB 以上视作停顿
print("前 4s 每 100ms 帧能量(dB，相对峰值 %.1f dBFS)：" % peak)
for i in range(0, min(len(f), int(4.0 / (HOP / sr))), 5):
    bar = "#" * max(0, int((f[i] - (peak - 45)) / 1.5))
    print(f"  {t[i]:5.2f}s {f[i]:7.1f} {bar}")

# 找 0–3s 内第一个持续 >=120ms 的低能量区间
run = None
i = 0
while i < len(f) and t[i] < 3.5:
    if f[i] < thr:
        j = i
        while j < len(f) and f[j] < thr:
            j += 1
        if (j - i) * HOP / sr >= 0.12:
            run = (t[i], t[j], (j - i) * HOP / sr)
            break
        i = j
    else:
        i += 1
print(f"\n第一个可用停顿: {run}")

# 滑窗 F0（每 1s 一格，看段内是否换人）
def f0_win(y):
    LMIN, LMAX = int(sr / 380), int(sr / 65)
    w = np.hanning(int(0.04 * sr))
    vals = []
    nfft = 1 << (2 * len(w) - 1).bit_length()
    for s in range(0, len(y) - len(w), int(0.02 * sr)):
        fr = y[s:s + len(w)] * w
        if np.sqrt(np.mean(fr ** 2)) < 1e-4:
            continue
        ac = np.fft.irfft(np.fft.rfft(fr, n=nfft) * np.conj(np.fft.rfft(fr, n=nfft)), n=nfft)[:LMAX + 1]
        seg = ac[LMIN:LMAX + 1]
        k = int(np.argmax(seg))
        if seg[k] / (ac[0] + 1e-12) > 0.25:
            vals.append(sr / (LMIN + k))
    return (float(np.median(vals)), len(vals)) if vals else (float("nan"), 0)

print("\n每秒 F0 中位（找说话人切换）：")
for k in range(0, min(23, int(len(x) / sr))):
    y = x[int(k * sr):int((k + 1) * sr)]
    m, n = f0_win(y)
    print(f"  {k:2d}-{k+1:2d}s  F0 {m:6.1f} Hz  ({n:3d} 帧)")
