"""重标稿子里每页的「口播（N 秒）」，并回写前言里的合计。

优先用 data/cues.json（日语 TTS 实测时长）；没有它时退回 3.74 字/秒（中文口径）估算。

  python3 pipeline/syncsecs.py            # 改 script/口播稿.md
  python3 pipeline/syncsecs.py --dry      # 只看差异

只动「（N 秒）」与前言那两行合计，正文一个字不碰。
"""
import json, re, sys, pathlib

P = pathlib.Path('$HOME/deepseek-harness/workplace/arena-p3r-sample/script/口播稿.md')
CPS = 3.74
CUES = P.parent.parent / 'data' / 'cues.json'
measured = {}
if CUES.exists():
    measured = {p['page']: p['dur'] for p in json.loads(CUES.read_text(encoding='utf-8'))['pages']}
t = P.read_text(encoding='utf-8')
ms = [m for m in re.finditer(r'^### (\d\d) (.*)$', t, re.M)]
total = 0
rows = []
for k, m in enumerate(ms):
    end = ms[k + 1].start() if k + 1 < len(ms) else len(t)
    body = t[m.end():end]
    sp = re.split(r'\*\*口播（[^）]*）\*\*：', body)
    spoken = (sp[1] if len(sp) > 1 else '').split('\n---')[0]
    chars = len(re.sub(r'\s', '', spoken))
    total += chars
    sec = round(measured.get(int(m.group(1)), chars / CPS))
    rows.append((int(m.group(1)), sec, chars, m.end(), end))

out = t
for n, sec, chars, a, b in reversed(rows):
    body = out[a:b]
    new = re.sub(r'\*\*口播（[^）]*）\*\*：', '**口播（%d 秒）**：' % sec, body, count=1)
    out = out[:a] + new + out[b:]
mins = (sum(measured.values()) if measured else total / CPS) / 60
out = re.sub(r'口播合计约 [\d,]+ 字 ≈ \d+ 分钟[^（]*', '口播合计约 %s 字 ≈ %.0f 分钟（%s）' % (format(total, ','), mins, '日语 TTS 实测' if measured else '按 3.74 字/秒 估'), out)
if '--dry' in sys.argv:
    for n, sec, chars, _, _ in rows:
        print('p%02d %5d 字 → %3d 秒' % (n, chars, sec))
    print('合计 %d 字 ≈ %.1f 分钟' % (total, mins))
else:
    P.write_text(out, encoding='utf-8')
    print('重标完成：合计 %d 字 ≈ %.1f 分钟（%.1f 秒/页均）' % (total, mins, total / CPS / len(rows)))
