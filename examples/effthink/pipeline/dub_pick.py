# -*- coding: utf-8 -*-
"""按 dubbing/rework.json 逐句多抽 seed 并客观择优：每句留字/秒最接近 5.95、且停顿不超标的那条。

用法：
  python3 pipeline/dub_pick.py                 跑全清单（已定稿的句跳过，可分批续跑）
  python3 pipeline/dub_pick.py --only 39,79    只重跑指定句
  python3 pipeline/dub_pick.py --report        只出账目

产物：
  dubbing/tts_rework/NN.wav                 选中件（替换正式逐句件前的定稿候选）
  dubbing/tts_rework/cand/NN_s<seed>.wav    全部候选，选中那条不满意时从这里取次优
  dubbing/tts_rework/manifest.json          每句所有候选的指标与选中标记
择优口径来自 2026-10-11 听感标注的交叉统计：字/秒>=5.8 且 最长空拍<=0.45 的成品可用率 89%。
质感（25/57 那类）指标抓不到，仍需人耳终检。
"""
import argparse, concurrent.futures, io, json, os, shutil, threading, wave
import numpy as np, requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUB = os.path.join(ROOT, "dubbing")
REWORK = os.path.join(DUB, "rework.json")
OUT = os.path.join(DUB, "tts_rework")
CAND = os.path.join(OUT, "cand")
REF = os.path.join(os.path.dirname(ROOT), "laoda-zh-dub/voice-ref/ref_t06_from0.6s.wav")
REFT = os.path.join(os.path.dirname(ROOT), "laoda-zh-dub/voice-ref/ref_text.txt")
SR = 24000
API = ["http://127.0.0.1:7861", "http://127.0.0.1:7862"]      # 多一个同参数实例纯粹为了并行吞吐
SEEDS = [71, 83, 97, 101, 113, 127, 11, 23, 42, 58]   # 前 6 个是本轮没用过的 seed，专给「质感重抽」用                     # 不含 7：本轮 seed7 的产物已被大面积否掉
INS = {
    "D": "语速慢一点，再慢一点，从容不迫，吐字清晰，不赶时间。",
    "G": "干脆利落地念，吐字清晰，句子紧凑，停顿短，不拖长音。",
}
CFG = float(os.environ.get("BREEZE_CFG", "2"))   # 4 会被指令拖成系统性偏慢，实测 2 把长停顿全面收紧
TARGET = float(os.environ.get("DUB_TARGET", "5.95"))   # 首轮合格组（他未标注的 37 句）字/秒中位 5.88      # 合格组的字/秒中位数
PAUSE = 0.45       # 单句最长空拍上限，再大就明显碎
PUNCT = "，。、；：？！…—－（）()《》“”‘’·,.;:!?%×- \t"


def nz(s):
    return len([c for c in s if c not in PUNCT])


def prof(x):
    n = int(SR * 0.02)
    r = np.array([np.sqrt(np.mean(x[i:i + n] ** 2)) for i in range(0, max(1, len(x) - n), n)])
    q = r < 0.02
    run = cur = 0
    for v in q:
        if v:
            cur += 0.02
        elif cur:
            run = max(run, cur); cur = 0
    return len(x) / SR, max(run, cur), float(np.abs(x).max())


def score(cps, longest, peak):
    if peak < 0.25:
        return 1e9
    return abs(cps - TARGET) + 4.0 * max(0.0, longest - PAUSE)


def alive():
    ok = []
    for b in API:
        try:
            s = requests.Session(); s.trust_env = False
            if s.get(b + "/health", timeout=4).json().get("status") == "ok":
                ok.append(b)
        except Exception:
            pass
    return ok


def synth(text, ins, seed, base):
    s = requests.Session(); s.trust_env = False
    with open(REF, "rb") as f:
        r = s.post(base + "/v1/audio/speech", files={"ref_audio": ("ref.wav", f, "audio/wav")},
                   data={"ref_text": io.open(REFT, encoding="utf-8").read().strip(),
                         "text": text, "instruction": INS[ins], "cfg_scale": CFG, "seed": str(seed)},
                   timeout=900)
    r.raise_for_status()
    x = np.frombuffer(r.content, dtype="<i2").astype(np.float32) / 32768.0
    if not len(x):
        raise RuntimeError("空响应")
    return x


