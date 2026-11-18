# -*- coding: utf-8 -*-
"""成片音轨：配音整轨 + 页面同款配乐，口径对齐 dsh 在 arena-video 那条线上验证过的链。

  人声  loudnorm=I=-16:TP=-1.5:LRA=11，再用 pan 显式复制成立体声
        （绝不让 ffmpeg 自己 mono->stereo：实测那个上混要除以根号 2，整轨凭空掉 3 dB）
  配乐  volume=-13dB + 70–13000Hz 带通 + 0.5s 淡入 + 落幕前 2.5s 淡出 + -stream_loop 备长
  闪避  sidechaincompress 以人声为触发（threshold .04 / ratio 6 / attack 25ms / release 450ms）
  相加  amix=normalize=0:weights=1 1 —— 少了 normalize=0 会被减半
  标签名别用 v：ffmpeg 会把它当流说明符，报 "matches no streams"（dsh 实测踩过）

  python3 pipeline/mixdeck.py            -> dubbing/deck_mix.m4a（画面是无声录的，叠这条）
  python3 pipeline/mixdeck.py --voice    -> dubbing/deck_voice.m4a（配乐已在画面里时只要人声）
  python3 pipeline/mixdeck.py --no-duck  -> 不出闪避版，留着 A/B 对比听
"""
import argparse, json, os, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUB = os.path.join(ROOT, "dubbing")
VOX, BGM = os.path.join(DUB, "deck_audio.wav"), os.path.join(ROOT, "assets", "bgm.m4a")
FFMPEG = os.environ.get("FFMPEG") or os.path.join(os.path.dirname(ROOT), "bin", "ffmpeg.exe")
FFPROBE = os.path.join(os.path.dirname(FFMPEG), "ffprobe.exe" if FFMPEG.endswith(".exe") else "ffprobe")
LUFS, TP, LRA, MUS_DB, FIN, FOUT = -16.0, -1.5, 11.0, -13.0, 0.5, 2.5
SC = "threshold=0.04:ratio=6:attack=25:release=450"


def win(p):
    p = str(p).replace("\\", "/")
    if os.name == "nt" or not p.startswith("/mnt/"):
        return p.replace("/", "\\")
    return p[5].upper() + ":" + p[6:].replace("/", "\\")


def chain(total, duck=True):
    voc = "[0:a]loudnorm=I=%d:TP=%.1f:LRA=%d,aresample=48000,pan=stereo|c0=c0|c1=c0[voc]" % (LUFS, TP, LRA)
    mus = ("[1:a]volume=%.0fdB,highpass=f=70,lowpass=f=13000,aresample=48000,"
           "afade=t=in:st=0:d=%.2f,afade=t=out:st=%.2f:d=%.2f[mus]" % (MUS_DB, FIN, total - FOUT, FOUT))
    mix = ("[mus][voc]sidechaincompress=%s[duck];[duck][voc]amix=inputs=2:duration=first:weights=1 1:normalize=0[out]"
           % SC) if duck else "[mus][voc]amix=inputs=2:duration=first:weights=1 1:normalize=0[out]"
    return ";".join([voc, mus, mix])


def run(args):
    r = subprocess.run([FFMPEG, "-y", "-loglevel", "error"] + args, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("ffmpeg 失败：%s" % (r.stderr.strip()[:400] or "无 stderr"))


def measure(p):
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", win(p), "-af", "ebur128=metadata=1", "-f", "null", "-"],
                       capture_output=True, text=True)
    line = [l for l in r.stderr.splitlines() if "I:" in l and "LUFS" in l]
    i = line[-1].split("I:")[1].split("LUFS")[0].strip() + " LUFS" if line else "?"
    d = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of",
                        "csv=p=0", win(p)], capture_output=True, text=True).stdout.strip()
    return i, float(d or 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", action="store_true")
    ap.add_argument("--no-duck", action="store_true")
    a = ap.parse_args()
    total = json.load(open(os.path.join(ROOT, "data", "cues.json"), encoding="utf-8"))["total"]
    if a.voice:
        out = os.path.join(DUB, "deck_voice.m4a")
        voc = "[0:a]loudnorm=I=%d:TP=%.1f:LRA=%d,aresample=48000,pan=stereo|c0=c0|c1=c0[out]" % (LUFS, TP, LRA)
        run(["-i", win(VOX), "-filter_complex", voc, "-map", "[out]", "-c:a", "aac", "-b:a", "192k",
             "-t", "%.2f" % total, win(out)])
        tag = "只有人声（配乐已在画面里时用这条）"
    else:
        out = os.path.join(DUB, "deck_mix%s.m4a" % ("" if not a.no_duck else "-noduck"))
        run(["-i", win(VOX), "-stream_loop", "-1", "-i", win(BGM), "-filter_complex",
             chain(total, not a.no_duck), "-map", "[out]", "-c:a", "aac", "-b:a", "192k",
             "-t", "%.2f" % total, win(out)])
        tag = "配乐 %.0fdB + 带通 + 人声触发闪避" % MUS_DB if not a.no_duck else "配乐 %.0fdB，无闪避" % MUS_DB
    i, d = measure(out)
    print("[mix] %s：%.2fs（cues.total %.2fs）综合响度 %s｜%s" % (os.path.basename(out), d, total, i, tag))
    if abs(d - total) > 0.6:
        print("!! 音轨长度与 cues.total 差 %.2fs，录屏时长要按这条改" % abs(d - total))


if __name__ == "__main__":
    main()
