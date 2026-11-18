"""用牢大百科分离出的人声当参考，跑 arena-video 口播稿里的几句中文。
模型加载参数照抄 llm-html2video/IndexTTS-2.5/scripts/dub_video.py，
文本直接从 dubbing/字幕.txt 按时间戳取原句，不手抄。
"""
import sys, io, os, re
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import numpy as np
import torch, torchaudio, soundfile as sf


def save_wav_patch(path, wav, sr):
    """同 dub_video.py：torchaudio.save 在 Windows 缺 ffmpeg DLL 会崩，改用 soundfile"""
    data = wav.squeeze(0).numpy() if wav.dim() == 2 else wav.numpy()
    if data.ndim == 2 and data.shape[0] < data.shape[1]:
        data = data.T
    sf.write(path, data, sr, subtype="PCM_16")


torchaudio.save = save_wav_patch

from indextts.infer_v2_5 import IndexTTS2

MODEL_DIR = r"$DESKTOP\screenshot\llm-html2video\IndexTTS-2.5"
SUB_FILE = r"$WORKSPACE\arena-video\dubbing\字幕.txt"
REF = sys.argv[1] if len(sys.argv) > 1 else r"$TMP\tts\vocal\vocal_t06_08m15-08m38.wav"
OUT = sys.argv[2] if len(sys.argv) > 2 else r"$TMP\tts\laoda-zh"
DEVICE = "cuda:1"
SPEED = 1.0
WANT_T = [0, 24, 162, 172]   # 字幕.txt 里的时间戳（秒）：开场 2 句 + 夺旗规则 2 句

SUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "subtitle_lines.txt")


def parse_sub(fn):
    items = []
    with open(fn, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            m = re.match(r"^(\d+)min(\d+)s\s+(\S.*)$", line)
            if m:
                items.append((int(m.group(1)) * 60 + int(m.group(2)), m.group(3)))
                continue
            m = re.match(r"^(\d+)s\s+(\S.*)$", line)
            if m:
                items.append((int(m.group(1)), m.group(2)))
    return items


lines = parse_sub(SUB_FILE)
by_t = {t: txt for t, txt in lines}
picked = [(t, by_t[t]) for t in WANT_T if t in by_t]
missing = [t for t in WANT_T if t not in by_t]
if missing:
    raise SystemExit(f"字幕.txt 里找不到这些时间戳: {missing}")

print(f"参考音频: {REF}")
x, sr = sf.read(REF)
print(f"  {len(x)/sr:.2f}s  {sr}Hz  {'立体声' if x.ndim>1 else '单声道'}  peak {np.max(np.abs(x)):.3f}")
print(f"选中 {len(picked)} 句：")
for t, txt in picked:
    print(f"  [{t:4d}s] {txt}")

os.makedirs(OUT, exist_ok=True)
with open(SUB, "w", encoding="utf-8") as f:
    for t, txt in picked:
        f.write(f"{t}s {txt}\n")

tts = IndexTTS2(
    cfg_path=os.path.join(MODEL_DIR, "config.yaml"),
    model_dir=MODEL_DIR,
    use_bf16=True,
    use_cuda_kernel=False,
    use_torch_compile=False,
    use_qwen_emo=False,
    device=DEVICE,
)

for i, (t0, text) in enumerate(picked, 1):
    out = os.path.join(OUT, f"{i:02d}.wav")
    if os.path.exists(out):
        w, s2 = sf.read(out)
        print(f"[{i:02d}] SKIP 已存在 {len(w)/s2:5.2f}s  {text[:24]}")
        continue
    tts.infer(
        spk_audio_prompt=REF,
        text=text,
        lang="ZH",
        output_path=out,
        verbose=False,
        duration_factor=SPEED,
        interval_silence=400,
    )
    w, s2 = sf.read(out)
    print(f"[{i:02d}] {len(w)/s2:5.2f}s  {s2}Hz  源 t={t0}s  {text[:24]}")

# 顺带拼一条试听轨
SR2 = 22050
gap = np.zeros(int(SR2 * 0.5), dtype=np.float64)
buf = []
for i in range(1, len(picked) + 1):
    w, s2 = sf.read(os.path.join(OUT, f"{i:02d}.wav"))
    w = w if w.ndim == 1 else w.mean(axis=1)
    if s2 != SR2:
        n = int(len(w) * SR2 / s2)
        w = np.interp(np.linspace(0, len(w) - 1, n), np.arange(len(w)), w)
    buf.append(w.astype(np.float64))
    buf.append(gap)
mix = np.concatenate(buf)
mix = mix / max(1e-9, np.max(np.abs(mix))) * 0.9
prev = os.path.join(OUT, "preview_all.wav")
sf.write(prev, mix.astype(np.float32), SR2, subtype="PCM_16")
print(f"preview -> {prev}  {len(mix)/SR2:.1f}s")
