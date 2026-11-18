# -*- coding: utf-8 -*-
"""把 dubbing/tts_clips/NN.wav 拼成**成片音轨**，轴直接取 data/cues.json 的 sentences[].start。

以前这脚本自己按固定 GAP 累加，dub.py 一改成「句间 0.6s / 换页 1.0s」就和成片错位；
现在按 cues 摆放，任何气口改动都自动跟上，末尾补到 cues.total（含「完」页那 11.5s）。
同时出「句号 -> 时间码」表和成片同长的 mp3。

  python3 pipeline/join_preview.py
"""
import array, json, os, pathlib, subprocess, sys, wave

ROOT = pathlib.Path(__file__).resolve().parent.parent
DUB = ROOT / "dubbing"
CLIPS = DUB / "tts_clips"
FADE_MS = 2  # 实测：2ms 已把边界台阶压到 0、窗内新增单样本跳变 ≤0.009（语音自身可达 0.79）；8ms 会把句 95 的塞音削掉 0.51


def fade(b, sr, ch):
    """TTS 片段常以非零样本起收，落进静音就是阶跃（实测 4 句达 0.15~0.19 满幅）→ 咔哒。"""
    n = int(sr * FADE_MS / 1000)
    if len(b) < 2 * n * ch * 2:
        return b
    a = array.array("h")
    a.frombytes(b)
    if sys.byteorder == "big":
        a.byteswap()
    for i in range(n):
        for c in range(ch):
            a[c + i * ch] = int(a[c + i * ch] * (i / n))
            j = len(a) - (n - i) * ch + c
            a[j] = int(a[j] * ((n - 1 - i) / n))
    if sys.byteorder == "big":
        a.byteswap()
    return a.tobytes()
PUNCT = "，。、；：？！…—－（）()《》“”‘’·,.;:!?%×- \t"
FFMPEG = os.environ.get("FFMPEG") or next(
    (p for p in [str(ROOT.parent / "bin" / "ffmpeg.exe"), "ffmpeg"] if os.path.exists(p) or p == "ffmpeg"), "ffmpeg")


def winpath(p):
    p = str(p).replace("\\", "/")
    if os.name == "nt" or not p.startswith("/mnt/"):
        return p.replace("/", "\\")
    return p[5].upper() + ":" + p[6:].replace("/", "\\")


def main():
    cues = json.loads((ROOT / "data" / "cues.json").read_text(encoding="utf-8"))
    order = sorted(CLIPS.glob("*.wav"), key=lambda p: int(p.stem))
    rows = cues["sentences"]
    if len(order) != len(rows):
        raise SystemExit("!! 音频 %d 句 vs cues %d 句，对不上" % (len(order), len(rows)))
    with wave.open(str(order[0]), "rb") as w:
        sr, ch, sw = w.getframerate(), w.getnchannels(), w.getsampwidth()
    total = int(round(cues["total"] * sr))
    buf = bytearray(total * ch * sw)
    tts = {r["i"]: r["tts"] for r in json.loads((DUB / "tts.json").read_text(encoding="utf-8"))}
    cps = []
    for k, p in enumerate(order):
        r = rows[k]
        with wave.open(str(p), "rb") as w:
            if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (sr, ch, sw):
                raise SystemExit("!! %s 参数与首句不一致，拼不了" % p.name)
            b = w.readframes(w.getnframes())
        b = fade(b, sr, ch)
        at = int(round(r["start"] * sr))
        if at * ch * sw + len(b) > len(buf):
            raise SystemExit("!! 句 %d 落在音轨之外（start %.2f + dur %.2f > total %.2f）" % (
                k + 1, r["start"], r["dur"], cues["total"]))
        buf[at * ch * sw: at * ch * sw + len(b)] = b
        d = len(b) / (sr * ch * sw)
        if abs(d - r["dur"]) > 0.01:
            raise SystemExit("!! 句 %d 实测 %.3fs 与 cues.dur %.3fs 不符，cues 没跟音频同步" % (
                k + 1, d, r["dur"]))
        i = int(p.stem)
        z = len([c for c in tts.get(i, "") if c not in PUNCT])
        cps.append(round(z / d, 2))

    out = DUB / "deck_audio.wav"
    with wave.open(str(out), "wb") as w:
        w.setnchannels(ch); w.setsampwidth(sw); w.setframerate(sr)
        w.writeframes(bytes(buf))
    mp3 = DUB / "deck_audio.mp3"
    r = subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", winpath(out), "-codec:a", "libmp3lame",
                        "-qscale:a", "3", winpath(mp3)], capture_output=True, text=True)
    print("[join] %d 句 -> %s（%.2f 分钟，含末叶 %.1fs 静默）；mp3 %s" % (
        len(order), out, total / sr / 60, cues["total"] - rows[-1]["start"] - rows[-1]["dur"],
        "已出" if r.returncode == 0 else "编码失败 " + r.stderr[:120]))

    tbl = ["成片音轨时间码｜跳 mm:ss 即该句第一帧（deck_audio，%d 句 / %.2f 分钟）" % (len(order), total / sr / 60),
           "轴 = data/cues.json；句间 %.1fs、换页 %.1fs；音轨长度与 cues.total 相等，OBS 录屏时按这张表起音即可对位" % (
               cues.get("gap", 0.6), cues.get("page_gap", 0.6))]
    for k, row in enumerate(rows):
        tbl.append("%3d  %s  页%-3d  %5.2fs  %4.2f字/秒  %s" % (
            k + 1, "%d:%02d" % divmod(int(round(row["start"])), 60), row["page"], row["dur"], cps[k], row["text"]))
    (DUB / "成片时间码.txt").write_text("\n".join(tbl) + "\n", encoding="utf-8")
    print("[join] 时间码表 ->", DUB / "成片时间码.txt")
    flip = [i for i in range(1, len(rows)) if rows[i]["page"] != rows[i - 1]["page"]]
    print("[join] 换页 %d 次；末页 start %.2f，句1 %.2fs，句2 start %.2f" % (
        len(flip), rows[-1]["start"], rows[0]["dur"], rows[1]["start"]))


if __name__ == "__main__":
    main()
