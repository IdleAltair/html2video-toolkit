"""炸弹人干净对照：固定赛程种子，一次只改一个变量。

为什么需要它：tournament/evaluate.py 的 --seed（赛程种子，决定座位顺序与地图）默认不走命令行——
challenge.py 只传 --seeds（每种人数几张图），于是 args.seed is None → secrets.randbits(63)，
每次跑都换一整套赛程。我上一轮拿「workers 7 → 2」解释 BT 75.64 → 54.15，那个对照是脏的：
并发和赛程同时变了，归因不成立。这里直接调 evaluate.py 把 --seed 钉住，跑三组：

  A 正赛版   seed=S workers=7   ┐ 只差代码
  B 加时终版 seed=S workers=7   ┘
  C 加时终版 seed=S workers=2   ┐ 与 B 只差并发
                                ┘

二进制都用 workspace/build/ 里现成的（哈希已核对与各 run 的 identity.json 一致），不重新编译，避免产物漂移。
"""
import json
import subprocess
import sys
import time
from pathlib import Path

BOMB = Path("$HOME/deepseek-harness/workplace/meow-ai-arena/bomberman")
BUILD = BOMB / "workspace" / "build"
SEED = 20261004                      # 钉死赛程：三组用同一套座位与地图
RIVALS = [
    ("GPT-6 Astra", "gpt-6-astra-ffa1355ef2a1"),
    ("GPT-6 Sol", "gpt-6-sol-6cf1e62beeb0"),
    ("Opus 5.5", "opus-5.5-5bb8cbb8c99f"),
    ("Kimi K3", "kimi-k3-204e89bcc828"),
    ("GLM 5.3", "glm-5.3-62cfd8c25179"),
    ("DeepSeek V4.1 Flash", "deepseek-v4.1-flash-893ca913a06e"),
    ("豆包 Seed 2.1", "doubao-seed-2.1-230cea2edfda"),
    ("Qwen 3.8 Max", "qwen-3.8-max-37fa03b4f491"),
    ("MiMo V2.6 Pro", "mimo-v2.6-pro-00cc917e49b9"),
    ("Base", "baseline-a4ca3e21d2f8"),
]
MINE = {"main": "bot-2d9c83320600", "ot": "bot-3650968bd41d"}   # 正赛版 / 加时终版
RUNS = [("main-w7", "main", 7), ("ot-w7", "ot", 7), ("ot-w2", "ot", 2)]

for tag, which, workers in RUNS:
    out = BOMB / "challenge-runs" / ("ctl-" + tag + "-" + time.strftime("%H%M%S"))
    # 不能预先 mkdir：evaluate.py 见到已存在的输出目录会直接拒绝（"Output exists; use --resume"）
    bots = [f"你的 bot={BUILD / MINE[which]}"] + [f"{n}={BUILD / e}" for n, e in RIVALS]
    missing = [b.split("=")[1] for b in bots if not Path(b.split("=", 1)[1]).is_file()]
    if missing:
        sys.exit("缺二进制：" + ", ".join(missing))
    cmd = [sys.executable, "-X", "utf8", "-u", str(BOMB / "tournament" / "evaluate.py"),
           "--workspace", str(BOMB / "workspace"), "--bots", *bots, "--anchor", "Base",
           "--output", str(out), "--sizes", "2", "3", "10", "--seeds", "1",
           "--seed", str(SEED), "--workers", str(workers), "--report-every", "200"]
    print(f"[ctl] {tag}: workers={workers} seed={SEED} out={out.name}", flush=True)
    r = subprocess.call(cmd)
    print(f"[ctl] {tag} exit={r}", flush=True)
print(json.dumps({"seed": SEED, "runs": [str(BOMB / 'challenge-runs')], "note": "看各 run 的 汇总.md / bt.json"}, ensure_ascii=False))
