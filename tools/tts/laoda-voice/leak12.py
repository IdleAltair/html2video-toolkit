#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
12 段人声的 BGM 残留检测（不需要伴奏 stem）：
  以原始音轨在 50ms 帧上做 VAD -> 找出"没说话"的间隙帧 -> 量这些帧在 Vocals stem 里的能量。
  间隙越安静，说明 BGM 被拿走越彻底；间隙能量接近语音帧 = 音乐漏进了人声。
"""
import glob, os
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
print(f"{'seg':>4} {'区间':>12} {'dur':>4} {'VocRMS':>7} {'sp帧':>5} {'gap帧':>5} "
      f"{'sp dB':>6} {'gap dB':>7} {'leak dB':>8}  判定")
for sid, s, e in SEG:
    want = e - s
    v = mono(sorted(glob.glob(f"$TMP/tts/voc/t{sid}*(Vocals)*.wav"))[0])
    v = v[int(SR * PAD):int(SR * (PAD + want))]
    r = full[int(SR * s):int(SR * e)]
    m = min(len(v), len(r))
    fv, fr = frames(v[:m]), frames(r[:m])
    k = min(len(fv), len(fr))
    fv, fr = fv[:k], fr[:k]
    # 原始轨的绝对静音门限会被 BGM 撑过，改用分位数取"人声最弱/最强"两端
    lo, hi = np.percentile(fr, 10), np.percentile(fr, 60)
    sp, gp = fr >= hi, fr <= lo
    if not gp.any():
        verdict = "无停顿可判"
        gap_db = leak = float("nan")
    else:
        gap_db = db(np.mean(fv[gp]))
        sp_db = db(np.mean(fv[sp])) if sp.any() else gap_db
        leak = gap_db - sp_db
        verdict = "干净" if leak < -18 else ("可疑：BGM残留" if leak > -10 else "轻度残留")
    print(f"t{sid:>2} {s//60:>2}m{s%60:02d}-{e//60}m{e%60:02d} {want:4d} "
          f"{db(np.sqrt(np.mean(v**2))):7.1f} {int(sp.sum()):5d} {int(gp.sum()):5d} "
          f"{db(np.mean(fv[sp])) if sp.any() else float('nan'):6.1f} {gap_db:7.1f} {leak:8.1f}  {verdict}")
print("\nleak dB = 间隙帧人声能量 - 语音帧人声能量；越负越好（< -18dB 视为间隙干净）。")
print("间隙近似取原始轨能量最低的 10% 帧（人声最弱处），语音取最高的 40% 帧。")
print("注意：间隙里若 UP 主自己留了气口/笑声，会被算成人声残留，判定偏保守。")
