#!/usr/bin/env python3
"""P5R-style jazz-funk BGM generator (original composition, style-ref: Mementos / "Beneath the Mask").
Style: 116 BPM, C major, 60% swing, muted brass stabs, glockenspiel lead, walking bass,
Rhodes chord stabs, air bed, rising whoosh every 8 bars (deck wipe echo). 16-bar seamless loop,
mono 22050 Hz 16-bit (matches the deck's existing music-loop.wav spec)."""
import numpy as np
import wave

SR = 22050
BPM = 116.0
BEAT = 60.0 / BPM          # 0.51724 s
BARS = 16
SWING = 0.6                # off-beat 8th lands at 60% of the half-beat slot
N = int(BARS * 4 * SR * BEAT)
rng = np.random.default_rng(20260729)

def midi_hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def t8(bar, pos):          # bar 0-based, pos 0-7 = 8th grid (swung)
    return (bar * 4 + pos // 2 + (pos % 2) * SWING) * BEAT

def lp1(x, fc, sr=SR):     # one-pole lowpass
    a = np.exp(-2 * np.pi * fc / sr)
    y = np.zeros_like(x)
    for i in range(len(x)):
        y[i] = x[i] + a * (y[i - 1] - x[i]) if i else x[i]
    return y

def resonate(x, freq, q):
    """2nd-order IIR resonator, poles at r*exp(+/-jw) — stable for r < 1."""
    w = 2 * np.pi * freq / SR
    r = np.exp(-1 / (q * w))
    y = np.zeros_like(x)
    c = 2 * r * np.cos(w)
    for i in range(len(x)):
        if i == 0: y[i] = x[i]
        elif i == 1: y[i] = x[i] + c * y[i-1]
        else: y[i] = x[i] + c * y[i-1] - r * r * y[i-2]
    return y / (1 - r)

def kick():
    n = int(0.16 * SR); t = np.arange(n) / SR
    f = 38 + 14 * np.exp(-t / 0.03)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t / 0.065)
    s += rng.standard_normal(n) * np.exp(-t / 0.004) * 0.12   # beater click
    return s

def snare():
    n = int(0.13 * SR); t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 196 * t) * np.exp(-t / 0.045) * 0.55
    nz = rng.standard_normal(n)
    noise = (resonate(nz, 1800, 2.5) + 0.5 * resonate(nz, 4200, 3)) * np.exp(-t / 0.04)
    return body + noise * 0.8

def hat(open_):
    dur = 0.22 if open_ else 0.03
    n = int(dur * SR); t = np.arange(n) / SR
    nz = rng.standard_normal(n)
    x = nz - np.convolve(nz, np.ones(6) / 6, "same")        # crude HP
    x = x - np.convolve(x, np.ones(3) / 3, "same")
    return x * np.exp(-t / (0.09 if open_ else 0.012)) * (0.5 if open_ else 1)

def bass_note(m, dur=0.26):
    n = int(dur * SR); t = np.arange(n) / SR
    f = midi_hz(m)
    s = (np.sin(2*np.pi*f*t) + 0.32*np.sin(2*np.pi*2*f*t) + 0.09*np.sin(2*np.pi*3*f*t))
    s *= (1 - np.exp(-t / 0.006)) * np.exp(-t / 0.13)
    return lp1(s, 850)

def rhodes(midis, dur=0.45):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    for m in midis:
        f = midi_hz(m)
        s += (np.sin(2*np.pi*f*t) + 0.42*np.sin(2*np.pi*2*f*t) + 0.16*np.sin(2*np.pi*3*f*t)
              + 0.06*np.sin(2*np.pi*4.02*f*t))
    s *= (1 - np.exp(-t / 0.005)) * np.exp(-t / 0.18)
    d = int(0.012 * SR)                                     # pseudo-double (chorus)
    s = s + np.concatenate([np.zeros(d), s[:len(s)-d]]) * 0.3
    return lp1(s, 4200)

def brass(midis, dur=0.28):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    vib = 0.25 * np.sin(2 * np.pi * 5.5 * t) * (t / dur)    # late vibrato
    for m in midis:
        f = midi_hz(m)
        for k, a in [(1, 1.0), (1.5, .5), (2, .38), (2.5, .25), (3, .15), (4, .08)]:
            s += a * np.sin(2 * np.pi * f * k * t + vib * k * 0.4)
    s *= (1 - np.exp(-t / 0.01)) * np.exp(-t / 0.09)
    return lp1(s, 1500)

