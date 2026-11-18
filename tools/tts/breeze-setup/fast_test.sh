#!/bin/bash
# README 称 --fast-all 需 14.4 GiB 显存；本机 15.9 GiB 且另有 NVENC 任务在跑，实测可行性
set -u
PROJ=$PROJECT_ROOT
VENV=$HOME/breeze-tts-env/.venv
S=$PROJ/breeze-tts-setup
LOG=$S/fast_all.log
export TOKENIZERS_PARALLELISM=false
cd "$PROJ/breeze-tts" || exit 1
: > "$LOG"
( while sleep 2; do nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1; done ) > "$LOG.gpu" &
GPUP=$!
t0=$SECONDS
"$VENV/bin/python" infer.py ../breeze-tts-2 \
  --text "欢迎来到今晚的故事时间。" \
  --instruction "一位温柔自信的年轻女性，声音清晰。" \
  --cfg-scale 4 --fast-all \
  --output outputs/fast_all_test.wav >> "$LOG" 2>&1
rc=$?
echo "[fast-all] rc=$rc wall=$((SECONDS - t0))s" >> "$LOG"
kill $GPUP 2>/dev/null
echo "GPU 峰值采样(MiB): $(sort -n "$LOG.gpu" | tail -1)" >> "$LOG"
tail -4 "$LOG"
ls -la outputs/fast_all_test.wav 2>/dev/null || echo "无产物"
rm -f "$LOG.gpu"
