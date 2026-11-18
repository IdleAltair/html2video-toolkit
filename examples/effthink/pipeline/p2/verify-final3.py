# -*- coding: utf-8 -*-
"""重烧后的成片复验：流与时长 + 第 21 页三卡配色 + 第 3 页 g-land 画面 + 字幕带与三段电平。"""
import json, os, subprocess, wave
import numpy as np

D = "$PROJECT_ROOT/arena-effthink"
M = D + "/out/deck-final.mp4"
FF = "$HOME/mamba/envs/ninfer/bin/ffmpeg"
S = "$TMP/sync3"
os.makedirs(S, exist_ok=True)
for f in os.listdir(S):
    os.remove(os.path.join(S, f))

print("== 流与时长")
print(subprocess.run(["$HOME/mamba/envs/ninfer/bin/ffprobe", "-v", "error",
                      "-show_entries", "format=duration,size", "-show_entries",
                      "stream=codec_name,width,height,avg_frame_rate,channels,sample_rate",
                      "-of", "default=nw=1", M], capture_output=True, text=True).stdout.strip())

# 整页帧：第 21 页三张事实卡（句 77/78/79 各对应一圈地/炸弹人/夺旗），第 3 页画廊主位
SHOTS = [("p21", 442.81), ("p21", 445.79), ("p21", 448.51),
         ("g3", 52.0), ("g3", 66.0), ("g3", 80.0), ("g3", 92.0)]
for n, (tag, t) in enumerate(SHOTS, 1):
    subprocess.run([FF, "-y", "-v", "error", "-ss", "%.2f" % t, "-i", M, "-frames:v", "1",
                    "-vf", "scale=1280:-1", "%s/%s%02d.png" % (S, tag, n)], check=True)
    print("帧 %-8s t=%6.2fs -> %s%02d.png" % (tag, t, tag, n))

subprocess.run([FF, "-y", "-v", "error", "-i", "%s/p21%%02d.png" % S,
                "-vf", "crop=iw:ih*0.52:0:ih*0.44,tile=1x3:padding=8:color=red",
                "$TMP/p21-cards3.png"], check=True)
print("三卡条 -> $TMP/p21-cards3.png")

# 字幕同步带 + 电平（沿用上一版判据）
cues = json.load(open(D + "/data/cues.json", encoding="utf-8"))["sentences"]
IDX = (0, 26, 74, 95, 96, 105)
B = "$TMP/syncb3"
os.makedirs(B, exist_ok=True)
for f in os.listdir(B):
    os.remove(os.path.join(B, f))
for n, k in enumerate(IDX, 1):
    r = cues[k]
    t = r["start"] + r["dur"] / 2
    subprocess.run([FF, "-y", "-v", "error", "-ss", "%.2f" % t, "-i", M, "-frames:v", "1",
                    "-vf", "crop=iw:ih*0.40:0:ih*0.60,scale=1000:-1", "%s/%02d.png" % (B, n)],
                   check=True)
    print("句%-4d 页%-3d t=%6.2fs  %s" % (k + 1, r["page"], t, r["text"][:44]))
subprocess.run([FF, "-y", "-v", "error", "-i", "%s/%%02d.png" % B,
                "-vf", "tile=1x6:padding=8:color=red", "$TMP/sync-strip3.png"], check=True)
print("字幕条 -> $TMP/sync-strip3.png")

for a, b, why in ((0, 9, "第一句"), (300, 309, "中段一句"), (612, 624.4, "落幕配乐淡出")):
    raw = "$TMP/_seg3.wav"
    subprocess.run([FF, "-v", "error", "-y", "-ss", "%.3f" % a, "-i", M, "-t", "%.3f" % (b - a),
                    "-map", "0:a", "-c:a", "pcm_s16le", "-ar", "48000", raw], check=True)
    with wave.open(raw, "rb") as w:
        y = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float64) / 32768.0
    print("%-14s RMS %6.1f dB  peak %6.1f dB  样本 %d" %
          (why, 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-12),
           20 * np.log10(np.max(np.abs(y)) + 1e-12), len(y)))
