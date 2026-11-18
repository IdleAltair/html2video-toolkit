#!/usr/bin/env bash
# 核对 dsh 给的输入文件：句数、字数、按不同语速会是多少分钟
D=$HOME/deepseek-harness/workplace/arena-p3r-sample/dubbing
$HOME/breeze-tts-env/.venv/bin/python - <<'PY'
import re, io
p = "$HOME/deepseek-harness/workplace/arena-p3r-sample/dubbing/字幕.zh.txt"
s = io.open(p, encoding="utf-8").read()
lines = [l.strip() for l in s.splitlines()]
valid = [l for l in lines if re.match(r"^\d+(min\d+s)?\s+\S", l)]
txt = "".join(re.sub(r"^\d+(min\d+s)?\s+", "", l) for l in valid)
han = len(re.findall(r"[\u4e00-\u9fff]", txt))
nonspace = len(re.sub(r"\s", "", txt))
print(f"文件行数 {len(lines)}  有效句 {len(valid)}  汉字 {han}  非空白字符 {nonspace}")
print(f"最长句 {max(len(l) for l in valid)} 字符   平均 {nonspace/max(1,len(valid)):.1f} 字符/句")
print("\n按不同语速（非空白字符/秒）估语音总长：")
for r in (3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0):
    print(f"  {r:.1f} 字/秒 -> {nonspace/r/60:5.1f} 分钟")
print("\n对照日语版：")
pj = p.replace("字幕.zh.txt", "字幕.ja.txt")
try:
    sj = io.open(pj, encoding="utf-8").read()
    lj = [l.strip() for l in sj.splitlines() if re.match(r"^\d+(min\d+s)?\s+\S", l)]
    tj = "".join(re.sub(r"^\d+(min\d+s)?\s+", "", l) for l in lj)
    nj = len(re.sub(r"\s", "", tj))
    print(f"  句数 {len(lj)}  非空白字符 {nj}  -> 若成片 852s 则 {nj/852:.2f} 字/秒")
except Exception as e:
    print("  读不到日语版", e)
print("\n样例（前 3 句 / 后 2 句）：")
for l in valid[:3] + valid[-2:]:
    print("   ", l[:70])
PY
