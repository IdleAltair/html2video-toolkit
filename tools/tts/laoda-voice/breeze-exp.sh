#!/usr/bin/env bash
# 实验：同一句换 seed、以及把长句拆短，看能不能靠近 01.wav 的听感
REF=$TMP/tts/vocal/ref_t06_from0.6s.wav
REFT=$(cat $TMP/tts/ref_text.txt)
OUT=$TMP/tts/breeze-exp
PY=$HOME/breeze-tts-env/.venv/bin/python
mkdir -p "$OUT"

one() {  # one <标签> <seed> <文本>
  local tag=$1 seed=$2 txt=$3 t0 n sz dt
  t0=$(date +%s)
  curl -s --noproxy '*' -m 300 -X POST http://127.0.0.1:7861/v1/audio/speech \
    -F "ref_audio=@$REF" -F "ref_text=$REFT" -F "text=$txt" -F "seed=$seed" \
    -o "$OUT/$tag.pcm"
  sz=$(stat -c%s "$OUT/$tag.pcm")
  if [ "$sz" -lt 2000 ]; then echo "[$tag] 错误响应 bytes=$sz"; head -c 200 "$OUT/$tag.pcm"; echo; return; fi
  dt=$(( $(date +%s) - t0 ))
  "$PY" -c "
import numpy as np, soundfile as sf
x = np.fromfile('$OUT/$tag.pcm', dtype='<i2').astype('float32')/32768
sf.write('$OUT/$tag.wav', x, 24000, subtype='PCM_16')
print('[$tag] seed=$seed %5.2fs ${dt}s bytes=$sz peak=%.3f' % (len(x)/24000, float(np.max(np.abs(x)))))"
  echo "        $txt"
}

S4A="正赛跑完我看成绩太拉，每场再给四十分钟打加时。"
S4B="因为27b一次自我对弈都没做过，"
S4C="所以加时赛提示它自己打自己，看看能否得到更好成绩。"
L04="正赛跑完我看成绩太拉，每场再给四十分钟打加时，因为27b一次自我对弈都没做过，所以加时赛提示它自己打自己，看看能否得到更好成绩。"
L02="我们额外请来的是一个只有 270 亿参数的小模型，Qwen3.8-27B。"
L01="想必大家都看过 AI 算法对抗大赛了。"

echo "--- A. 长句 04 换 seed（对照已用的 42）---"
one 04_s7 7 "$L04"
one 04_s2024 2024 "$L04"
one 04_s888 888 "$L04"
echo "--- B. 04 拆成三短句（seed 42）---"
one 04a 42 "$S4A"
one 04b 42 "$S4B"
one 04c 42 "$S4C"
echo "--- C. 02 换 seed ---"
one 02_s7 7 "$L02"
one 02_s2024 2024 "$L02"
echo "--- D. 01 换 seed（看它是不是本来就稳）---"
one 01_s7 7 "$L01"
ls -la "$OUT" | tail -12
