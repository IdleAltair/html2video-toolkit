# -*- coding: utf-8 -*-
"""一步出成片：OBS 录的无声画面 + 定稿音轨 + 逐句 ASS 字幕 → mp4。

流程照 dsh 在 .arena-preview.py 里跑通的那套复用，只去掉它的「retimed 逐段缩放」那一步 ——
那一步是为了修 CDP 抓屏的帧率漂移，OBS 的 NVENC 输出是恒定帧率，不需要。

  1) pipeline/mksub.py 用 cues 的逐句轴出 ASS（中文 106 句与稿子 1:1，走逐句分支）
  2) 烧字幕  ass=<file>:fontsdir=<字体目录>，编码默认 h264_nvenc，缺 nvenc 退 libx264 crf18
  3) 合流    -map 0:v -map 1:a -c:v copy -c:a aac 192k -movflags +faststart

  python3 pipeline/compose.py --video "E:/.../2026-10-11 15-30-00.mp4"
  python3 pipeline/compose.py --video 无声画面.mp4 --offset 1.2   # OBS 先开录、页面后归零时补这段头
  python3 pipeline/compose.py --video x.mp4 --no-sub              # 只想先看画面+声音

音轨默认 dubbing/deck_mix.m4a（人声 -16 LUFS + 配乐 -13dB 侧链避让）；
若 OBS 已把页面配乐录进画面，换 --audio dubbing/deck_voice.m4a，否则会两遍配乐。
"""
import argparse, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUB = os.path.join(ROOT, "dubbing")
FFMPEG_WSL = "$HOME/mamba/envs/ninfer/bin/ffmpeg"
FFMPEG_WIN = os.path.join(os.path.dirname(ROOT), "bin", "ffmpeg.exe")
FONTDIR = os.path.join(ROOT, "assets")
OUTDIR = os.path.join(ROOT, "out")


def ff():
    """烧字幕必须有 libass；Windows 那个 exe 没验过，优先用 dsh 同款 mamba ffmpeg。"""
    for p in (os.environ.get("FF"), FFMPEG_WSL, FFMPEG_WIN):
        if p and os.path.exists(p) and "ass" in subprocess.run([p, "-hide_banner", "-filters"],
                                                               capture_output=True, text=True).stdout:
            return p
    raise SystemExit("!! 找不到带 libass 的 ffmpeg，烧不了字幕（装一个或 --no-sub）")


def dur(ffmpeg, p):
    probe = os.path.join(os.path.dirname(ffmpeg), "ffprobe.exe" if ffmpeg.endswith(".exe") else "ffprobe")
    if not os.path.exists(probe):
        probe = "ffprobe"
    r = subprocess.run([probe, "-v", "error", "-show_entries", "format=duration", "-of",
                        "csv=p=0", p], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def run(args, label):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("!! %s 失败：%s" % (label, (r.stderr or r.stdout).strip()[-500:]))
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, help="OBS 录出来的无声画面")
    ap.add_argument("--audio", default=os.path.join(DUB, "deck_mix.m4a"))
    ap.add_argument("--out", default=None)
    ap.add_argument("--offset", type=float, default=0.0, help="画面里口播 0 点之前的秒数（音轨整体后移这么多）")
    ap.add_argument("--pages", default=None, help="只出某段页的字幕，如 1-3")
    ap.add_argument("--no-sub", action="store_true")
    ap.add_argument("--enc", default="nvenc", choices=["nvenc", "x264"])
    ap.add_argument("--size", type=int, default=68, help="字幕字号（PlayRes 2560x1440）")
    ap.add_argument("--marginv", type=int, default=20,
                    help="字幕底边距；页面自带 tagline 的几页 tagline 底边在 85%% 处，"
                         "size 68 + marginv 20 时字幕顶边落在 86.8%%，不压上去")
    a = ap.parse_args()
    F = ff()
    video, audio = os.path.abspath(a.video), os.path.abspath(a.audio)
    for p in (video, audio):
        if not os.path.exists(p):
            raise SystemExit("!! 找不到 %s" % p)
    total = json.load(open(os.path.join(ROOT, "data", "cues.json"), encoding="utf-8"))["total"]
    dv, da = dur(F, video), dur(F, audio)
    os.makedirs(OUTDIR, exist_ok=True)
    out = os.path.abspath(a.out or os.path.join(
        OUTDIR, "成片-%s.mp4" % re.sub(r"[^\d]", "", os.path.basename(video).split(".")[0])[:14] or "x"))
    print("[compose] 画面 %.2fs / 音轨 %.2fs（cues.total %.2fs）｜ffmpeg %s" % (dv, da, total, F))
    if abs(dv - (total + a.offset)) > 3.0:
        if dv < total + a.offset:
            print("!! 画面比音轨短 %.2fs：像只录了一段（出局部样片时忽略这条）" % (total + a.offset - dv))
        else:
            print("!! 画面比音轨长 %.2fs：末尾会黑屏。录满 %.0fs 最好，否则把 --offset 设成 %.2f 让音轨整体后移" % (
                dv - total - a.offset, total, dv - total))

    stages = [video]
    if not a.no_sub:
        sub = os.path.join(DUB, "subtitle.zh.ass")
        cmd = [sys.executable, os.path.join(ROOT, "pipeline", "mksub.py"), "-o", sub,
               "--size", str(a.size), "--marginv", str(a.marginv)]
        if a.pages:
            cmd += ["--pages", a.pages]
        r = run(cmd, "mksub")
        print("[compose] 字幕 %s" % r.stdout.strip().splitlines()[-1])
        vf = "ass=%s:fontsdir=%s" % (sub.replace("\\", "/").replace(":", "\\:"), FONTDIR.replace("\\", "/").replace(":", "\\:"))
        venc = (["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19", "-b:v", "0"]
                if a.enc == "nvenc" else ["-c:v", "libx264", "-crf", "18", "-preset", "medium"])
        tmp = os.path.join(DUB, "_compose-subbed.mp4")
        run([F, "-y", "-v", "error", "-i", video, "-vf", vf] + venc +
            ["-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", tmp], "烧字幕")
        stages.append(tmp)
        src_v = tmp
    else:
        src_v = video

    af = ("adelay=%.0f|%.0f" % (a.offset * 1000, a.offset * 1000)) if a.offset > 0 else "anull"
    run([F, "-y", "-v", "error", "-i", src_v, "-i", audio, "-filter_complex", "[1:a]%s[aa]" % af,
         "-map", "0:v:0", "-map", "[aa]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         "-shortest", "-movflags", "+faststart", out], "合流")
    for p in stages[1:]:
        os.remove(p)
    d = dur(F, out)
    print("[compose] 成片 %s｜%.2fs  %.1f MB" % (out, d, os.path.getsize(out) / 1048576))


if __name__ == "__main__":
    main()
