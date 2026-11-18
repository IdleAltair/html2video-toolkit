#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把分离结果裁掉前后 3s 上下文，落成带原始时间戳命名的 12 段人声。"""
import glob, os, sys
import soundfile as sf

SRC_DIR = sys.argv[1] if len(sys.argv) > 1 else "$TMP/tts/voc"
DST_DIR = sys.argv[2] if len(sys.argv) > 2 else "$TMP/tts/vocal"
PAD = 3
SEG = [
    ("01", "00m26-00m32", 26, 32), ("02", "01m58-02m10", 118, 130),
    ("03", "04m31-04m42", 271, 282), ("04", "05m24-05m32", 324, 332),
    ("05", "06m40-06m54", 400, 414), ("06", "08m15-08m38", 495, 518),
    ("07", "09m23-09m39", 563, 579), ("08", "10m38-10m51", 638, 651),
    ("09", "12m38-12m54", 758, 774), ("10", "14m04-14m15", 844, 855),
    ("11", "15m08-15m20", 908, 920), ("12", "17m19-17m29", 1039, 1049),
]
os.makedirs(DST_DIR, exist_ok=True)
for sid, tag, s, e in SEG:
    cand = sorted(glob.glob(os.path.join(SRC_DIR, f"t{sid}*(Vocals)*.wav")))
    if not cand:
        print(f"t{sid}: MISSING"); continue
    x, sr = sf.read(cand[0], always_2d=True)
    a, b = int(sr * PAD), int(sr * (PAD + (e - s)))
    v = x[a:b]
    out = os.path.join(DST_DIR, f"vocal_t{sid}_{tag}.wav")
    sf.write(out, v, sr, subtype="PCM_16")
    print(f"t{sid} {tag}  {len(v)/sr:.2f}s  {sr}Hz {v.shape[1]}ch -> {os.path.basename(out)}")
print("total files:", len(glob.glob(os.path.join(DST_DIR, '*.wav'))))
