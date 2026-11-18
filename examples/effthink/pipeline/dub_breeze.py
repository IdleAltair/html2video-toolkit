# -*- coding: utf-8 -*-
"""逐句中文配音：读 dubbing/tts.json，走常驻 BreezeTTS API，出 dubbing/tts_clips/NN.wav。

用法：
  python3 pipeline/dub_breeze.py                          全片；已存在的句子跳过，可分批续跑
  python3 pipeline/dub_breeze.py --only 53,61 --seed 42   只重跑指定句并覆盖（换 seed 抽卡）
  python3 pipeline/dub_breeze.py --report                 不合成，只按现有 wav 出体检表

跑完接：python3 pipeline/dub.py --timeline dubbing/tts_clips   出 data/cues.json 与 dubbing/字幕.srt
措辞与 seed 是实测挑定的：D 措辞 + seed7 在盲测里排第一；纯 Clone 排最后，别去掉 instruction。
"""
import argparse, io, json, os, sys, time
import requests
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.dirname(ROOT)
DUB = os.path.join(ROOT, "dubbing")
CLIPS = os.path.join(DUB, "tts_clips")
REF = os.path.join(PROJ, "laoda-zh-dub/voice-ref/ref_t06_from0.6s.wav")
REFT = os.path.join(PROJ, "laoda-zh-dub/voice-ref/ref_text.txt")
URL = "http://127.0.0.1:7861/v1/audio/speech"
SR = 24000
INS = "语速慢一点，再慢一点，从容不迫，吐字清晰，不赶时间。"
SESS = requests.Session()
SESS.trust_env = False          # 本机代理会把 127.0.0.1 一起劫持掉


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
    ap.add_argument("--only", default="", help="逗号分隔的句序号，只重跑这些并覆盖")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--retries", type=int, default=3)
    a = ap.parse_args()

    os.makedirs(CLIPS, exist_ok=True)
    rows = json.load(io.open(os.path.join(DUB, "tts.json"), encoding="utf-8"))
    only = {int(x) for x in a.only.split(",") if x.strip()} if a.only else None

    if not a.report:
        todo = [r for r in rows if only and r["i"] in only] if only else rows
        done = 0
        for r in todo:
            p = os.path.join(CLIPS, "%02d.wav" % r["i"])
            if not only and os.path.exists(p):
                continue
            for k in range(a.retries):
                t0 = time.time()
                try:
                    a_pcm = synth(r["tts"], r.get("seed", a.seed) if only else a.seed)
                except Exception as e:
                    print("  !! %02d 第 %d 次失败：%s" % (r["i"], k + 1, str(e)[:120]))
                    time.sleep(2)
                    continue
                sf.write(p, a_pcm, SR, subtype="PCM_16")
                r["seed"] = a.seed
                d = len(a_pcm) / SR
                print("[%3d/%3d] %02d 页%2d %5.2fs %5.2f 字/秒 峰值 %.2f 墙钟 %.0fs"
                      % (done + 1, len(todo), r["i"], r["page"], d, nz(r["tts"]) / d,
                         float(np.abs(a_pcm).max()), time.time() - t0))
                done += 1
                break
            else:
                print("  xx %02d 三次都没过，跳过：%s" % (r["i"], r["tts"][:40]))

    man = []
    for r in rows:
        p = os.path.join(CLIPS, "%02d.wav" % r["i"])
        if not os.path.exists(p):
            continue
        a_pcm, _ = sf.read(p, dtype="float32")
        d = len(a_pcm) / SR
        man.append({"i": r["i"], "page": r["page"], "wav": "%02d.wav" % r["i"],
                    "z": nz(r["tts"]), "dur": round(d, 3), "cps": round(nz(r["tts"]) / d, 2),
                    "peak": round(float(np.abs(a_pcm).max()), 3), "srt": r["srt"]})
    json.dump(man, io.open(os.path.join(CLIPS, "manifest.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    tot = sum(m["dur"] for m in man)
    print("\n[体检] 已出 %d / %d 句，语音合计 %.1f 分钟" % (len(man), len(rows), tot / 60))
    slow = sorted(man, key=lambda m: m["cps"])[:6]
    fast = sorted(man, key=lambda m: -m["cps"])[:4]
    print("  最慢 6 句（可能是长句被拖，或数字多导致口径失真）：")
    for m in slow:
        print("    %02d 页%2d %5.2f 字/秒 %3d 字 %5.2fs  %s" % (m["i"], m["page"], m["cps"], m["z"], m["dur"], m["srt"][:34]))
    print("  最快 4 句（>9 字/秒多半是吞了内容）：")
    for m in fast:
        print("    %02d 页%2d %5.2f 字/秒 %3d 字 %5.2fs  %s" % (m["i"], m["page"], m["cps"], m["z"], m["dur"], m["srt"][:34]))
    quiet = [m for m in man if m["peak"] < 0.25]
    if quiet:
        print("  峰值过低（<0.25，可能几乎没出声）：%s" % ", ".join(str(m["i"]) for m in quiet))


if __name__ == "__main__":
    main()