def bell(m, dur=2.0):
    n = int(dur * SR); t = np.arange(n) / SR
    f = midi_hz(m)
    s = (np.sin(2*np.pi*f*t) + 0.45*np.sin(2*np.pi*f*5.43*t)
         + 0.18*np.sin(2*np.pi*f*16.87*t) + 0.12*np.sin(2*np.pi*2*f*t))
    s *= (1 - np.exp(-t / 0.002)) * np.exp(-t / 0.5)
    return s

def whoosh(dur=0.6):
    n = int(dur * SR); t = np.arange(n) / SR
    nz = rng.standard_normal(n)
    lo = resonate(nz, 280, 1.1); hi = resonate(nz, 2600, 1.6)
    env = np.sin(np.pi * t / dur) ** 1.4
    return (lo * (1 - t/dur) + hi * (t/dur)) * env

buses = {}
def put(buf, start_s, sig, gain, name=None):
    i = int(start_s * SR)
    if i < 0: return
    j = min(len(buf), i + len(sig))
    if j > i:
        buf[i:j] += sig[: j - i] * gain
        if name:
            b = buses.setdefault(name, np.zeros(N))
            b[i:j] += sig[: j - i] * gain

# ---- arrangement -------------------------------------------------------------
CH = {  # bar(1-based): (rhodes chord midis, bass line [(pos, midi)], brass figure [(pos, [midis])],
      }
RHO = {
 1: [60,64,67,71], 2: [57,60,64,67], 3: [62,65,69,72], 4: [55,59,62,65],
 5: [60,64,67,71], 6: [52,55,59,62], 7: [57,60,64,67], 8: [55,59,65,69,72],
 9: [60,64,67,71], 10: [57,61,64,67], 11: [62,65,69,72], 12: [55,59,65,69,72],
 13: [53,57,60,64], 14: [55,58,62,65], 15: [52,55,59,62], 16: [62,65,69,72],
}
BASS = {  # pos: midi ; swung positions handled by t8
 1: {0:36,2:43,3:35,4:36,6:43,7:35}, 2: {0:45,2:52,3:44,4:45,6:52,7:44},
 3: {0:38,2:45,3:37,4:38,6:45,7:37}, 4: {0:43,2:50,3:46,4:43,6:50,7:42},
 5: {0:36,2:43,3:35,4:36,6:43},      6: {0:40,2:47,3:39,4:40,6:47,7:44},
 7: {0:45,2:52,3:44,4:45,6:52,7:49}, 8: {0:43,2:50,3:46,4:43,6:50,7:35},
 9: {0:36,2:43,3:35,4:36,6:43,7:35}, 10:{0:45,2:52,3:49,4:45,6:52,7:44},
 11:{0:38,2:45,3:37,4:38,6:45,7:37}, 12:{0:43,2:50,3:46,4:43,6:50,7:35},
 13:{0:41,2:48,3:40,4:41,6:48,7:42}, 14:{0:43,2:50,3:46,4:43,6:50,7:46},
 15:{0:40,2:47,3:39,4:40,6:47,7:37}, 16:{0:38,2:45,4:43,6:50},   # sparse: breath into the loop
}
# bell lead (pos: midi) -- original Mementos-flavored line, C major
BELLS = {
 1: {0:76,1:72,2:74,4:79,5:76,6:74},
 2: {0:72,2:76,4:74,6:72},
 3: {0:74,2:67,4:72,6:74},
 4: {0:76,2:74,4:72},
 5: {0:72,1:74,2:76,4:79,5:77,6:76},
 6: {4:74,6:76},
 7: {0:79,2:76,4:77,5:76,6:74},
 8: {0:72,4:74},
 9: {0:76,1:72,2:74,4:79,5:76,6:74},
 10:{0:76,2:73,4:76,6:79},
 11:{0:74,2:77,4:74},
 12:{0:79,4:76},
 13:{0:77,2:72,4:81,6:77},
 14:{0:74,4:70,6:74},
 15:{0:76,2:79,4:76},
 16:{},                                  # breath before the loop point
}
KICK_POS = {0: .95, 5: .8}                 # beat1 + "&3"
SNARE_POS = {2: 1.0, 6: 1.0}
OPEN_HAT_BARS = {4, 8, 12}
BRASS_FIG = {  # phrase-end "shing!" figures
 4: [(6, [55, 62]), (7, [59, 65])],
 8: [(6, [55, 65]), (7, [59, 69])],
 12: [(6, [55, 62]), (7, [59, 69])],
 16: [(6, [59, 62])],
 10: [(0, [45])],                          # low A hit under the backdoor A7
 14: [(4, [58, 62])],                      # mysterious Bb-D stab over Gm7
}

