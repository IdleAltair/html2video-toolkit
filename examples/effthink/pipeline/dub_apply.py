# -*- coding: utf-8 -*-
"""把 dubbing/tts_fit（择优 + ±15% 语速对齐后的整片）落到正式逐句目录。

取件：dubbing/tts_fit/NN.wav 优先，缺则回退 dubbing/tts_rework/NN.wav；两者都没有就算没定稿，直接拒绝执行。
被覆盖的旧件一律移到 dubbing/tts_clips_superseded/<时间戳>/，不删。
落地后自动重跑 dub.py --timeline（它会顺带重建 index.html，因为 cues.json 变新）。

用法：
  python3 pipeline/dub_apply.py          只列计划
  python3 pipeline/dub_apply.py --go     执行
"""
import argparse, io, json, os, shutil, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUB = os.path.join(ROOT, "dubbing")
FIT = os.path.join(DUB, "tts_fit")
REWORK = os.path.join(DUB, "tts_rework")
PREV = os.path.join(DUB, "tts_rework_cfg4")
TEMPO = os.path.join(DUB, "tts_atempo")
CLIPS = os.path.join(DUB, "tts_clips")
CHAIN = (FIT, REWORK, PREV, CLIPS)
KEEP_ATEMPO = {46}              # 只有 46 允许用 tts_atempo 件，其余 atempo 件已被用户否掉


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true", help="真正执行（默认只列计划）")
    a = ap.parse_args()
    ids = sorted(r["i"] for r in json.load(io.open(os.path.join(DUB, "tts.json"), encoding="utf-8")))

    move, miss = [], []
    for i in ids:
        for base in ([TEMPO] if i in KEEP_ATEMPO else []) + list(CHAIN):
            p = os.path.join(base, "%02d.wav" % i)
            if os.path.exists(p):
                move.append((i, p, os.path.join(CLIPS, "%02d.wav" % i)))
                break
        else:
            miss.append(i)
    arch = os.path.join(DUB, "tts_clips_superseded", time.strftime("%Y%m%d-%H%M%S"))
    bysrc = {}
    for i, s, d in move:
        bysrc[os.path.basename(os.path.dirname(s))] = bysrc.get(os.path.basename(os.path.dirname(s)), 0) + 1
    print("[apply] %d 句就绪：%s；缺件 %s" % (
        len(move), " / ".join("%s %d" % (k, v) for k, v in sorted(bysrc.items())), miss or "无"))
    if miss:
        raise SystemExit("!! 还有 %d 句没定稿：%s" % (len(miss), miss))
    if len(move) != len(ids):
        raise SystemExit("!! 句数对不上：%d vs %d" % (len(move), len(ids)))
    if not a.go:
        same = [i for i, s, d in move if os.path.abspath(s) == os.path.abspath(d)]
        print("[apply] dry-run；%d 句源件就在 tts_clips 里（就地保留），其余覆盖前移到 %s" % (len(same), arch))
        print("[apply] 加 --go 执行，并在落完重跑 dub.py --timeline")
        return

    os.makedirs(arch, exist_ok=True)
    same = [i for i, s, d in move if os.path.abspath(s) == os.path.abspath(d)]
    for i, s, d in move:
        if i in same:
            continue          # 源件本来就在正式目录里，搬走再复制等于自己删自己
        if os.path.exists(d):
            shutil.move(d, os.path.join(arch, "%02d.wav" % i))
        shutil.copyfile(s, d)
    print("[apply] 已替换 %d 句、就地保留 %d 句，旧件存档 %d 个 -> %s" % (
        len(move) - len(same), len(same), len([f for f in os.listdir(arch) if f.endswith(".wav")]), arch))
    subprocess.check_call([sys.executable, os.path.join(ROOT, "pipeline", "dub.py"),
                           "--timeline", "dubbing/tts_clips"], cwd=ROOT)


if __name__ == "__main__":
    main()
