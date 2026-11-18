#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
人声残留检测：以原始音轨的语音活动为参照，看"没人说话的帧"里 Vocals stem 还剩多少能量。
  - gap 帧 = 原始 RMS 低于本段语音门限的帧
  - 若分离干净：gap 帧在 Vocals 里应接近底噪（比语音帧低很多 dB）
  - 若 BGM 漏进人声：gap 帧能量与语音帧同量级
用法：python residual.py <voc_pair_dir>   # 目录里需有 tXX_(Vocals)*.wav 与 tXX_(Instrumental)*.wav
"""
import glob, os, sys
import numpy as np
import soundfile as sf

PAD = 3
SEG = [("05", 400, 414), ("06", 495, 518), ("10", 844, 855)]
RAW = "$TMP/tts/raw"

def mono(path):
    x, sr = sf.read(path, always_2d=True)
    return x.mean(axis=1).astype(np.float64), sr

def frames(x, sr, hop=0.02, win=0.05):
    h, w = int(sr * hop), int(sr * win)
    return np.array([np.sqrt(np.mean(x[s:s+w] ** 2) + 1e-12)
                     for s in range(0, max(1, len(x) - w + 1), h) if s + w <= len(x)])

def db(v):
    return 20 * np.log10(v + 1e-12)

d = sys.argv[1] if len(sys.argv) > 1 else "$TMP/tts/voc_ab"
print(f"{'seg':>4} {'dur':>5} {'Voc dB':>7} {'Ins dB':>7} {'Recon dB':>9} "
      f"{'Voc-sp':>7} {'Voc-gap':>8} {'leak dB':>8} {'ins-gap':>8} {'sp/gap帧':>10}")
for sid, s, e in SEG:
    vc = sorted(glob.glob(os.path.join(d, f"t{sid}*(Vocals)*.wav")))
    ic = sorted(glob.glob(os.path.join(d, f"t{sid}*(Instrumental)*.wav")))
    if not vc or not ic:
        print(f"t{sid}: missing stems"); continue
    v, sv = mono(vc[0]); i, si = mono(ic[0])
    r, sr_ = mono(os.path.join(RAW, f"t{sid}.wav"))
    a = int(sv * PAD); b = a + int(sv * (e - s))
    v = v[a:b]; i = i[a:b]
    # 原始重采样到 stem 采样率以便逐帧对齐
    n = int(len(r) * sv / sr_)
    rr = np.interp(np.linspace(0, len(r) - 1, n), np.arange(len(r)), r)
    nmin = min(len(v), len(i), len(rr))
    v, i, rr = v[:nmin], i[:nmin], rr[:nmin]

    fv, fi, fr = frames(v, sv), frames(i, sv), frames(rr, sv)
    m = min(len(fv), len(fi), len(fr)); fv, fi, fr = fv[:m], fi[:m], fr[:m]
    # 用原始音轨定语音/间隙：峰值帧能量 -35dB 以上算语音
    thr = fr.max() * 10 ** (-35 / 20)
    sp_mask, gap_mask = fr > thr, fr <= thr
    voc_sp = db(np.mean(fv[sp_mask])) if sp_mask.any() else -120
    voc_gap = db(np.mean(fv[gap_mask])) if gap_mask.any() else -120
    ins_gap = db(np.mean(fi[gap_mask])) if gap_mask.any() else -120
    recon = db(np.sqrt(np.mean((v + i) ** 2) + 1e-12))
    print(f"t{sid:>2} {nmin/sv:5.1f} {db(np.sqrt(np.mean(v**2))):7.1f} "
          f"{db(np.sqrt(np.mean(i**2))):7.1f} {recon:9.1f} "
          f"{voc_sp:7.1f} {voc_gap:8.1f} {voc_gap-voc_sp:8.1f} {ins_gap:8.1f} "
          f"{int(sp_mask.sum()):5d}/{int(gap_mask.sum())}")
print("\n判据：leak dB = Voc-gap - Voc-speech，越负越好。< -18dB 表示说话间隙基本干净；")
print("      接近 -6dB 表示 BGM 大量漏进人声。ins-gap 是这些间隙被归到伴奏侧的能量。")
print("      gap帧=0 表示这段 50ms 粒度上找不到停顿（连读），leak 无从判定，不代表有问题。")
