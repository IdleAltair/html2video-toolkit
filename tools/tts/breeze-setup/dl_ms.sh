#!/bin/bash
# 用 ModelScope 镜像下载 Breeze-TTS-2 权重（HF 直连只有 ~90KB/s，ModelScope 3.5MB/s）
set -u
PROJ=$PROJECT_ROOT
OUT=$PROJ/breeze-tts-2
LOG=$PROJ/breeze-tts-setup/download.log
export PATH="$HOME/.local/bin:$PATH"
export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
export UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple

# 清掉残留的 HF 半成品与 .incomplete，避免和 ModelScope 混在一个目录
rm -rf "$OUT/.cache"
mkdir -p "$OUT"
echo "===== $(date -Is) ModelScope download start =====" >> "$LOG"

for i in 1 2 3; do
  uvx --from modelscope modelscope download \
    --model BreezeBlue/Breeze-TTS-2 \
    --local_dir "$OUT" >> "$LOG" 2>&1
  rc=$?
  echo "[attempt $i] rc=$rc $(date -Is)" >> "$LOG"
  [ "$rc" -eq 0 ] && break
  sleep 5
done
echo "--- 结果 ---" >> "$LOG"
du -sh "$OUT" >> "$LOG" 2>&1
find "$OUT" -type f -printf "%s\t%p\n" | sort -rn | head -20 >> "$LOG" 2>&1
echo "===== $(date -Is) finished =====" >> "$LOG"
