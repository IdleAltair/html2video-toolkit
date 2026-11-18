#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
复核人声切片是否适合当 TTS 参考素材：
  - 时长 / 峰值 / RMS(dBFS) / 削波样本
  - 语音活动占比（短时 RMS + 双门限 VAD）
  - BGM 残留代理指标：同窗人声 stem 与伴奏 stem 的能量比
用法：python audit.py <voc_dir> <center_dir> <raw_dir>
"""
import os, sys, glob
import numpy as np
import soundfile as sf

SR = 44100
# 区间表：编号 起点秒 终点秒（=用户给的 mm:ss）
SEG = [
    ("01", 26, 32), ("02", 118, 130), ("03", 271, 282), ("04", 324, 332),
    ("05", 400, 414), ("06", 495, 518), ("07", 563, 579), ("08", 638, 651),
    ("09", 758, 774), ("10", 844, 855), ("11", 908, 920), ("12", 1039, 1049),
]
PAD = 3

def load(path):
    """读成单声道（立体声取均值），返回 (x, sr)"""
    x, sr = sf.read(path, always_2d=True)
    return x.mean(axis=1).astype(np.float64), sr

def rms_db(x):
    v = float(np.sqrt(np.mean(x * x)) + 1e-12)
    return 20 * np.log10(v)

def frame_rms(x, sr, hop=0.02, win=0.05):
    n, h, w = len(x), int(sr * hop), int(sr * win)
    out = []
    for s in range(0, max(1, n - w + 1), h):
        seg = x[s:s + w]
        if len(seg) < w:
            break
        out.append(np.sqrt(np.mean(seg * seg) + 1e-12))
    return np.array(out)

def speech_ratio(x, sr):
    """双门限 VAD：相对本段峰值帧能量的 -35dB 为speech门限，-45dB 为噪声门"""
    f = frame_rms(x, sr)
    if len(f) == 0:
        return 0.0, 0.0
    peak = np.max(f)
    thr = peak * 10 ** (-35 / 20)
    floor = peak * 10 ** (-45 / 20)
    sp = float(np.mean(f > thr))
    # 语音段的平均帧能量（用于判断“是否只是噪声底”）
    sel = f[f > thr]
    act_db = 20 * np.log10(float(np.mean(sel)) + 1e-12) if len(sel) else -120.0
    return sp, act_db

def clip_run(x):
    m = np.abs(x) >= 0.999
    if not m.any():
        return 0
    best = cur = 0
    for v in m:
        cur = cur + 1 if v else 0
        best = max(best, cur)
    return best

def main():
    voc_dir, cen_dir, raw_dir = sys.argv[1:4]
    print(f"{'seg':>4} {'len':>6} {'dur':>6} {'peak':>6} {'RMSdB':>7} {'sp%':>6} "
          f"{'actdB':>7} {'clip':>5} {'vsCenter dB':>11} {'vsRaw dB':>9}")
    rows = []
    for sid, s, e in SEG:
        want = e - s
        # 人声：分离输出（带 3s 上下文，裁掉）
        cand = sorted(glob.glob(os.path.join(voc_dir, f"t{sid}*(Vocals)*.wav")))
        if not cand:
            print(f"t{sid}: MISSING vocal output"); continue
        x, sr = load(cand[0])
        a = int(sr * PAD); b = min(len(x), int(sr * (PAD + want)))
        v = x[a:b]
        peak = float(np.max(np.abs(v))) if len(v) else 0.0
        rdb = rms_db(v)
        sp, act = speech_ratio(v, sr)
        cr = clip_run(v)
        # 对照：中置下混版 / 原始立体声下混，看分离掉了多少能量
        cen, src = load(os.path.join(cen_dir, f"t{sid}.wav"))
        raw, srr = load(os.path.join(raw_dir, f"t{sid}.wav"))
        # 三段采样率不同（v 44.1k，对照 48k），按时间比例换算取样点数
        n_cen = int(len(v) * src / sr)
        n_raw = int(len(v) * srr / sr)
        d_cen = rdb - rms_db(cen[:n_cen])
        d_raw = rdb - rms_db(raw[:n_raw])
        rows.append((sid, len(v) / sr, want, peak, rdb, sp, act, cr, d_cen, d_raw))
        print(f"t{sid:>2} {len(v)/sr:6.2f} {want:6d} {peak:6.3f} {rdb:7.1f} "
              f"{sp*100:6.1f} {act:7.1f} {cr:5d} {d_cen:11.1f} {d_raw:9.1f}")
    if rows:
        tot = sum(r[1] for r in rows)
        print(f"\n人声总时长 {tot:.1f}s / 期望 {sum(r[2] for r in rows)}s")
        print("判据：sp% <55% 表示这段大部分时间没人说话；vsRaw 在 -12~-25dB 正常（BGM 被拿掉），")
        print("      若 vsRaw 接近 0dB 说明分离几乎没改动（可能本来就没 BGM），若 < -30dB 说明人声也被削狠了。")

if __name__ == "__main__":
    main()
