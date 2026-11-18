#!/usr/bin/env bash
# 离线兜底对照：下混成单声道（丢弃 side 分量 = 立体声 BGM 能量衰减），不依赖任何模型
set -e
FF=$HOME/mamba/envs/ninfer/bin/ffmpeg
OUT=$TMP/tts
mkdir -p "$OUT/center"

SEG=(
  "01 26 32" "02 118 130" "03 271 282" "04 324 332"
  "05 400 414" "06 495 518" "07 563 579" "08 638 651"
  "09 758 774" "10 844 855" "11 908 920" "12 1039 1049"
)
for L in "${SEG[@]}"; do
  set -- $L
  id=$1; s=$2; e=$3
  "$FF" -v error -y -ss "$s" -i "$OUT/full.wav" -t $(( e - s )) \
    -af "pan=mono|c0=0.5*c0+0.5*c1" -c:a pcm_s16le -ar 48000 "$OUT/center/t${id}.wav"
done
ls "$OUT/center" | tr '\n' ' '; echo
