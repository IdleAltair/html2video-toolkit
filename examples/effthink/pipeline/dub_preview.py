# -*- coding: utf-8 -*-
"""拼「返工后的整片预演」试听件并出时间码表，不改动任何正式目录。

每句的取件优先级（先命中先取）：
  1. dubbing/tts_atempo/46.wav        用户点名保留的 atempo 件
  2. dubbing/tts_rework/NN.wav        本轮抽卡择优件
  3. dubbing/tts_clips/NN.wav         首轮的 31 句合格件
句间 GAP 与 pipeline/dub.py 的 0.6 秒一致，所以 --go 落地后 cues 的 start 与本表逐句相同。

用法：python3 pipeline/dub_preview.py
"""
import json, os, subprocess, wave, numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUB = os.path.join(ROOT, "dubbing")
CLIPS, REWORK, TEMPO = os.path.join(DUB, "tts_clips"), os.path.join(DUB, "tts_rework"), os.path.join(DUB, "tts_atempo")
PREV = os.path.join(DUB, "tts_rework_cfg4")
FIT = os.path.join(DUB, "tts_fit")        # ±15% 语速对齐后的本轮件      # 上一轮 cfg4 的择优件
FITREST = os.path.join(DUB, "tts_fit_rest")   # 其余句的 ±15% 对齐件，只进试听、不进 dub_apply
SR = 24000
GAP = 0.6
PAGE_GAP = 1.0      # 换页气口，与 pipeline/dub.py 的 PAGE_GAP 同步
TAIL_HOLD = 1.5     # 收尾页前的留白，与 dub.py 一致
TAIL = 11.5         # 「完」页占位
KEEP_ATEMPO = {46}      # 用户只点名保留 46 的 atempo 件；其余 atempo 件已被否，不得进成片
FFMPEG = os.environ.get("FFMPEG") or next(
    (p for p in [os.path.join(os.path.dirname(ROOT), "bin", "ffmpeg.exe"), "ffmpeg"] if os.path.exists(p) or p == "ffmpeg"), "ffmpeg")


def win(p):
    """WSL 路径 -> Windows 路径（WSL 里没有 ffmpeg，只能喊 Windows 那个 exe）。"""
    if os.name == "nt" or not p.startswith("/mnt/"):
        return p.replace("/", "\\")
    return p[5].upper() + ":" + p[6:].replace("/", "\\")


def rd(p):
    with wave.open(p, "rb") as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (SR, 1, 2), p
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0


def pick(i):
    # 本轮 cfg2+对齐 > 其余句的 ±15% 对齐（待批） > 本轮未对齐 > 上一轮 cfg4 择优 > 用户点名保留的 atempo 件(仅 46) > 首轮原样
    chain = [("本轮", os.path.join(FIT, "%02d.wav" % i))]
    if not os.environ.get("DUB_NOREST"):
        chain.append(("对齐待批", os.path.join(FITREST, "%02d.wav" % i)))
    if i in KEEP_ATEMPO:
        chain.append(("保留", os.path.join(TEMPO, "%02d.wav" % i)))
    chain += [("本轮未对齐", os.path.join(REWORK, "%02d.wav" % i)),
              ("上轮", os.path.join(PREV, "%02d.wav" % i)),
              ("首轮", os.path.join(CLIPS, "%02d.wav" % i))]
    for tag, p in chain:
        if os.path.exists(p):
            return tag, p
    raise SystemExit("!! 句 %d 没有可用音频" % i)


def main():
    tts = {r["i"]: r for r in json.load(open(os.path.join(DUB, "tts.json"), encoding="utf-8"))}
    cand = {}
    mf = os.path.join(REWORK, "manifest.json")
    if os.path.exists(mf):
        for c in json.load(open(mf, encoding="utf-8")):
            best = cand.get(c["i"])
            if best is None or c["score"] < best["score"]:
                cand[c["i"]] = c

    chunks, rows, t = [], [], 0.0
    order = sorted(tts)
    for n, i in enumerate(order):
        tag, path = pick(i)
        x = rd(path)
        d = len(x) / SR
        c = cand.get(i, {})
        z = len([ch for ch in tts[i]["tts"] if ch not in "，。、；：？！…—－（）()《》“”‘’·,.;:!?%×- 	"])
        rows.append((i, tts[i]["page"], tag, t, d, round(z / d, 2), c.get("seed"), c.get("ins"), tts[i]["srt"]))   # 字/秒按最终音频实测，变速后与成片一致
        pg2 = order[n + 1] if n + 1 < len(order) else None
        g = PAGE_GAP if pg2 is not None and tts[pg2]["page"] != tts[i]["page"] else GAP
        chunks += [x, np.zeros(int(SR * g), np.float32)]
        t += d + g
    y = np.concatenate(chunks[:-1])
    total = round(len(y) / SR + TAIL_HOLD + TAIL, 3)

    out = os.path.join(DUB, os.environ.get("DUB_OUT", "preview_final") + ".wav")
    with wave.open(out, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(y, -1, 1) * 32767).astype("<i2").tobytes())
    mp3 = out[:-4] + ".mp3"
    r = subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", win(out), "-codec:a", "libmp3lame",
                        "-qscale:a", "3", win(mp3)], capture_output=True, text=True)
    print("[preview] %d 句 -> %s（另有 %s）  语音 %.1fs（%.2f 分），成片轴 total=%.2fs（%.2f 分）" % (
        len(rows), out, os.path.basename(mp3), len(y) / SR, len(y) / SR / 60, total, total / 60))
    if r.returncode:
        print("[preview] mp3 编码失败：%s" % r.stderr[:200])

    def tc(s):
        s = int(round(s))
        return "%d:%02d" % (s // 60, s % 60)

    cnt = {k: len([r for r in rows if r[2] == k]) for k in ("本轮", "对齐待批", "保留", "本轮未对齐", "上轮", "首轮")}
    tbl = ["返工后整片预演｜跳 mm:ss 即该句第一帧（语音 %.1f 分，成片轴 %.2f 分）" % (len(y) / SR / 60, total / 60),
           "来源：本轮 cfg2+对齐 %d 句 / 其余句 ±15%% 对齐（待批）%d 句 / 保留 atempo 件 %d 句 / 本轮未对齐 %d 句 / 上轮 cfg4 择优 %d 句 / 首轮原样 %d 句；句间 0.6s、换页 1.0s，与 dub.py 一致" % (
               cnt["本轮"], cnt["对齐待批"], cnt["保留"], cnt["本轮未对齐"], cnt["上轮"], cnt["首轮"]),
           "句号  时间码  页   时长    字/秒  seed 措辞  来源   文本"]
    for i, pg, tag, st, d, cps, seed, ins, srt in rows:
        tbl.append("%3d  %s   页%-3d %5.2fs  %s  %s %s  %-5s %s" % (
            i, tc(st), pg, d, ("%.2f" % cps) if cps else "  -  ",
            ("%4d" % seed) if seed else "   - ", ins or " ", tag, srt))
    p = os.path.join(DUB, os.environ.get("DUB_TABLE", "试听对照") + ".txt")
    open(p, "w", encoding="utf-8").write("\n".join(tbl) + "\n")
    print("[preview] 时间码表 -> %s" % p)
    low = [(i, cps) for i, pg, tag, st, d, cps, seed, ins, srt in rows if tag.startswith("本轮") and cps and cps < 5.5]
    print("[preview] 本轮重抽件里仍低于 5.5 字/秒的 %d 句：%s" % (len(low), ",".join("%d(%.2f)" % x for x in low) or "无"))


if __name__ == "__main__":
    main()
