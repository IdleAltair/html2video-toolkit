# 第 13 页「半张棋盘看不见火」的实证：本机在十人档里有没有因为火焰数组截断而死。
# 只统计本机自己那一槽的坐标与火焰格，不读别人的策略。默认滑最新一批受控并发重跑（w2）。
# 用法: python3 pipeline/bomb-blind-zone.py [--runs main=DIR ot=DIR] [--out data/bomb-blind-zone.json]
import json, glob, os, collections, io, sys
ME = "\u4f60\u7684 bot"
ROOT = "$HOME/deepseek-harness/workplace/meow-ai-arena/bomberman/challenge-runs"
RUNS = {"main": "rerun-main-w2-*", "ot": "rerun-ot-w2-*"}
OUT = "data/bomb-blind-zone.json"
W = 25; THRESH = 313          # memcpy(R.flame, FL, 625) 只拷 625 字节 = 前 312 格，第 313 格起看不见

a = sys.argv[1:]
if "--out" in a: OUT = a[a.index("--out") + 1]
if "--runs" in a:
    i = a.index("--runs") + 1; spec = []
    while i < len(a) and "=" in a[i]: spec.append(a[i]); i += 1
    RUNS = dict(x.split("=", 1) for x in spec)

out = {}
for tag, pat in RUNS.items():
    cands = sorted(glob.glob(os.path.join(ROOT, pat)))
    if not cands:
        print("缺批次", tag, pat); continue
    run = os.path.basename(cands[-1])
    fs = sorted(glob.glob(os.path.join(cands[-1], "replays", "*.json")))
    blast = collections.Counter(); occupancy = [0, 0]; deaths = 0; games = 0
    peers = collections.Counter()
    for f in fs:
        try: d = json.load(io.open(f, encoding="utf-8"))
        except Exception: continue
        r = d.get("result") or {}; cfg = r.get("config") or {}
        if cfg.get("size") != W: continue
        nm = r.get("names") or []
        if ME not in nm: continue
        me = nm.index(ME); games += 1
        fr = d.get("frames") or []
        dead = set()
        for k, fm in enumerate(fr):
            pl = fm.get("players") or []
            if len(pl) <= me: continue
            fl = list(fm.get("flames") or [])
            for i, p in enumerate(pl):
                if p.get("x") is None: continue
                blind = (p["y"] * W + p["x"]) >= THRESH
                if i == me and p.get("alive") is not False:
                    occupancy[1 if blind else 0] += 1
                if p.get("alive") is False and i not in dead:
                    dead.add(i)
                    if p.get("reason") != "blast": continue
                    fl2 = list((fr[k - 1] if k else fm).get("flames") or []) + fl
                    on = any(len(c) >= 2 and c[0] == p["x"] and c[1] == p["y"] for c in fl2)
                    if not on: continue
                    (blast if i == me else peers)["blind" if blind else "seen"] += 1
    tot = sum(blast.values()); ptot = sum(peers.values())
    occ_tot = occupancy[0] + occupancy[1]
    out[tag] = {
        "run": run, "games10p": games, "blastDeathsMine": tot,
        "blind": blast["blind"], "seen": blast["seen"],
        "blindShare": round(blast["blind"] / tot * 100, 1) if tot else None,
        "occupancyBlindShare": round(occupancy[1] / occ_tot * 100, 1) if occ_tot else None,
        "peersBlastDeaths": ptot, "peersBlindShare": round(peers["blind"] / ptot * 100, 1) if ptot else None,
        "boardCells": W * W, "blindCells": W * W - THRESH + 1,
    }
if "--dry" not in a:
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
for k, v in out.items():
    print(k, json.dumps(v, ensure_ascii=False))
