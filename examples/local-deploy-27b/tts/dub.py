# -*- coding: utf-8 -*-
"""逐句配音：tts.json → clips/NN.wav（Breeze 常驻 API，clone 模式，可续跑）。

用法：
  python3 dub.py              全部未完成句子
  python3 dub.py --only 3,7   只重跑指定句
  python3 dub.py --report     不合成，只出体检表
"""
import argparse, io, json, os, sys, time
import requests
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.dirname(ROOT)              # local-deploy-27b
CLIPS = os.path.join(ROOT, "tts", "clips")
REF = os.path.join(PROJ, "laoda-zh-dub/voice-ref/ref_t06_from0.6s.wav")
REFT = os.path.join(PROJ, "laoda-zh-dub/voice-ref/ref_text.txt")
URL = "http://127.0.0.1:7861/v1/audio/speech"
SR = 24000
INS = "语速慢一点，再慢一点，从容不迫，吐字清晰，不赶时间。"
SESS = requests.Session(); SESS.trust_env = False


def nz(s):
    import re
    return len(re.sub(r"[^\w一-鿿]", "", s))


def synth(text, seed):
    with open(REF, "rb") as f:
        r = SESS.post(URL, files={"ref_audio": ("ref.wav", f, "audio/wav")},
                      data={"ref_text": io.open(REFT, encoding="utf-8").read().strip(),
                            "text": text, "instruction": INS,
                            "cfg_scale": "4", "seed": str(seed)}, timeout=900)
    r.raise_for_status()
    return np.frombuffer(r.content, dtype="<i2").astype(np.float32) / 32768.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--retries", type=int, default=3)
    a = ap.parse_args()

    os.makedirs(CLIPS, exist_ok=True)
    rows = json.load(io.open(os.path.join(ROOT, "tts", "tts.json"), encoding="utf-8"))
    only = {int(x) for x in a.only.split(",") if x.strip()} if a.only else None

    if a.report:
        total = 0.0
        for r in rows:
            p = os.path.join(CLIPS, "%03d.wav" % r["i"])
            if not os.path.exists(p):
                print("%03d p%02d 缺" % (r["i"], r["page"])); continue
            x, sr = sf.read(p); d = len(x) / sr; total += d
            print("%03d p%02d %6.2fs %5.2f 字/秒" % (r["i"], r["page"], d, nz(r["text"]) / d))
        print("已合成合计 %.1fs" % total)
        return

    todo = [r for r in rows if only and r["i"] in only] if only else rows
    done = 0
    for r in todo:
        p = os.path.join(CLIPS, "%03d.wav" % r["i"])
        if not only and os.path.exists(p):
            continue
        for k in range(a.retries):
            t0 = time.time()
            try:
                a_pcm = synth(r["text"], a.seed)
            except Exception as e:
                print("  !! %03d 第 %d 次失败：%s" % (r["i"], k + 1, str(e)[:120]))
                time.sleep(2); continue
            sf.write(p, a_pcm, SR, subtype="PCM_16")
            d = len(a_pcm) / SR
            print("[%3d/%3d] %03d p%02d %5.2fs %5.2f 字/秒 峰值 %.2f 墙钟 %.0fs"
                  % (done + 1, len(todo), r["i"], r["page"], d, nz(r["text"]) / d,
                     float(np.abs(a_pcm).max()), time.time() - t0))
            done += 1
            break
        else:
            print("  !! %03d 放弃" % r["i"])
    print("完成，新增", done)


if __name__ == "__main__":
    main()
