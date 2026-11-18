#!/bin/bash
set -u
V=$HOME/breeze-tts-env/.venv/bin/python
S=$PROJECT_ROOT/breeze-tts-setup
cd "$S" || exit 1
mkdir -p _ctl
# 反向对照：全零 / 白噪 / 纯音，用来确认下面的指标真的能区分坏音频
"$V" - <<'PY'
import numpy as np, soundfile as sf
n = 24000 * 3
sf.write("_ctl/zeros.wav", np.zeros(n, dtype="float32"), 24000)
rng = np.random.default_rng(0)
sf.write("_ctl/white.wav", (rng.standard_normal(n) * 0.05).astype("float32"), 24000)
t = np.arange(n) / 24000
sf.write("_ctl/tone.wav", (0.3 * np.sin(2 * np.pi * 1000 * t)).astype("float32"), 24000)
PY
tr -d '\r' < "$S/check_wav.py" > ~/.cw.py
"$V" ~/.cw.py "$S/../breeze-tts/outputs/smoke_*.wav" "$S/../dubbing/tts_clips/01.wav" "$S/_ctl/*.wav"
rm -rf "$S/_ctl"
