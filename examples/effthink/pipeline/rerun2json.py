#!/usr/bin/env python3
"""用受控并发重跑（圈地 j2 / 夺旗 w2 / 炸弹人 w2、w1）的结果，重生成 data/challenge-full.json 里对应字段。

数据源：meow-ai-arena 下各场的 challenge-runs/rerun-* 目录（只读，不改源码）。
  land  rerun-<main|ot>-j2-*/ratings.md          → land.<tag>
  ctf   rerun-<main|ot>-w2-*/games/成绩.json|md   → ctf.<tag>
  bomb  rerun-<main|ot>-w2-*/{bt.json,汇总.md}    → bomb.ctl_ctl<main|ot>；ot w1 → bomb.ctl_ctlotw1
用法：python3 pipeline/rerun2json.py [--write] [land|ctf|bomb ...]   （默认只打印，不写）
"""
import json, os, re, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
ARENA = "$HOME/deepseek-harness/workplace/meow-ai-arena"
ALIAS = {
    "你的 bot": "本地 27B", "your-bot@you": "本地 27B",
    "sonnet-5@claude-code": "Sonnet 5", "gpt-6-astra@codex": "GPT-6 Astra",
    "opus-5.5@claude-code": "Opus 5.5", "gpt-6-sol@codex": "GPT-6 Sol",
    "mimo-2.6-pro@zcode": "MiMo V2.6 Pro", "kimi-k3@workbuddy": "Kimi K3",
    "glm-5.3@workbuddy": "GLM 5.3", "deepseek-4.1f@workbuddy": "DeepSeek V4.1 Flash",
    "mystery-model@zcode": "神秘模型",
    "anchor-sparring": "陪练锚点", "anchor-greedy": "贪心基准", "anchor-random": "随机锚点",
    "基准": "贪心基准",
}


def num(s):
    m = re.search(r"-?\d+(?:\.\d+)?", str(s).replace(",", ""))
    return float(m.group()) if m else None


def pick(pattern):
    hits = sorted(glob.glob(pattern))
    return hits[-1] if hits else None


def cells(line):
    return [x.strip() for x in line.split("|")]


def parse_land(md):
    """ratings.md 主表 → land.<tag>（列序与旧 full2json.mjs 一致）"""
    head = open(md, encoding="utf-8").read().split("\n## ")[0]
    rows = [cells(l) for l in head.split("\n")
            if len(cells(l)) > 9 and re.match(r"^(\d+|锚点|—)$", cells(l)[1]) and num(cells(l)[3]) is not None]
    me = next((c for c in rows if c[2].startswith("your-bot")), None)
    rnd = next((c for c in rows if c[2] == "anchor-random"), None)
    ratings, anchors = {}, {}
    for c in rows:
        nm = ALIAS.get(c[2], c[2])
        (anchors if c[1] in ("锚点", "—") else ratings)[nm] = num(c[3])
    if me is None:
        raise SystemExit("ratings.md 里找不到 your-bot 行: " + md)
    return {
        "score": num(me[3]), "rank": int(me[1]),
        "field": max(int(c[1]) for c in rows if c[1].isdigit()),
        "duel": {"score": num(me[6]) or 0.0, "elo": num(me[7]) or 0.0},
        "melee": {"score": num(me[8]) or 0.0, "elo": num(me[9]) or 0.0},
        # 沿用旧列语义：randomAnchorElo 是随机锚点的「混战实力 Elo」，randomAnchorMelee 是它的「混战分」
        "randomAnchorElo": num(rnd[9]) if rnd else None,
        "randomAnchorMelee": num(rnd[8]) if rnd else None,
        "ci95": me[4], "ratings": ratings, "anchors": anchors,
    }


def parse_ctf(d):
    """games/成绩.json + 成绩.md → ctf.<tag>"""
    j = json.load(open(os.path.join(d, "games", "成绩.json"), encoding="utf-8"))
    rat, per = j["ratings"], j["per_size"]
    me = rat["你的 bot"]
    order = sorted(rat, key=lambda k: -rat[k][0])
    md = open(os.path.join(d, "games", "成绩.md"), encoding="utf-8").read()
    m = re.search(r"(\d+)\s*局", md)
    row = next((cells(l) for l in md.split("\n") if l.startswith("|") and "你的 bot" in l), None)
    ranked = [k for k in order if k != "基准"]          # 名次不含锚点（与 成绩.md 的「名次」列一致）
    return {"bt": round(me[0]), "rank": ranked.index("你的 bot") + 1,
            "field": len(ranked),
            "ci95": "%d ~ %d" % (round(me[1]), round(me[2])),
            "bySize": {s: round(per[s]["你的 bot"]) for s in sorted(per, key=lambda x: int(x))},
            "faults": int(num(row[-2])) if row and num(row[-2]) is not None else None,
            "games": int(m.group(1)) if m else None,
            "ratings": {ALIAS.get(k, k): round(v[0]) for k, v in rat.items() if k != "基准"}}


