#!/usr/bin/env bash
# 抽整轨 + 按用户给的 12 个区间切片（48k / stereo / pcm_s16le）
set -e
FF=$HOME/mamba/envs/ninfer/bin/ffmpeg
SRC="$WORKSPACE/谁最会说人话？我抓了6个AI挑战地狱级测试！【牢大百科10】.mp4"
OUT=$TMP/tts
mkdir -p "$OUT/raw"

# 整轨一份：后续按区间裁，切片边界不会有分离模型的起始瞬态
if [ ! -f "$OUT/full.wav" ]; then
  "$FF" -v error -y -i "$SRC" -vn -c:a pcm_s16le -ar 48000 -ac 2 "$OUT/full.wav"
fi
echo "full.wav:"
ls -la "$OUT/full.wav"

# 区间表：编号 起点秒 终点秒（源自 mm:ss，注释保留原写法）
SEG=(
  "01 26 32      # 0:26-0:32"
  "02 118 130    # 1:58-2:10"
  "03 271 282    # 4:31-4:42"
  "04 324 332    # 5:24-5:32"
  "05 400 414    # 6:40-6:54"
  "06 495 518    # 8:15-8:38"
  "07 563 579    # 9:23-9:39"
  "08 638 651    # 10:38-10:51"
  "09 758 774    # 12:38-12:54"
  "10 844 855    # 14:04-14:15"
  "11 908 920    # 15:08-15:20"
  "12 1039 1049  # 17:19-17:29"
)
for L in "${SEG[@]}"; do
  set -- $L
  id=$1; s=$2; e=$3; d=$((e - s))
  "$FF" -v error -y -ss "$s" -i "$OUT/full.wav" -t "$d" -c:a pcm_s16le "$OUT/raw/t${id}.wav"
  printf "t%s  %3d-%-4d (%2ds)\n" "$id" "$s" "$e" "$d"
done
echo "=== listing ==="
ls -la "$OUT/raw"
