import numpy as np, soundfile as sf, os

SR = 24000
IDX = "$TMP/tts/laoda-zh2"
BRZ = "$TMP/tts/breeze-laoda"
OUT = "$TMP/tts/ab-index-vs-breeze.wav"
gap = np.zeros(int(SR * 0.35))
mark = np.zeros(int(SR * 0.7))


def load(p):
    x, sr = sf.read(p)
    x = x if x.ndim == 1 else x.mean(axis=1)
    if sr != SR:
        n = int(len(x) * SR / sr)
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    return x.astype(np.float64)


buf = []
for i in ("01", "02", "03", "04"):
    a = load(os.path.join(IDX, f"{i}.wav"))
    b = load(os.path.join(BRZ, f"{i}.wav"))
    buf += [a, gap, b, mark]
mix = np.concatenate(buf)
mix = mix / max(1e-9, np.max(np.abs(mix))) * 0.9
sf.write(OUT, mix.astype(np.float32), SR, subtype="PCM_16")
print(OUT, round(len(mix) / SR, 1), "s  每句顺序: IndexTTS -> 0.35s -> Breeze -> 0.7s")
