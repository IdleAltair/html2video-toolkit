#!/usr/bin/env bash
# Breeze Clone：ref_audio + ref_text 逐句合成 4 句中文，裸 PCM 包成 24k wav
REF=${1:-$TMP/tts/vocal/ref_t06_from0.6s.wav}
REFT=$(cat $TMP/tts/ref_text.txt)
SRC=$TMP/tts/subtitle_lines.txt
OUT=${2:-$TMP/tts/breeze-laoda}
PY=$HOME/breeze-tts-env/.venv/bin/python
mkdir -p "$OUT"
echo "ref_text: $REFT"
i=0
while IFS= read -r line; do
  txt=$(printf '%s' "$line" | sed -E 's/^[0-9]+min[0-9]+s +//; s/^[0-9]+s +//')
  [ -z "$txt" ] && continue
  i=$((i + 1))
  n=$(printf '%02d' "$i")
  t0=$(date +%s)
  curl -s --noproxy '*' -m 300 -X POST http://127.0.0.1:7861/v1/audio/speech \
    -F "ref_audio=@$REF" -F "ref_text=$REFT" -F "text=$txt" -F "seed=42" \
    -o "$OUT/$n.pcm"
  sz=$(stat -c%s "$OUT/$n.pcm")
  if [ "$sz" -lt 2000 ]; then
    echo "[$n] 疑似错误响应 bytes=$sz:"
    head -c 300 "$OUT/$n.pcm"; echo
    continue
  fi
  dt=$(( $(date +%s) - t0 ))
  "$PY" -c "
import numpy as np, soundfile as sf
x = np.fromfile('$OUT/$n.pcm', dtype='<i2').astype('float32')/32768
sf.write('$OUT/$n.wav', x, 24000, subtype='PCM_16')
print('[$n] %5.2fs audio  ${dt}s wall  bytes=$sz  peak=%.3f' % (len(x)/24000, float(np.max(np.abs(x)))))"
  echo "     $txt"
done < "$SRC"
echo "--- out ---"
ls -la "$OUT" | tail -6