def save(p, x):
    with wave.open(p, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


def job(a):
    i, text, ins, seed, base = a
    x = synth(text, ins, seed, base)
    d, L, peak = prof(x)
    name = "%02d_s%d.wav" % (i, seed)
    save(os.path.join(CAND, name), x)
    c = {"i": i, "ins": ins, "seed": seed, "wav": name, "dur": round(d, 3),
         "z": nz(text), "cps": round(nz(text) / d, 2), "pause": round(L, 3), "peak": round(peak, 3)}
    c["score"] = round(score(c["cps"], c["pause"], c["peak"]), 3)
    return c


def lane(base, tasks, sink, lock):
    """一个端点一条道，内部串行：API 有单请求锁（_request_lock），并发打同一实例会直接 409。"""
    for t in tasks:
        for attempt in range(3):
            try:
                c = job((t[0], t[1], t[2], t[3], base))
            except Exception as e:
                print("   !! 句%d seed%d 在 %s 失败(%s)，重试 %d" % (t[0], t[3], base, e, attempt + 1), flush=True)
                continue
            with lock:
                sink.append(c)
                print("   [%3d] 句%-4d seed%-4d %5.2fs %5.2f字/秒 空拍%.2fs 峰%.2f 分%.2f" % (
                    len(sink), c["i"], c["seed"], c["dur"], c["cps"], c["pause"], c["peak"], c["score"]), flush=True)
            break


def reselect(cands, plan):
    """按当前 score 公式从既有候选里重选并刷新选中件（改口径时不用重跑 GPU）。"""
    n = 0
    for p in plan:
        lst = [c for c in cands if c["i"] == p["i"]]
        if not lst:
            continue
        best = min(lst, key=lambda c: score(c["cps"], c["pause"], c["peak"]))
        shutil.copyfile(os.path.join(CAND, best["wav"]), os.path.join(OUT, "%02d.wav" % p["i"]))
        print("[reselect] 句%-4d -> seed%-4d  cps %.2f 空拍 %.2f（最快候选 %.2f）" % (
            p["i"], best["seed"], best["cps"], best["pause"], max(c["cps"] for c in lst)))
        n += 1
    print("[reselect] 刷新 %d 句" % n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--reselect", action="store_true", help="只按新公式从既有候选里重选，不合成")
    a = ap.parse_args()
    os.makedirs(CAND, exist_ok=True)
    plan = json.load(io.open(REWORK, encoding="utf-8"))
    mf = os.path.join(OUT, "manifest.json")
    cands = json.load(io.open(mf, encoding="utf-8")) if os.path.exists(mf) else []

    if a.report:
        rows = []
        for i in sorted({c["i"] for c in cands}):
            lst = [c for c in cands if c["i"] == i]
            best = min(lst, key=lambda c: c["score"])
            rows.append((i, best, len(lst), best["score"] >= 1e9))
        print("[report] 已择优 %d 句；选中件字/秒中位 %.2f，最长空拍中位 %.2f" % (
            len(rows), np.median([r[1]["cps"] for r in rows]), np.median([r[1]["pause"] for r in rows])))
        for i, b, n, dead in rows:
            print("  句%-4d seed%-4d %-2s  cps %.2f 空拍 %.2f  %d 候选%s" % (
                i, b["seed"], b["ins"], b["cps"], b["pause"], n, "  ← 全部不合格" if dead else ""))
        return

    if a.reselect:
        return reselect(cands, plan)
    eps = alive()
    if not eps:
        raise SystemExit("!! 7861/7862 都不在线，先起服务")
    only = set(int(x) for x in a.only.split(",") if x.strip())
    done = {p["i"] for p in plan if os.path.exists(os.path.join(OUT, "%02d.wav" % p["i"]))}
    jobs = []
    for p in plan:
        if (only and p["i"] not in only) or p["i"] in done:
            continue
        for seed in SEEDS[:p["seeds"]]:
            jobs.append((p["i"], p["text"], p.get("ins", "D"), seed, eps[len(jobs) % len(eps)]))
    print("[pick] 端点 %s；本轮 %d 次合成 / %d 路，预计 %.0f 分钟" % (
        ",".join(eps), len(jobs), len(eps), len(jobs) * 18 / 60 / len(eps)), flush=True)

    lock = threading.Lock()
    n0 = len(cands)
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(eps)) as ex:
        lanes = [ex.submit(lane, base, jobs[k::len(eps)], cands, lock) for k, base in enumerate(eps)]
        for f in concurrent.futures.as_completed(lanes):
            f.result()
    print("[pick] 本轮新增 %d 个候选" % (len(cands) - n0))
    json.dump(cands, io.open(mf, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    for p in plan:
        i = p["i"]
        if only and i not in only:
            continue
        lst = [c for c in cands if c["i"] == i]
        if not lst:
            continue
        best = min(lst, key=lambda c: c["score"])
        shutil.copyfile(os.path.join(CAND, best["wav"]), os.path.join(OUT, "%02d.wav" % i))
        if best["score"] >= 1e9:
            print("[pick] !! 句 %d 的 %d 个候选全部不合格，先留 %s，等人工" % (i, len(lst), best["wav"]))
    miss = [p["i"] for p in plan if not os.path.exists(os.path.join(OUT, "%02d.wav" % p["i"]))]
    print("[pick] 清单 %d 句，已定稿 %d 句，缺 %s" % (len(plan), len(plan) - len(miss), miss or "无"))


if __name__ == "__main__":
    main()
