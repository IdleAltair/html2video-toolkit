
"""按「节目效果」给三场重跑批次里的每一局打分，挑出值得录屏的定点回放候选。

  python3 pipeline/clip-pick.py [--top N] [--write]

口径：
  · 单人局 → 挑「赢强敌」（对手强弱取该场 BT 表；圈地没有 BT 表，用本批 1128 局的均名次当强弱）
  · 多人局 → 挑「拉跨」（人越多、名次越靠后越靠前）
  · 加时   → 挑「同一张地图同座位，ot 比 main 涨得多」
  · 炸弹人另挑「死在被截断的盲区」：25×25 棋盘的格号 ≥ 313（x + 25y）
bomb 的回放现成在 <run>/replays/NNNNN.json；land / ctf 的重跑没存回放，候选给出重放命令。
"""
import argparse, json, pathlib, statistics, collections

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
ARENA = pathlib.Path('$HOME/deepseek-harness/workplace/meow-ai-arena')
ME = {'bomb': '你的 bot', 'land': 'your-bot@you#1', 'ctf': '你的 bot'}
CELLS = {'bomb': 25}  # 十人档棋盘 25×25，第 313 格之后收不到火


def newest(pat):
    c = sorted(ARENA.glob(pat))
    if not c:
        raise SystemExit('找不到批次: ' + pat)
    return c[-1]


def load_ratings():
    d = json.loads((ROOT / 'data' / 'challenge-full.json').read_text(encoding='utf-8'))
    r = {'bomb': {}, 'ctf': {}}
    for k in ('ctl_ctlmain', 'ctl_ctlot', 'ctl_ctlotw2'):
        for n, v in (d['bomb'].get(k, {}).get('ratings') or {}).items():
            r['bomb'].setdefault(n, v)
    for k in ('main', 'ot'):
        for n, v in (d['ctf'].get(k, {}).get('ratings') or {}).items():
            r['ctf'].setdefault(n, v)
    return r


def bomb_rows():
    R = newest('bomberman/challenge-runs/rerun-ot-w2-*')
    rows = []
    for e in json.loads((R / 'results.json').read_text(encoding='utf-8')):
        r = e['result']
        names = r.get('names') or []
        if ME['bomb'] not in names:
            continue
        i = names.index(ME['bomb'])
        pts, num = r.get('points_exact'), r.get('points') or []
        rows.append(dict(ver='ot', run=R, match=e['match'], size=e['size'], seed=r.get('seed'), names=names, me=i,
                         pts=pts, num=num, rank=(r.get('ranks') or [None])[i], turns=r.get('turns'), players=r.get('players'),
                         replay=R / 'replays' / ('%05d.json' % e['match']),
                         win=all(num[i] > p for j, p in enumerate(num) if j != i)))
    return rows


def land_rows():
    out = []
    for ver, pat in (('main', 'land/challenge-runs/rerun-main-j2-*'), ('ot', 'land/challenge-runs/rerun-ot-j2-*')):
        R = newest(pat)
        for ln in (R / 'results.jsonl').read_text(encoding='utf-8').splitlines():
            if not ln.strip():
                continue
            d = json.loads(ln)
            if ME['land'] not in d['names']:
                continue
            i = d['names'].index(ME['land'])
            out.append(dict(ver=ver, run=R, mode=d['mode'], size=len(d['names']), seed=d['seed'], names=d['names'],
                            ranks=d['ranks'], me=i, rank=d['ranks'][i], score=d['areas'][i], win=(d['winner'] == i)))
    # 圈地没有对外 BT 表：用本批单挑局的平均名次当对手强弱（越小越强）
    acc = collections.defaultdict(list)
    for r in out:
        if r['mode'] != 'duel':
            continue
        for j, n in enumerate(r['names']):
            acc[n].append(r['ranks'][j])
    mean_rank = {n: statistics.mean(v) for n, v in acc.items() if v}
    return out, mean_rank


