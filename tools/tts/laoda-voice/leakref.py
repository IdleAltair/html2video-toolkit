#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
反向验证 leak 指标：同一套计算分别喂
  voc    = BS-Roformer 分离后的人声
  center = 不经模型、只做立体声下混（丢弃 side 分量）的基线
指标若有效，center 的 leak 必须明显更差（因为 BGM 还留在里面）。
"""
import glob, os, sys
import numpy as np
import soundfile as sf

SR = 44100
PAD = 3
SEG = [("01", 26, 32), ("02", 118, 130), ("03", 271, 282), ("04", 324, 332),
       ("05", 400, 414), ("06", 495, 518), ("07", 563, 579), ("08", 638, 651),
       ("09", 758, 774), ("10", 844, 855), ("11", 908, 920), ("12", 1039, 1049)]
HOP, WIN = int(0.02 * SR), int(0.05 * SR)

def mono(p):
    x, sr = sf.read(p, always_2d=True)
    x = x.mean(axis=1).astype(np.float64)
    if sr != SR:
        n = int(len(x) * SR / sr)
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    return x

def frames(x):
    return np.array([np.sqrt(np.mean(x[s:s + WIN] ** 2) + 1e-12)
                     for s in range(0, len(x) - WIN + 1, HOP)])

def db(v):
    return 20 * np.log10(v + 1e-12)

full = mono("$TMP/tts/full.wav")
print(f"{'seg':>4} | {'模型 leak':>9} | {'下混 leak':>9} | {'差':>6}")
dv, dc = [], []
for sid, s, e in SEG:
    want = e - s
    r = full[int(SR * s):int(SR * e)]
    fr = frames(r[:int(SR * want)])
    lo, hi = np.percentile(fr, 10), np.percentile(fr, 60)
    sp, gp = fr >= hi, fr <= lo
    out = []
    for src, bag in (("voc", sorted(glob.glob(f"$TMP/tts/voc/t{sid}*(Vocals)*.wav"))[0]),
                     ("center", f"$TMP/tts/center/t{sid}.wav")):
        v = mono(bag)
        if src == "voc":
            v = v[int(SR * PAD):int(SR * (PAD + want))]
        fv = frames(v[:int(SR * want)])
        k = min(len(fv), len(fr)); fv = fv[:k]
        leak = db(np.mean(fv[gp[:k]])) - db(np.mean(fv[sp[:k]]))
        out.append(leak)
    dv.append(out[0]); dc.append(out[1])
    print(f"t{sid:>2} | {out[0]:9.1f} | {out[1]:9.1f} | {out[1]-out[0]:6.1f}")
print(f"\n均值 模型 {np.mean(dv):.1f} dB  下混基线 {np.mean(dc):.1f} dB  "
      f"分离多拿走 {np.mean(dc)-np.mean(dv):.1f} dB")
print(f"最差单段：模型 {max(dv):.1f} dB（t{int(np.argmax(dv))+1:02d}），下混 {max(dc):.1f} dB")
