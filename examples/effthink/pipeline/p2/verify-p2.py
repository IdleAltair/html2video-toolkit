# -*- coding: utf-8 -*-
"""P2 整片验收：按卡片与正片的实测时长累加出时间轴，每段取中点抽一帧拼 4x4。"""
import json, os, subprocess, wave
import numpy as np

D = "$PROJECT_ROOT/arena-effthink"
FF = D + "/../bin/ffmpeg.exe"
P2 = D + "/clips-p2"
JOBS = json.load(open(P2 + "/_jobs.json", encoding="utf-8"))
TARGET = P2 + "/p2-replay-av.mp4"


def dur(f):
    r = subprocess.run([FF, "-i", f], capture_output=True, text=True)
    m = [x for x in r.stderr.splitlines() if "Duration:" in x]
    h, mi, s = m[0].split("Duration:")[1].split(",")[0].strip().split(":")
    return int(h) * 3600 + int(mi) * 60 + float(s)


tl, t = [], 0.0
for j in JOBS:
    c, v = P2 + "/c" + j["key"] + ".mp4", P2 + "/" + j["key"] + ".mp4"
    dc, dv = dur(c), dur(v)
    tl.append(("卡", j["key"], t, t + dc))
    tl.append(("片", j["key"], t + dc, t + dc + dv))
    t += dc + dv
print("整片实测 %.2fs｜累加 %.2fs" % (dur(TARGET), t))
os.makedirs("$TMP/p2grid", exist_ok=True)
for f in os.listdir("$TMP/p2grid"):
    os.remove("$TMP/p2grid/" + f)
for n, (kind, key, a, b) in enumerate(tl, 1):
    mid = (a + b) / 2
    subprocess.run([FF, "-y", "-v", "error", "-ss", "%.2f" % mid, "-i", TARGET,
                    "-frames:v", "1", "-vf", "scale=480:-1",
                    "$TMP/p2grid/%02d.png" % n], check=True)
    print("%2d %-2s %-14s %6.1f–%6.1fs 取 %.1fs" % (n, kind, key, a, b, mid))
subprocess.run([FF, "-y", "-v", "error", "-framerate", "1", "-i", "$TMP/p2grid/%02d.png",
                "-vf", "tile=4x4:padding=4:color=red", "$TMP/p2-grid.png"], check=True)
subprocess.run([FF, "-v", "error", "-y", "-i", TARGET, "-map", "0:a",
                "-ac", "1", "-c:a", "pcm_s16le", "-ar", "48000", "$TMP/_p2a.wav"], check=True)
h = wave.open("$TMP/_p2a.wav", "rb")
y = np.frombuffer(h.readframes(h.getnframes()), "<i2").astype(np.float64) / 32768.0
h.close()
print("音轨 %.1fs  RMS %.1f dB  peak %.1f dB  前 3s（首张卡）RMS %.1f dB" % (
    len(y) / 48000, 20 * np.log10(np.sqrt((y ** 2).mean()) + 1e-12),
    20 * np.log10(np.abs(y).max() + 1e-12),
    20 * np.log10(np.sqrt((y[:3 * 48000] ** 2).mean()) + 1e-12)))
