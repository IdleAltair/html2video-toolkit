#!/usr/bin/env bash
# 补齐 seed=7 的那一句（03），然后把四句 seed7 拼成一条试听轨
REF=$TMP/tts/vocal/ref_t06_from0.6s.wav
REFT=$(cat $TMP/tts/ref_text.txt)
OUT=$TMP/tts/breeze-exp
PY=$HOME/breeze-tts-env/.venv/bin/python
TXT="三场各有一个基准 bot，正式赛里它站在零分线上，所以赢基准只等于刚过线。"

t0=$(date +%s)
curl -s --noproxy '*' -m 300 -X POST http://127.0.0.1:7861/v1/audio/speech \
  -F "ref_audio=@$REF" -F "ref_text=$REFT" -F "text=$TXT" -F "seed=7" -o "$OUT/03_s7.pcm"
sz=$(stat -c%s "$OUT/03_s7.pcm")
if [ "$sz" -lt 2000 ]; then echo "错误响应 bytes=$sz"; head -c 200 "$OUT/03_s7.pcm"; echo; exit 1; fi
"$PY" -c "
import numpy as np, soundfile as sf
x = np.fromfile('$OUT/03_s7.pcm', dtype='<i2').astype('float32')/32768
sf.write('$OUT/03_s7.wav', x, 24000, subtype='PCM_16')
print('[03_s7] %5.2fs  $(( $(date +%s) - t0 ))s bytes=$sz peak=%.3f' % (len(x)/24000, float(np.max(np.abs(x)))))"

"$PY" -c "
import numpy as np, soundfile as sf
SR=24000; gap=np.zeros(int(SR*0.35)); buf=[]
for n in ('01_s7','02_s7','03_s7','04_s7'):
    p='$OUT/%s.wav'%n
    x,sr=sf.read(p); x=x if x.ndim==1 else x.mean(axis=1)
    x=x/max(1e-9,np.max(np.abs(x)))*0.85
    buf.append(x.astype(np.float64)); buf.append(gap)
mix=np.concatenate(buf)
sf.write('$OUT/preview_s7_all.wav', mix.astype(np.float32), SR, subtype='PCM_16')
print('preview_s7_all', round(len(mix)/SR,1),'s  四句全 seed=7，已响度对齐')"
