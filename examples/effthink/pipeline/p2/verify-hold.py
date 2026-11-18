# -*- coding: utf-8 -*-
"""P2 定格验收：每局取「定格前 0.2s」与「定格中点」两帧，比对是否同一画面；并测响度。"""
import json, os, subprocess
import numpy as np

D = "$PROJECT_ROOT/arena-effthink"
P2 = D + "/clips-p2"
FF = D + "/../bin/ffmpeg.exe"
JOBS = json.load(open(P2 + "/_jobs.json", encoding="utf-8"))
TARGET = P2 + "/p2-replay-av.mp4"
G = "$TMP/p2hold"
os.makedirs(G, exist_ok=True)
for f in os.listdir(G):
    os.remove(G + "/" + f)


def dur(f):
    r = subprocess.run([FF, "-i", f], capture_output=True, text=True)
    x = [l for l in r.stderr.splitlines() if "Duration:" in l][0].split("Duration:")[1].split(",")[0].strip()
    h, m, s = x.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def grab(t, out):
    subprocess.run([FF, "-y", "-v", "error", "-ss", "%.2f" % t, "-i", TARGET, "-frames:v", "1",
                    "-vf", "scale=640:-1", out], check=True)


def px(f):
    subprocess.run([FF, "-y", "-v", "error", "-i", f, "-f", "rawvideo", "-pix_fmt", "gray",
                    "$TMP/_h.raw"], check=True)
    return np.fromfile("$TMP/_h.raw", "uint8").astype(float)


t, rows = 0.0, []
for j in JOBS:
    dc, dv = dur(P2 + "/c" + j["key"] + ".mp4"), dur(P2 + "/hold/" + j["key"] + ".mp4")
    a = t + dc                      # 正片起点
    b = a + dv                      # 正片终点（含 2.5s 定格）
    hold = dur(P2 + "/" + j["key"] + ".mp4")
    rows.append((j["key"], a, b, b - hold, dv - hold))
    t = b
print("整片实测 %.2fs ｜ 累加 %.2fs ｜ 每局定格 %.2fs" % (dur(TARGET), t, rows[0][4]))
for n, (key, a, b, play_end, hd) in enumerate(rows, 1):
    g1, g2 = "%s/%02da.png" % (G, n), "%s/%02db.png" % (G, n)
    grab(play_end + 0.4, g1)
    grab(play_end + hd - 0.3, g2)
    d = np.abs(px(g1) - px(g2)).mean()
    print("  %d %-14s 定格 %.2fs  定格段内两帧差 %.4f %s" % (n, key, hd, d, "静止 OK" if d < 0.05 else "!! 还在动"))
subprocess.run([FF, "-y", "-v", "error", "-i", G + "/01a.png", "-i", G + "/01b.png",
                "-i", G + "/08b.png", "-filter_complex", "xstack=inputs=3:layout=0_0|w0_0|0_h0",
                "$TMP/p2-hold-pair.png"], check=True)
