#!/usr/bin/env python3
"""口播/页面信息分配体检（K3 第三轮的建议落成工具）。

规则：口播只给结论 + 因果 + 每页 1-2 组锚点，精确值全部留在页面上。
本脚本按「阿拉伯数字 token 数 <= max(2, 秒数 // 10)」给出报告——它是**报告**不是门，
因为模型名（Qwen3.8）、版本号（v13）、量词（第 8 名）都会被算成 token，需要人判。
同时校验稿子的「口播必念」栏与口播正文是否同步。
"""
import re, sys
P = 'script/口播稿.md'
t = open(P, encoding='utf-8').read()
marks = [m for m in re.finditer(r"^### (\d\d) ", t, re.M)]
bad = []
for k, m in enumerate(marks):
    en = marks[k+1].start() if k+1 < len(marks) else t.index("## 撤出画面的技术细节")
    body = t[m.end():en]
    mm = re.search(r"\*\*口播（(\d+) 秒）\*\*：([\s\S]*)", body)
    sec = int(mm.group(1))
    sp = mm.group(2).split("\n---")[0]
    declared = re.search(r"- \*\*口播必念\*\*：([^\n]*)", body).group(1)
    toks = sorted(set(x.rstrip('%') for x in re.findall(r"\d[\d,]*\.?\d*%?", sp)))
    cap = max(2, sec // 10)
    miss = [x for x in toks if x not in declared]
    if len(toks) > cap or miss:
        bad.append((m.group(1), sec, len(toks), cap, ",".join(toks), ("缺 " + ",".join(miss)) if miss else ""))
print("口播偏密或字段不同步的页: %d / %d" % (len(bad), len(marks)))
for r in bad:
    print("  p%s %d 秒 · 口播里 %d 个数字（上限 %d）: %s %s" % r)
