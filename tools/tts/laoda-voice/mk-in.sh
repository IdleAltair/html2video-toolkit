#!/usr/bin/env bash
# 从整轨裁出"区间 ±3s 上下文"作为分离输入（-t 是时长，不是终点）
set -e
FF=$HOME/mamba/envs/ninfer/bin/ffmpeg
OUT=$TMP/tts
PAD=3
mkdir -p "$OUT/in"

SEG=(
  "01 26 32" "02 118 130" "03 271 282" "04 324 332"
  "05 400 414" "06 495 518" "07 563 579" "08 638 651"
  "09 758 774" "10 844 855" "11 908 920" "12 1039 1049"
)
tot=0
for L in "${SEG[@]}"; do
  set -- $L
  id=$1; s=$2; e=$3
  ss=$(( s - PAD ))
  len=$(( e - s + 2 * PAD ))
  "$FF" -v error -y -ss "$ss" -i "$OUT/full.wav" -t "$len" -c:a pcm_s16le "$OUT/in/t${id}.wav"
  info=$(python3 -c "
import wave,contextlib
with contextlib.closing(wave.open('$OUT/in/t${id}.wav')) as w:
    print(round(w.getnframes()/w.getframerate(),2), w.getframerate(), w.getnchannels())")
  tot=$(( tot + len ))
  printf "t%s  in %4ds..%-4ds len %2ds   -> %s\n" "$id" "$ss" "$(( ss + len ))" "$len" "$info"
done
echo "总输入时长 ${tot}s（含每段前后 ${PAD}s 上下文）"
