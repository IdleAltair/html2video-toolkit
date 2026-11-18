#!/bin/bash
# fast-all 第二次尝试：按报错提示换 expandable_segments 分配器
set -u
PROJ=$PROJECT_ROOT
VENV=$HOME/breeze-tts-env/.venv
S=$PROJ/breeze-tts-setup
LOG=$S/fast_all2.log
export TOKENIZERS_PARALLELISM=false
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
cd "$PROJ/breeze-tts" || exit 1
: > "$LOG"
t0=$SECONDS
"$VENV/bin/python" infer.py ../breeze-tts-2 \
  --text "欢迎来到今晚的故事时间。" \
  --instruction "一位温柔自信的年轻女性，声音清晰。" \
  --cfg-scale 4 --fast-all \
  --output outputs/fast_all_test.wav >> "$LOG" 2>&1
rc=$?
echo "[fast-all+expandable] rc=$rc wall=$((SECONDS - t0))s" >> "$LOG"
grep -E "OutOfMemory|Error|error|warmup|saved|rc=" "$LOG" | tail -6 >> "$LOG"
tail -6 "$LOG"
ls -la outputs/fast_all_test.wav 2>/dev/null || echo "无产物"
nvidia-smi --query-gpu=memory.used --format=csv,noheader
