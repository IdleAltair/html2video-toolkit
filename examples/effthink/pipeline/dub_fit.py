# -*- coding: utf-8 -*-
"""语速对齐：把择优件按 ±15% 的 atempo 拉向目标语速（用户许可「正负15%内的速度变换对质量影响不大」）。

用法：
  python3 pipeline/dub_fit.py            对 dubbing/tts_rework 的全部选中件做对齐 -> dubbing/tts_fit/
  python3 pipeline/dub_fit.py --only 35  只做指定句
  python3 pipeline/dub_fit.py --report   只看倍率计划，不写文件
  python3 pipeline/dub_fit.py --src tts_rework_cfg4,tts_clips --only 2,3 --plan fit_plan_rest.json
                                         改源目录（按顺序探测，先命中先取）、单独记账

倍率 = 目标字/秒 ÷ 该句字/秒，钳在 [1/1.15, 1.15]；超出钳制范围的句会单独列出来（那些只能重抽）。
atempo 是匀速变时，不改音高，也不改变停顿的相对位置，只把整条（含停顿）一起缩放。
"""
import argparse, io, json, os, subprocess, sys, wave
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUB = os.path.join(ROOT, "dubbing")
SRC = os.path.join(DUB, "tts_rework")
OUT = os.path.join(DUB, "tts_fit")
SR = 24000
TARGET = 5.95
LIMIT = 1.15
FFMPEG = os.environ.get("FFMPEG") or next(
    (p for p in [os.path.join(os.path.dirname(ROOT), "bin", "ffmpeg.exe"), "ffmpeg"] if os.path.exists(p) or p == "ffmpeg"), "ffmpeg")
PUNCT = "，。、；：？！…—－（）()《》“”‘’·,.;:!?%×- \t"


def win(p):
    """WSL 路径 -> Windows 路径（WSL 里没有 ffmpeg，只能喊 Windows 那个 exe）。"""
    if os.name == "nt" or not p.startswith("/mnt/"):
        return p.replace("/", "\\")
    return p[5].upper() + ":" + p[6:].replace("/", "\\")


def rd(p):
    with wave.open(p, "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0


def prof(x):
    n = int(SR * .02)
    r = np.array([np.sqrt(np.mean(x[i:i + n] ** 2)) for i in range(0, max(1, len(x) - n), n)])
    q = r < 0.02
    run = cur = 0
    for v in q:
        if v:
            cur += .02
        elif cur:
            run = max(run, cur); cur = 0
    return len(x) / SR, max(run, cur)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--src", default="tts_rework", help="源目录，逗号分隔按序探测")
    ap.add_argument("--out", default="tts_fit")
    ap.add_argument("--plan", default="fit_plan.json")
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()
    srcs = [os.path.join(DUB, d) for d in a.src.split(",")]
    out = os.path.join(DUB, a.out)
    tts = {r["i"]: r for r in json.load(io.open(os.path.join(DUB, "tts.json"), encoding="utf-8"))}

    def find(i):
        for d in srcs:
            p = os.path.join(d, "%02d.wav" % i)
            if os.path.exists(p):
                return p
        return None

    only = set(int(x) for x in a.only.split(",") if x.strip())
    ids = sorted(i for i in tts if find(i) and (not only or i in only))
    plan = []
    for i in ids:
        x = rd(find(i))
        d, L = prof(x)
        z = len([c for c in tts[i]["tts"] if c not in PUNCT])
        cps = z / d
        f = TARGET / cps
        clamped = min(max(f, 1 / LIMIT), LIMIT)
        plan.append({"i": i, "cps": round(cps, 2), "pause": round(L, 3), "want": round(f, 3),
                     "use": round(clamped, 3), "over": abs(f - clamped) > 0.005,
                     "after_cps": round(cps * clamped, 2), "after_pause": round(L / clamped, 3)})
    need = [p for p in plan if abs(p["use"] - 1) > 0.01]
    over = [p for p in plan if p["over"]]
    if not plan:
        raise SystemExit("[fit] %s 里没有可处理的件" % a.src)
    if only - set(ids):
        print("[fit] !! 指定但找不到原件的句：%s" % sorted(only - set(ids)))
    print("[fit] %d 句（源 %s），需变速 %d 句%s；钳在 ±15%% 仍够不到目标的 %d 句" % (
        len(plan), a.src, len(need),
        ("，倍率 %.2f–%.2f" % (min(p["use"] for p in need), max(p["use"] for p in need))) if need else "", len(over)))
    for p in over:
        print("   够不到：句%-4d cps %.2f 需要 x%.2f（超 ±15%%）" % (p["i"], p["cps"], p["want"]))
    json.dump(plan, io.open(os.path.join(DUB, a.plan), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if a.report:
        for p in plan:
            print("  句%-4d cps %.2f -> x%.3f -> %.2f 字/秒  空拍 %.2f -> %.2f" % (
                p["i"], p["cps"], p["use"], p["after_cps"], p["pause"], p["after_pause"]))
        return

    os.makedirs(out, exist_ok=True)
    for p in plan:
        src = find(p["i"])
        dst = os.path.join(out, "%02d.wav" % p["i"])
        s = rd(src)
        if abs(p["use"] - 1) <= 0.01:
            with wave.open(dst, "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
                w.writeframes((np.clip(s, -1, 1) * 32767).astype("<i2").tobytes())
            continue
        r = subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", win(src),
                            "-filter:a", "atempo=%.4f" % p["use"], win(dst)], capture_output=True, text=True)
        if r.returncode != 0:
            print("!! ffmpeg 失败 句%d：%s" % (p["i"], r.stderr.strip()[:200])); continue
        d, L = prof(rd(dst))
        z = len([c for c in tts[p["i"]]["tts"] if c not in PUNCT])
        got = z / d
        if abs(got - p["after_cps"]) > 0.25:
            print("!! 句%d 实测 %.2f 字/秒 与预测 %.2f 差太多" % (p["i"], got, p["after_cps"]))
    left = [p["i"] for p in plan if not os.path.exists(os.path.join(out, "%02d.wav" % p["i"]))]
    print("[fit] 输出 %d 句到 dubbing/%s，缺 %s" % (len(plan) - len(left), a.out, left or "无"))


if __name__ == "__main__":
    main()