def ctf_rows():
    out = []
    for ver, pat in (('main', 'ctf/challenge-runs/rerun-main-w2-*'), ('ot', 'ctf/challenge-runs/rerun-ot-w2-*')):
        R = newest(pat)
        for f in sorted((R / 'games').glob('结果.jsonl')):
            for ln in f.read_text(encoding='utf-8').splitlines():
                if not ln.strip():
                    continue
                d = json.loads(ln)
                if ME['ctf'] not in d['seats']:
                    continue
                i = d['seats'].index(ME['ctf'])
                sc = d['score'][i]
                out.append(dict(ver=ver, run=R, id=d['id'], size=d['size'], seed=d['map_seed'], names=d['seats'],
                                me=i, score=sc, rank=1 + sum(1 for s in d['score'] if s > sc),
                                faults=(d.get('faults') or {})))
    return out


def show(title, items, fmt, top):
    print('== %s ==' % title)
    if not items:
        print('   （这一档还没有数据）')
    for it in items[:top]:
        print('  ' + fmt(it))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--top', type=int, default=5)
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()
    rat = load_ratings()
    bomb = bomb_rows()
    land, land_rank = land_rows()
    ctf = ctf_rows()
    W = dict(bomb=rat['bomb'], ctf=rat['ctf'])

    def st(kind, name):
        if kind == 'land':
            v = land_rank.get(name)
            return None if v is None else -v          # 平均名次越小越强 → 取负当分数
        return W[kind].get(name)

    solo = []
    for r in bomb:
        if r['size'] != 2 or not r['win']:
            continue
        opp = [n for n in r['names'] if n != ME['bomb']][0]
        solo.append((st('bomb', opp) or 0, r, opp))
    solo.sort(key=lambda t: -t[0])
    show('炸弹人 · 两人局赢强敌', solo, lambda t: '#%-4d 胜 %-20s（对手 BT %6.1f）%3d 回合  %s' % (t[1]['match'], t[2], t[0], t[1]['turns'] or 0, t[1]['replay'].name), args.top)

    melee = sorted([r for r in bomb if r['size'] >= 3], key=lambda r: (-r['size'], -(r['rank'] or 0), -(r['turns'] or 0)))
    show('炸弹人 · 多人局拉跨', melee, lambda r: '#%-4d %2d 人 第%2d/%d 名  %3d 回合  %s' % (r['match'], r['size'], r['rank'], r['size'], r['turns'] or 0, r['replay'].name), args.top)

    blind = []
    for r in bomb:
        pl = (r['players'] or [])[r['me']]
        if not pl or pl.get('alive'):
            continue
        idx = pl['y'] * CELLS['bomb'] + pl['x']
        if idx >= 313:
            blind.append((idx, r, pl))
    blind.sort(key=lambda t: -t[0])
    show('炸弹人 · 死在被截断的盲区（格号 ≥ 313）', blind, lambda t: '#%-4d %2d 人 第 %3d 格（%2d,%2d）第 %3d 回合  %s' % (t[1]['match'], t[1]['size'], t[0], t[2]['x'], t[2]['y'], t[2]['death_turn'], t[1]['replay'].name), args.top)

    lw = sorted([r for r in land if r['mode'] == 'duel' and r['win']], reverse=True,
                key=lambda r: st('land', [n for n in r['names'] if n != ME['land']][0]) or -9)  # 平均名次越小越强
    show('圈地 · 单挑赢的局（%d 局，对手强在前）' % len([r for r in land if r['mode'] == 'duel' and r['win']]), lw,
         lambda r: '%s seed %-6d 领地 %-5d 胜 %-22s %s' % (r['ver'], r['seed'], r['score'], [n for n in r['names'] if n != ME['land']][0], r['run'].name), args.top)

    lm = sorted([r for r in land if r['mode'] == 'melee'], key=lambda r: -r['rank'])
    show('圈地 · 混战垫底', lm, lambda r: '%s seed %-6d 第%d/4 名 领地 %-5d %s' % (r['ver'], r['seed'], r['rank'], r['score'], r['run'].name), args.top)

    zero = sorted([r for r in ctf if r['score'] == 0 and r['size'] >= 6], key=lambda r: (-r['size'], -r['rank']))
    show('夺旗 · 人多档零分局', zero, lambda r: '%s %2d 方 第%2d/%2d 名 %s  %s' % (r['ver'], r['size'], r['rank'], r['size'], r['id'], r['run'].name), args.top)

    cw = sorted([r for r in ctf if r['size'] == 2 and r['rank'] == 1], key=lambda r: -(st('ctf', [n for n in r['names'] if n != ME['ctf']][0]) or 0))
    show('夺旗 · 两方局赢的局', cw, lambda r: '%s 胜 %-20s 比分 %-3d 对手 BT %s  %s' % (r['ver'], [n for n in r['names'] if n != ME['ctf']][0], r['score'], st('ctf', [n for n in r['names'] if n != ME['ctf']][0]), r['id']), args.top)

    # 加时 vs 正赛：炸弹人两边钉的是同一套赛程，可以逐局同图比（正赛 w2 批次跑完才有数据）
    gain = []
    try:
        M = newest('bomberman/challenge-runs/rerun-main-w2-*')
        main_by = {}
        for e in json.loads((M / 'results.json').read_text(encoding='utf-8')):
            r = e['result']
            main_by[(e['size'], r.get('seed'), tuple(r.get('names') or []))] = r
        for r in bomb:
            key = (r['size'], r['seed'], tuple(r['names']))
            m = main_by.get(key)
            if not m:
                continue
            mp, op = (m.get('points') or []), (r.get('num') or [])
            if r['me'] >= len(mp) or r['me'] >= len(op):
                continue
            a, b = mp[r['me']], op[r['me']]
            gain.append((b - a, dict(match=r['match'], size=r['size'], replay=r['replay'], pts=m.get('points_exact')), a, b))
        gain.sort(key=lambda t: -t[0])
    except SystemExit:
        pass
    show('炸弹人 · 同图同座位 ot 比 main 涨分', gain, lambda t: '#%-4d %2d 人 %+5.3f 分（%s → %s）' % (t[1]['match'], t[1]['size'], t[0], t[2], t[3]), args.top)

    if args.write:
        outp = ROOT / 'data' / 'clip-picks.json'
        outp.write_text(json.dumps({
            'bomb_solo': [dict(match=t[1]['match'], opp=t[2], replay=str(t[1]['replay']), turns=t[1]['turns']) for t in solo[:20]],
            'bomb_melee': [dict(match=r['match'], size=r['size'], rank=r['rank'], replay=str(r['replay'])) for r in melee[:20]],
            'bomb_blind': [dict(match=t[1]['match'], cell=t[0], replay=str(t[1]['replay'])) for t in blind[:20]],
            'ctf_zero': [dict(id=r['id'], size=r['size'], run=str(r['run'])) for r in zero[:20]],
            'bomb_ot_gain': [dict(match=t[1]['match'], size=t[1]['size'], delta=round(t[0], 3),
                                  main_pts=t[2], ot_pts=t[3], replay=str(t[1]['replay'])) for t in gain[:20]],
            'land_duel_win': [dict(ver=r['ver'], seed=r['seed'], score=r['score'], opp=[n for n in r['names'] if n != ME['land']][0],
                                   run=str(r['run'])) for r in lw[:20]],
            'land_melee_last': [dict(ver=r['ver'], seed=r['seed'], score=r['score'], run=str(r['run'])) for r in lm[:20]],
            'ctf_duel_win': [dict(ver=r['ver'], score=r['score'], opp=[n for n in r['names'] if n != ME['ctf']][0],
                                  id=r['id'], run=str(r['run'])) for r in cw[:20]],
        }, ensure_ascii=False, indent=1), encoding='utf-8')
        print('\n写入', outp)


if __name__ == '__main__':
    main()
