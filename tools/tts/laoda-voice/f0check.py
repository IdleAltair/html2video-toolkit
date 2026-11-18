#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
说话人一致性粗检：对每段人声 stem 用 FFT 自相关估 F0，看中位数与离散度。
目的是把"听起来不是同一个人"的片段挑出来（男声/女声/合成音的基频分布差异会体现在这里）。
用法：python f0check.py   # 读 $TMP/tts/voc/tXX_(Vocals)*.wav
"""
import glob, os
import numpy as np
import soundfile as sf

SR = 44100
PAD = 3
SEG = [("01", 26, 32), ("02", 118, 130), ("03", 271, 282), ("04", 324, 332),
       ("05", 400, 414), ("06", 495, 518), ("07", 563, 579), ("08", 638, 651),
       ("09", 758, 774), ("10", 844, 855), ("11", 908, 920), ("12", 1039, 1049)]
WIN, HOP = int(0.04 * SR), int(0.02 * SR)
F0MIN, F0MAX = 65.0, 380.0
LAGMIN, LAGMAX = int(SR / F0MAX), int(SR / F0MIN)

def f0_track(x):
    """返回 (f0数组, periodicity数组)，只对有声帧给值，其余 NaN"""
    n = len(x)
    f0s, pers = [], []
    nfft = 1 << (2 * WIN - 1).bit_length()
    w = np.hanning(WIN)
    for s in range(0, n - WIN, HOP):
        fr = x[s:s + WIN] * w
        rms = np.sqrt(np.mean(fr ** 2))
        if rms < 1e-4:
            continue
        spec = np.fft.rfft(fr, n=nfft)
        ac = np.fft.irfft(spec * np.conj(spec), n=nfft)[:LAGMAX + 1]
        e0 = ac[0] + 1e-12
        seg = ac[LAGMIN:LAGMAX + 1]
        k = int(np.argmax(seg))
        lag = LAGMIN + k
        per = seg[k] / e0
        if per > 0.25 and lag > 0:
            f0s.append(SR / lag); pers.append(per)
    return np.array(f0s), np.array(pers)

def mono(p):
    x, sr = sf.read(p, always_2d=True)
    return x.mean(axis=1).astype(np.float64), sr

rows = []
for sid, s, e in SEG:
    p = sorted(glob.glob(f"$TMP/tts/voc/t{sid}*(Vocals)*.wav"))
    if not p:
        print(f"t{sid} MISSING"); continue
    x, sr = mono(p[0])
    v = x[int(sr * PAD):int(sr * (PAD + e - s))]
    f0, per = f0_track(v)
    if len(f0) == 0:
        rows.append((sid, e - s, 0, np.nan, np.nan, np.nan, np.nan)); continue
    q = np.percentile(f0, [25, 50, 75])
    rows.append((sid, e - s, len(f0), q[1], q[0], q[2], float(np.mean(per))))

print(f"{'seg':>4} {'dur':>4} {'帧':>5} {'F0中位':>7} {'P25':>6} {'P75':>6} {'周期度':>7}")
for sid, d, nf, med, p25, p75, per in rows:
    if nf == 0:
        print(f"t{sid:>2} {d:4d} {nf:5d}   (无有声帧)"); continue
    print(f"t{sid:>2} {d:4d} {nf:5d} {med:7.1f} {p25:6.1f} {p75:6.1f} {per:7.3f}")

meds = np.array([r[3] for r in rows if r[2] > 0])
print(f"\n全体 F0 中位数 {np.median(meds):.1f} Hz，跨度 {meds.min():.1f}–{meds.max():.1f} Hz")
print(f"参考：成人男声 85–150 Hz、女声 165–255 Hz；若某段中位数偏离全体中位数 >40%，重点听那一段。")
alloff = np.median(meds)
for sid, d, nf, med, *_ in rows:
    if nf and abs(med - alloff) / alloff > 0.4:
        print(f"  ! t{sid} 偏离 {100*(med-alloff)/alloff:+.0f}%（中位 {med:.0f} Hz vs 全体 {alloff:.0f} Hz）")
