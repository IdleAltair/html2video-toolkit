#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 12 段按原始时间顺序拼成两个试听文件：原始混音 vs 分离后人声。"""
import glob, os
import numpy as np
import soundfile as sf

SR = 44100
OUT = "$TMP/tts"
SEG = [("01", 26, 32), ("02", 118, 130), ("03", 271, 282), ("04", 324, 332),
       ("05", 400, 414), ("06", 495, 518), ("07", 563, 579), ("08", 638, 651),
       ("09", 758, 774), ("10", 844, 855), ("11", 908, 920), ("12", 1039, 1049)]
GAP = np.zeros(int(SR * 0.35))

def to_sr(x, sr):
    if sr == SR:
        return x.astype(np.float32)
    n = int(len(x) * SR / sr)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)

def mono(p):
    x, sr = sf.read(p, always_2d=True)
    return to_sr(x.mean(axis=1), sr)

full, _ = sf.read(os.path.join(OUT, "full.wav"), always_2d=True)
full44 = to_sr(full.mean(axis=1), 48000)

# 原始版
buf = []
for sid, s, e in SEG:
    buf.append(full44[int(SR * s):int(SR * e)])
    buf.append(GAP)
sf.write(os.path.join(OUT, "preview_raw.wav"), np.concatenate(buf), SR, subtype="PCM_16")

# 人声版（裁掉 padding）
buf = []
for sid, s, e in SEG:
    p = sorted(glob.glob(os.path.join(OUT, "voc", f"t{sid}*(Vocals)*.wav")))[0]
    v = mono(p)
    buf.append(v[int(SR * 3):int(SR * (3 + e - s))])
    buf.append(GAP)
sf.write(os.path.join(OUT, "preview_vocal.wav"), np.concatenate(buf), SR, subtype="PCM_16")

for f in ("preview_raw.wav", "preview_vocal.wav"):
    x, sr = sf.read(os.path.join(OUT, f))
    print(f, round(len(x) / sr, 1), "s", f"{os.path.getsize(os.path.join(OUT, f))/1e6:.1f} MB")
