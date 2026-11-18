#!/usr/bin/env bash
# Direction 模式能不能降语速？同一句 61 字，四种指令强度，量字/秒
REF=$TMP/tts/vocal/ref_t06_from0.6s.wav
REFT=$(cat $TMP/tts/ref_text.txt)
OUT=$TMP/tts/breeze-speed
PY=$HOME/breeze-tts-env/.venv/bin/python
mkdir -p "$OUT"
TXT="正赛跑完我看成绩太拉，每场再给四十分钟打加时，因为27b一次自我对弈都没做过，所以加时赛提示它自己打自己，看看能否得到更好成绩。"
NCH=59   # 去掉标点后的汉字+字母串数（脚本外再核）

one() {  # one <标签> <cfg> <instruction 或 "-">
  local tag=$1 cfg=$2 ins=$3 t0 sz dt extra
  t0=$(date +%s)
  if [ "$ins" = "-" ]; then
    extra=()
  else
    extra=(-F "instruction=$ins")
  fi
  curl -s --noproxy '*' -m 300 -X POST http://127.0.0.1:7861/v1/audio/speech \
    -F "ref_audio=@$REF" -F "ref_text=$REFT" -F "text=$TXT" \
    -F "cfg_scale=$cfg" -F "seed=7" "${extra[@]}" -o "$OUT/$tag.pcm"
  sz=$(stat -c%s "$OUT/$tag.pcm")
  if [ "$sz" -lt 2000 ]; then echo "[$tag] 错误 bytes=$sz"; head -c 200 "$OUT/$tag.pcm"; echo; return; fi
  dt=$(( $(date +%s) - t0 ))
  "$PY" -c "
import numpy as np, soundfile as sf
x = np.fromfile('$OUT/$tag.pcm', dtype='<i2').astype('float32')/32768
sf.write('$OUT/$tag.wav', x, 24000, subtype='PCM_16')
d = len(x)/24000
print('[$tag] cfg=$cfg %5.2fs  ${dt}s  %4.2f 字/秒  peak=%.3f' % (d, $NCH/d, float(np.max(np.abs(x)))))"
  echo "        ins=${ins:0:38}"
}

echo "基线（纯 Clone，无 instruction）"
one base 4 "-"
echo "Direction：语速缓慢"
one slow 4 "语速缓慢从容，吐字清晰，不赶时间。"
echo "Direction：非常缓慢 + cfg 加大"
one veryslow 8 "非常缓慢地念，每个词之间都留有呼吸，像慢速新闻播报。"
echo "Direction：中等（目标 4.5 字/秒）"
one mid 4 "语速平缓自然，节奏从容。"
