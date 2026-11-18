"""炸弹人 full 档复跑一次，把并发从 7 压到 2。

动机：challenge.py 硬编码默认 workers=7，十人局同时开 7 局 = 70 个进程抢 14 核，
5:1 超卖。本机 bot 的每回合时限是 50ms（正赛余量：非首回合中位 40.3ms、最慢一回合 p90 48.0ms），
超卖会让它被判故障，从而把 BT 实力值与名次一起拖下去。这一轮把 workers 压到 2（十人局 20 进程 / 14 核 = 1.4:1），
看故障局与名次是否回升——若名次变了，第 10/13/19 页的炸弹人结论就得改口径。

参数与 challenge.py --full 完全一致（同一份 bot.cpp、同一份 FORMAL 对手表、sizes 2/3/10、seeds 1），只差 workers。
结果写进新的时间戳目录，不覆盖 20261004-045254 那一轮。
"""
import subprocess
import sys
import time
from pathlib import Path

BOMB = Path("$HOME/deepseek-harness/workplace/meow-ai-arena/bomberman")
MINE = "$HOME/deepseek-harness/workplace/meow-ai-arena/contestants/runs/bomberman-gui1/submission/bot.cpp"

sys.path.insert(0, str(BOMB / "tournament"))
from run import FORMAL  # noqa: E402

out = BOMB / "challenge-runs" / time.strftime("w2-%Y%m%d-%H%M%S")
cmd = [sys.executable, "-X", "utf8", str(BOMB / "tournament" / "run.py"),
       "--output", str(out), "--bots", f"你的 bot={MINE}", *FORMAL,
       "--sizes", "2", "3", "10", "--seeds", "1", "--workers", "2"]
print("OUT=" + str(out), flush=True)
print(" ".join(cmd), flush=True)
raise SystemExit(subprocess.call(cmd))