buf = np.zeros(N)
air = (resonate(rng.standard_normal(N), 6500, 1.2))
air *= 0.018 * (1 + 0.4 * np.sin(2 * np.pi * (SR * BEAT * 2) * np.arange(N) / SR * (2/ (SR*BEAT*2))))  # subtle 2-beat pulse
buf += air * 0.06

for b in range(1, BARS + 1):
    bar = b - 1
    for p, v in KICK_POS.items():
        put(buf, t8(bar, p), kick() , 1.2 * v, name="kick")
    for p, v in SNARE_POS.items():
        put(buf, t8(bar, p), snare(), 0.3 * v, name="snare")
    if b in (9, 10, 11, 12):                       # ghost snare in S3
        put(buf, t8(bar, 3), snare() * 0.25, 0.3, name="snare")
    for p in range(8):                             # swung 8th hats
        put(buf, t8(bar, p), hat(False), 0.34 * (0.85 if p % 2 == 0 else 0.55), name="hat")
    if b in OPEN_HAT_BARS:
        put(buf, t8(bar, 7), hat(True), 0.3, name="hat")
    for p, m in BASS[b].items():
        put(buf, t8(bar, p), bass_note(m), 0.78, name="bass")
    if b < 16:
        put(buf, t8(bar, 7), rhodes(RHO[b]), 0.34, name="rhodes")  # signature "&4" stab (skipped at the seam)
    if b >= 9 and b < 16:
        put(buf, t8(bar, 3), rhodes(RHO[b]), 0.25, name="rhodes")  # syncopated stab in S2+
    if b == 16:
        put(buf, t8(bar, 4), rhodes([60, 64, 67, 71]), 0.34, name="rhodes")  # resolve to C at the loop point
    for p, mids in BRASS_FIG.get(b, []):
        put(buf, t8(bar, p), brass(mids), 0.62, name="brass")
    for p, m in BELLS[b].items():
        put(buf, t8(bar, p), bell(m), 0.5, name="bell")
        put(buf, t8(bar, p) + 0.016, bell(m), 0.14, name="bell")  # fresh echo

put(buf, 0.02, whoosh(), 0.3, name="whoosh")          # whoosh every 8 bars
put(buf, 8 * 4 * BEAT + 0.02, whoosh(), 0.3, name="whoosh")

# ---- master -------------------------------------------------------------------
x = np.tanh(1.15 * buf)
x = x - x.mean()                                         # kill DC
fd = int(0.04 * SR)
fade = np.linspace(1, 0, fd)
x[-fd:] *= fade                                          # guarantee a clean loop seam
peak = np.max(np.abs(x))
x = x / peak * 0.707                                 # -3 dBFS
pcm = np.clip(x * 32767, -32768, 32767).astype(np.int16)
out = "$HOME/deepseek-harness/workplace/music-loop-p5.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", out, N, "samples =", round(N / SR, 3), "s  peak", round(float(peak), 3),
      " rms", round(float(np.sqrt(np.mean(x**2))), 4), " dc", round(float(x.mean()), 5))
for k, v in sorted(buses.items(), key=lambda kv: -float(np.sqrt(np.mean(kv[1] ** 2)))):
    print(f"  bus {k:7s} rms {float(np.sqrt(np.mean(v**2))):.4f}  peak {float(np.max(np.abs(v))):.3f}")
print("tail max|.|", round(float(np.max(np.abs(pcm[-600:] / 32768))), 5),
      " head max|.|", round(float(np.max(np.abs(pcm[:200] / 32768))), 4))
