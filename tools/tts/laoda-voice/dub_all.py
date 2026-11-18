"""按 dsh 的规格出全片中文配音：逐句 NN.wav（00 = 第一句），24k / mono / 16 bit 原始输出。
定档：instruction="语速缓慢从容，吐字清晰，不赶时间。" cfg_scale=4 seed=7（实测 7.02 字/秒，参考原声 7.29）
不做淡入淡出、不做响度归一、不补首尾静音。已存在的文件跳过，可断点续跑。
"""
import io, os, re, sys, time, json
import requests
import numpy as np
import soundfile as sf

SRC = "$HOME/deepseek-harness/workplace/arena-p3r-sample/dubbing/字幕.zh.txt"
REF = "$TMP/tts/vocal/ref_t06_from0.6s.wav"
REFT = io.open("$TMP/tts/ref_text.txt", encoding="utf-8").read().strip()
OUT = "$TMP/tts/dub-zh"
URL = "http://127.0.0.1:7861/v1/audio/speech"
INS = "语速缓慢从容，吐字清晰，不赶时间。"
SEED, CFG, SR = 7, 4, 24000

os.makedirs(OUT, exist_ok=True)


def parse(fn):
    items = []
    for line in io.open(fn, encoding="utf-8"):
        line = line.strip()
        m = re.match(r"^(\d+)min(\d+)s\s+(\S.*)$", line)
        if m:
            items.append(m.group(3))
            continue
        m = re.match(r"^(\d+)s\s+(\S.*)$", line)
        if m:
            items.append(m.group(2))
    return items


def nc(s):
    return len(re.sub(r"[\s，。、：；！？「」“”()（）\-—·…]", "", s))


texts = parse(SRC)
print(f"读到 {len(texts)} 句，总字符 {sum(nc(t) for t in texts)}", flush=True)
rows, fails = [], []
t_all = time.time()
for i, txt in enumerate(texts):
    p = os.path.join(OUT, f"{i:02d}.wav")
    if os.path.exists(p):
        x, _ = sf.read(p)
        rows.append((i, len(x) / SR, nc(txt)))
        continue
    ok = False
    for attempt in range(3):
        try:
            with open(REF, "rb") as fh:
                r = requests.post(URL,
                                  files={"ref_audio": ("ref.wav", fh, "audio/wav")},
                                  data={"ref_text": REFT, "text": txt, "instruction": INS,
                                        "cfg_scale": str(CFG), "seed": str(SEED)},
                                  proxies={"http": None, "https": None}, timeout=900)
            if r.status_code == 200 and len(r.content) >= 2000:
                x = np.frombuffer(r.content, dtype="<i2").astype("float32") / 32768
                sf.write(p, x, SR, subtype="PCM_16")
                rows.append((i, len(x) / SR, nc(txt)))
                ok = True
                break
            print(f"  [{i:02d}] 第{attempt+1}次失败 http={r.status_code} bytes={len(r.content)}", flush=True)
        except Exception as e:
            print(f"  [{i:02d}] 第{attempt+1}次异常 {type(e).__name__} {e}", flush=True)
        time.sleep(3)
    if not ok:
        fails.append(i)
        print(f"[{i:02d}] !! 放弃  {txt[:28]}", flush=True)
        continue
    idx, dur, n = rows[-1]
    print(f"[{i:02d}] {dur:5.2f}s  {n/dur:4.2f}字/秒  {txt[:30]}", flush=True)

tot = sum(r[1] for r in rows)
tcs = sum(r[2] for r in rows)
print(f"\n完成 {len(rows)}/{len(texts)} 句  语音总长 {tot:.1f}s = {tot/60:.1f} 分钟")
print(f"整体语速 {tcs/tot:.2f} 字/秒   墙钟 {time.time()-t_all:.0f}s")
if rows:
    rates = [r[2] / r[1] for r in rows]
    rates.sort()
    print(f"逐句字/秒：min {rates[0]:.2f}  中位 {rates[len(rates)//2]:.2f}  max {rates[-1]:.2f}")
    slow = [(r[0], r[2]/r[1]) for r in rows if r[2] / r[1] < 5.6 or r[2] / r[1] > 8.8]
    print("偏离定档(5.6–8.8 之外)的句子:", [(f"{i:02d}", round(v, 2)) for i, v in slow] or "无")
print("失败句:", fails or "无")
io.open(os.path.join(OUT, "durations.json"), "w", encoding="utf-8").write(
    json.dumps([{"file": f"{i:02d}.wav", "sec": round(d, 3), "chars": n} for i, d, n in rows],
               ensure_ascii=False, indent=1))
