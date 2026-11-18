"""能不能自动挑出用户喜欢的那一版？
候选判据：① 与参考的音色 embedding 余弦  ② 句内停顿结构  ③ 语速(音节/秒)
用户实测偏好：04 四版里 seed7 最好，42/2024/888 差；且 01(=seed42) 是全场最好。
"""
import os, re, sys
import numpy as np
import soundfile as sf
import torch, torchaudio

sys.path.insert(0, r"$DESKTOP\screenshot\llm-html2video\index-tts")
from indextts.s2mel.modules.campplus.DTDNN import CAMPPlus

CKPT = r"$DESKTOP\screenshot\llm-html2video\IndexTTS-2.5\hf_cache\campplus_cn_common.bin"
REF = r"$TMP\tts\vocal\ref_t06_from0.6s.wav"
SR = 16000

net = CAMPPlus(feat_dim=80, embedding_size=192)
net.load_state_dict(torch.load(CKPT, map_location="cpu"))
net.eval()


def load16(p):
    x, sr = sf.read(p, always_2d=True)
    t = torch.from_numpy(x.mean(axis=1).astype("float32")).unsqueeze(0)
    if sr != SR:
        t = torchaudio.transforms.Resample(sr, SR)(t)
    return t.squeeze(0).numpy()


def emb(p):
    x = load16(p)
    f = torchaudio.compliance.kaldi.fbank(torch.from_numpy(x).unsqueeze(0), num_mel_bins=80,
                                          dither=0, sample_frequency=SR)
    f = f - f.mean(0, keepdim=True)
    with torch.no_grad():
        e = net(f.unsqueeze(0))
    if isinstance(e, tuple):
        e = e[0]
    return e.squeeze(0).numpy()


def pauses(x):
    """句内停顿：20ms 帧、比峰值低 35dB 以下算静默，返回(次数, 总时长, 占比)"""
    h, w = int(0.02 * SR), int(0.05 * SR)
    fr = np.array([np.sqrt(np.mean(x[s:s + w] ** 2)) for s in range(0, max(1, len(x) - w), h)])
    fr = fr[fr > 0]
    if not len(fr):
        return 0, 0.0, 0.0
    thr = fr.max() * 10 ** (-35 / 20)
    sil = fr < thr
    runs, i = 0, 0
    while i < len(sil):
        if sil[i]:
            j = i
            while j < len(sil) and sil[j]:
                j += 1
            if (j - i) * h / SR > 0.12:      # 只数成段的停顿，不数词间微顿
                runs += 1
            i = j
        else:
            i += 1
    return runs, sil.sum() * h / SR, sil.mean()


def syl(s):
    s = re.sub(r"[，。、：；！？,.\s]", "", s)
    d = re.findall(r"[0-9]+", s)
    return len(re.sub(r"[0-9]", "", s)) + sum(len(x) for x in d) + 2 * sum(len(x) - 1 for x in d)


TXT = {
    "01": "想必大家都看过AI算法对抗大赛了",
    "02": "我们额外请来的是一个只有270亿参数的小模型Qwen3.8-27B",
    "03": "三场各有一个基准bot正式赛里它站在零分线上所以赢基准只等于刚过线",
    "04": "正赛跑完我看成绩太拉每场再给四十分钟打加时因为27b一次自我对弈都没做过所以加时赛提示它自己打自己看看能否得到更好成绩",
}
CASES = [("04 seed42", r"$TMP\tts\breeze-laoda2\04.wav", "04", "差"),
         ("04 seed7", r"$TMP\tts\breeze-exp\04_s7.wav", "04", "好"),
         ("04 seed2024", r"$TMP\tts\breeze-exp\04_s2024.wav", "04", "差"),
         ("04 seed888", r"$TMP\tts\breeze-exp\04_s888.wav", "04", "差"),
         ("01 seed42", r"$TMP\tts\breeze-laoda2\01.wav", "01", "最好"),
         ("02 seed42", r"$TMP\tts\breeze-laoda2\02.wav", "02", "差"),
         ("02 seed7", r"$TMP\tts\breeze-exp\02_s7.wav", "02", "?"),
         ("02 seed2024", r"$TMP\tts\breeze-exp\02_s2024.wav", "02", "?"),
         ("03 seed42", r"$TMP\tts\breeze-laoda2\03.wav", "03", "差")]

er = emb(REF)
xr = load16(REF)
pr, ptr, pfr = pauses(xr)
print(f"参考音频: 自身时长 {len(xr)/SR:.1f}s  音色自匹配 1.000  停顿 {pr} 次 / {pfr*100:.0f}%")
print(f"\n{'版本':>13} {'你判':>5} {'音色相似':>9} {'语速':>6} {'停顿次':>6} {'静默%':>6} {'峰值':>6}")
for name, path, key, verdict in CASES:
    if not os.path.exists(path):
        print(f"{name:>13} 缺文件"); continue
    x = load16(path)
    e = emb(path)
    cos = float(e @ er / (np.linalg.norm(e) * np.linalg.norm(er)))
    rate = syl(TXT[key]) / (len(x) / SR)
    runs, pt, pf = pauses(x)
    print(f"{name:>13} {verdict:>5} {cos:9.3f} {rate:6.2f} {runs:6d} {pf*100:6.0f} {np.max(np.abs(x)):6.3f}")
