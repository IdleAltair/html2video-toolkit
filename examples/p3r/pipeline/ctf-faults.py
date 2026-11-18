#!/usr/bin/env python3
"""夺旗段错误取证（受控并发重跑版）：逐局 结果.jsonl 数「谁的、在哪个人数档、多少局、报什么」。
用法：python3 pipeline/ctf-faults.py   → data/ctf-faults.json
"""
import json, os, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ARENA = "$HOME/deepseek-harness/workplace/meow-ai-arena/ctf/challenge-runs"
ME = "你的 bot"
out = {"_src": "受控并发重跑（w2）各 run 的 结果.jsonl 逐局 faults 统计；总数应与 成绩.md 的「故障局」列一致，这里多出分档与报错原文。"}

for tag in ("main", "ot"):
    d = sorted(glob.glob(os.path.join(ARENA, "rerun-%s-w2-*" % tag)))
    if not d:
        print("夺旗 %s：无重跑目录" % tag); continue
    run = os.path.basename(d[-1])
    p = os.path.join(d[-1], "games", "结果.jsonl")
    tiers, games = {}, {}
    total, max_ms, msg = 0, 0.0, ""
    for line in open(p, encoding="utf-8"):
        if not line.strip():
            continue
        g = json.loads(line)
        games[g["size"]] = games.get(g["size"], 0) + 1
        f = (g.get("faults") or {}).get(ME)
        if f:
            total += 1
            tiers[g["size"]] = tiers.get(g["size"], 0) + 1
            msg = str(f)
            max_ms = max(max_ms, (g.get("max_ms") or {}).get(ME) or 0)
    out[tag] = {"run": run, "games": sum(games.values()), "gamesByTier": games,
                "total": total, "byTier": tiers, "msg": msg, "maxMs": round(max_ms, 2)}
    print("%s：总局 %d · 故障 %d · 分档 %s · 最慢回合 %.2fms" % (tag, out[tag]["games"], total, tiers, out[tag]["maxMs"]))

json.dump(out, open(os.path.join(ROOT, "data", "ctf-faults.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("→ data/ctf-faults.json")
