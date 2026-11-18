"""正确拆分三种静音：首(lead)、尾(tail)、句内停顿(inner)，并算真实交界间距。"""
import glob, io, json, os, sys
import numpy as np
import soundfile as sf

SR = 24000
HOP, WIN = int(0.01 * SR), int(0.03 * SR)


def seg(p):
    x, sr = sf.read(p)
    x = x if x.ndim == 1 else x.mean(axis=1)
    fr = np.array([np.sqrt(np.mean(x[s:s + WIN] ** 2)) for s in range(0, max(1, len(x) - WIN), HOP)])
    v = fr > fr.max() * 10 ** (-40 / 20)
    i0, i1 = int(np.argmax(v)), len(v) - int(np.argmax(v[::-1]))
    inner = ((i1 - i0) * HOP - v[i0:i1].sum() * HOP) / SR
    return (i0 * HOP / SR, (len(x) - i1 * HOP) / SR, inner,
            v[i0:i1].sum() * HOP / SR, len(x) / SR)


def rep(tag, d):
    ps = sorted(glob.glob(os.path.join(d, "[0-9][0-9].wav")))
    L, T, I, S = [], [], [], []
    for p in ps:
        a, b, c, s, t = seg(p)
        L.append(a); T.append(b); I.append(c); S.append(s)
    seam = [(T[i] + L[i + 1]) * 1000 for i in range(len(T) - 1)]
    print(f"\n=== {tag} ===")
    print(f"首静音 中位 {np.median(L)*1000:.0f}ms 最大 {max(L)*1000:.0f}ms")
    print(f"尾静音 中位 {np.median(T)*1000:.0f}ms 最大 {max(T)*1000:.0f}ms")
    print(f"句内停顿 中位 {np.median(I)*1000:.0f}ms 最大 {max(I)*1000:.0f}ms")
    print(f"真实交界间距(上句尾+下句首) 中位 {np.median(seam):.0f}ms  P90 {np.percentile(seam,90):.0f}ms  最大 {max(seam):.0f}ms")
    print(f"语音净说话合计 {sum(S):.1f}s = {sum(S)/60:.1f} 分钟")
    return seam


rep("原始 dub-zh", r"$TMP\tts\dub-zh")
rep("最终 dub-zh-final", r"$TMP\tts\dub-zh-final")