def cells_row(line):
    """markdown 表行 → 去掉首尾空单元格的列（与 cells() 不同：那个保留开头的空列，供 land/ctf 的固定列号使用）"""
    c = cells(line)
    while c and c[0] == "":
        c.pop(0)
    while c and c[-1] == "":
        c.pop()
    return c


def parse_bomb(d):
    """bt.json + 汇总.md → bomb.ctl_*（bySize 取逐人数档的表）"""
    bt = json.load(open(os.path.join(d, "bt.json"), encoding="utf-8"))
    rat = bt["ratings"]
    md = open(os.path.join(d, "汇总.md"), encoding="utf-8").read()
    bySize = {}
    for c in (cells_row(l) for l in md.split("\n") if l.startswith("|") and not l.startswith("|---")):
        if len(c) < 9 or not c[0].isdigit() or not c[1]:
            continue
        rec = bySize.setdefault(c[0], {"mine": None, "games": None, "live": None, "kill": None,
                                       "faults": None, "base": None, "baseFaults": None})
        if c[1] == "你的 bot":
            rec.update(games=int(num(c[2])), live=num(c[3]), kill=num(c[4]), mine=num(c[5]), faults=int(num(c[8])))
        elif c[1] == "Base":
            rec.update(base=num(c[5]), baseFaults=int(num(c[8])))
    order = [k for k in sorted(rat, key=lambda k: -rat[k]) if k != "Base"]   # Base 是锚点，不排名次
    return {"bt": round(rat["你的 bot"], 2), "rank": order.index("你的 bot") + 1, "field": len(order),
            "bySize": bySize,
            "ratings": {ALIAS.get(k, k): round(v, 2) for k, v in rat.items()},
            "anchors": {k: round(v, 2) for k, v in rat.items() if k == "Base"},
            "games": sum(r["games"] or 0 for r in bySize.values())}


def main():
    write = "--write" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    want = (lambda k: not only or k in only)
    path = os.path.join(DATA, "challenge-full.json")
    doc = json.load(open(path, encoding="utf-8"))
    touched = []

    if want("land"):
        for tag in ("main", "ot"):
            d = pick(os.path.join(ARENA, "land", "challenge-runs", "rerun-%s-j2-*" % tag))
            if not d:
                print("圈地 %s：无 j2 重跑目录，跳过" % tag); continue
            new = parse_land(os.path.join(d, "ratings.md")); old = doc["land"][tag]
            print("圈地 %s  新 %s（名次 %s）  旧 %s（名次 %s）" % (tag, new["score"], new["rank"], old.get("score"), old.get("rank")))
            doc["land"][tag] = new; touched.append("land." + tag)

    if want("ctf"):
        for tag in ("main", "ot"):
            d = pick(os.path.join(ARENA, "ctf", "challenge-runs", "rerun-%s-w2-*" % tag))
            if not d or not os.path.exists(os.path.join(d, "games", "成绩.json")):
                print("夺旗 %s：成绩.json 未产出，跳过" % tag); continue
            new = parse_ctf(d); old = doc["ctf"][tag]
            print("夺旗 %s  新 BT %s（名次 %s，故障 %s）  旧 BT %s（名次 %s，故障 %s）" % (tag, new["bt"], new["rank"], new["faults"], old.get("bt"), old.get("rank"), old.get("faults")))
            doc["ctf"][tag] = new; touched.append("ctf." + tag)

    if want("bomb"):
        for key, pat, label in (("ctl_ctlmain", "rerun-main-w2-*", "正赛版 w2"),
                                ("ctl_ctlot", "rerun-ot-w2-*", "加时终版 w2"),
                                ("ctl_ctlotw1", "rerun-ot-w1-*", "加时终版 w1")):
            d = pick(os.path.join(ARENA, "bomberman", "challenge-runs", pat))
            if not d or not os.path.exists(os.path.join(d, "bt.json")):
                print("炸弹人 %s：未产出，跳过" % label); continue
            new = parse_bomb(d); old = doc["bomb"].get(key, {})
            print("炸弹人 %s  新 BT %s（名次 %s）  旧 BT %s（名次 %s）" % (label, new["bt"], new["rank"], old.get("bt"), old.get("rank")))
            doc["bomb"][key] = new; touched.append("bomb." + key)

    if not touched:
        print("没有可写入的字段")
        return
    print("将写入：" + "、".join(touched))
    if write:
        json.dump(doc, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("已写入 " + path)


if __name__ == "__main__":
    main()
