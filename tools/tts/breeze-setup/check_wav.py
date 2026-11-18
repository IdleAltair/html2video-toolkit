import sys, glob
import numpy as np, soundfile as sf

for p in sorted(f for g in sys.argv[1:] for f in glob.glob(g)):
    x, sr = sf.read(p, dtype="float32")
    if x.ndim > 1:
        x = x.mean(axis=1)
    peak = float(np.abs(x).max())
    rms = float(np.sqrt((x ** 2).mean()))
    # 帧级静音占比：20ms 帧，RMS 低于全片峰值帧 RMS 的 5% 视为静音
    fl = int(0.02 * sr)
    frames = x[: len(x) // fl * fl].reshape(-1, fl)
    fr = np.sqrt((frames ** 2).mean(axis=1))
    quiet = float((fr < 0.05 * fr.max()).mean())
    # 语音带内(80-4000Hz)能量占比，全噪声/纯音会异常
    sp = np.abs(np.fft.rfft(x))
    frq = np.fft.rfftfreq(len(x), 1 / sr)
    band = float(sp[(frq >= 80) & (frq <= 4000)].sum() / sp[frq > 0].sum())
    print(f"{p}: {len(x)/sr:.2f}s  peak={peak:.3f}  rms={rms:.4f}  静音帧={quiet:.1%}  带内能量={band:.1%}")
