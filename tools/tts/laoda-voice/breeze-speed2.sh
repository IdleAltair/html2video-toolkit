#!/usr/bin/env bash
# 用 instruction 措辞扫语速梯度，为"按听感定档"准备样音
REF=$TMP/tts/vocal/ref_t06_from0.6s.wav
REFT=$(cat $TMP/tts/ref_text.txt)
OUT=$TMP/tts/breeze-speed
PY=$HOME/breeze-tts-env/.venv/bin/python
NCH=59
TXT="正赛跑完我看成绩太拉，每场再给四十分钟打加时，因为27b一次自我对弈都没做过，所以加时赛提示它自己打自己，看看能否得到更好成绩。"

one() {  # one <标签> <instruction>
  local tag=$1 ins=$2 t0 sz dt
  t0=$(date +%s)
  curl -s --noproxy '*' -m 300 -X POST http://127.0.0.1:7861/v1/audio/speech \
    -F "ref_audio=@$REF" -F "ref_text=$REFT" -F "text=$TXT" \
    -F "cfg_scale=4" -F "seed=7" -F "instruction=$ins" -o "$OUT/$tag.pcm"
  sz=$(stat -c%s "$OUT/$tag.pcm")
  if [ "$sz" -lt 2000 ]; then echo "[$tag] 错误 bytes=$sz: $(head -c 60 "$OUT/$tag.pcm")"; return; fi
  dt=$(( $(date +%s) - t0 ))
  "$PY" -c "
import numpy as np, soundfile as sf
x = np.fromfile('$OUT/$tag.pcm', dtype='<i2').astype('float32')/32768
sf.write('$OUT/$tag.wav', x, 24000, subtype='PCM_16')
d = len(x)/24000
print('[$tag] %6.2fs  ${dt}s  %4.2f 字/秒  peak=%.3f' % (d, $NCH/d, float(np.max(np.abs(x)))))"
}

one e1 "语速偏慢，沉稳清楚。"
one e2 "语速缓慢，像纪录片旁白，一句一句说清楚。"
one e3 "很慢地念，字与字之间拉开一点距离。"
one e4 "非常缓慢地念，像慢速新闻播报。"
one e5 "极慢地逐字念，每个字都拖长，句间长时间停顿。"
