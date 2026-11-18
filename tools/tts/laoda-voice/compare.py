"""复验合成结果：时长/峰值/RMS + F0 是否跟住参考音色"""
import glob, os, sys
import numpy as np
import soundfile as sf

REF = sys.argv[1] if len(sys.argv) > 1 else r"$TMP\tts\vocal\vocal_t06_08m15-08m38.wav"
OUT = sys.argv[2] if len(sys.argv) > 2 else r"$TMP\tts\laoda-zh"
HOP, WIN = int(0.02 * 22050), int(0.04 * 22050)


def mono(p):
    x, sr = sf.read(p, always_2d=True)
    x = x.mean(axis=1).astype(np.float64)
    n = int(len(x) * 22050 / sr)
    if sr != 22050:
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    return x, len(x) / 22050


def f0_med(x):
    LAGMIN, LAGMAX = int(22050 / 380), int(22050 / 65)
    w = np.hanning(WIN)
    vals = []
    nfft = 1 << (2 * WIN - 1).bit_length()
    for s in range(0, len(x) - WIN, HOP):
        fr = x[s:s + WIN] * w
        if np.sqrt(np.mean(fr ** 2)) < 1e-4:
            continue
        ac = np.fft.irfft(np.fft.rfft(fr, n=nfft) * np.conj(np.fft.rfft(fr, n=nfft)), n=nfft)[:LAGMAX + 1]
        seg = ac[LAGMIN:LAGMAX + 1]
        k = int(np.argmax(seg))
        if seg[k] / (ac[0] + 1e-12) > 0.25:
            vals.append(22050 / (LAGMIN + k))
    return (float(np.median(vals)), len(vals)) if vals else (float("nan"), 0)


xr, dur_r = mono(REF)
m_ref, n_ref = f0_med(xr[:int(15 * 22050)])   # 模型实际只用前 15s
print(f"参考 t06 前 15s: F0 中位 {m_ref:.1f} Hz ({n_ref} 有声帧)")
print(f"\n{'文件':>10} {'时长':>6} {'峰值':>6} {'RMS dB':>7} {'F0中位':>7} {'偏离':>7}")
for p in sorted(glob.glob(os.path.join(OUT, "[0-9][0-9].wav"))):
    x, d = mono(p)
    pk = float(np.max(np.abs(x)))
    rms = 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
    m, n = f0_med(x)
    off = 100 * (m - m_ref) / m_ref if n and np.isfinite(m) else float("nan")
    print(f"{os.path.basename(p):>10} {d:6.2f} {pk:6.3f} {rms:7.1f} {m:7.1f} {off:+6.0f}%")
