#!/bin/bash
# 冒烟测试：voice design（无参考音频）+ voice clone（用现有 dubbing 片段与其原文）
set -u
PROJ=$PROJECT_ROOT
VENV=$HOME/breeze-tts-env/.venv
LOG=$PROJ/breeze-tts-setup/smoke.log
export TOKENIZERS_PARALLELISM=false
cd "$PROJ/breeze-tts" || exit 1
mkdir -p outputs
: > "$LOG"

# 显存采样
( while sleep 2; do nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1; done ) > "$LOG.gpu" &
GPUPID=$!

run() {
  local name=$1; shift
  echo "===== [$name] $(date -Is) =====" >> "$LOG"
  local t0=$SECONDS
  "$VENV/bin/python" infer.py "$@" >> "$LOG" 2>&1
  local rc=$?
  echo "[$name] rc=$rc wall=$((SECONDS - t0))s" >> "$LOG"
}

run design \
  ../breeze-tts-2 \
  --text "[笑] 欢迎来到今晚的故事时间，让我们一起开始吧。" \
  --instruction "一位温柔自信的年轻女性，声音清晰，语气亲切，表达轻快而富有感染力。" \
  --cfg-scale 4 \
  --output outputs/smoke_design_zh.wav

run clone \
  ../breeze-tts-2 \
  --ref-audio ../dubbing/tts_clips/01.wav \
  --ref-text "上下文长度200k，精度都是q8" \
  --text "压缩了三次上下文，一轮直出，音色也保持稳定。" \
  --output outputs/smoke_clone_zh.wav

kill $GPUPID 2>/dev/null
echo "=== 产物 ===" >> "$LOG"
"$VENV/bin/python" - <<'PY' >> "$LOG" 2>&1
import soundfile as sf, glob, os
for p in sorted(glob.glob("outputs/smoke_*.wav")):
    i = sf.info(p)
    print(f"{p}  {i.frames / i.samplerate:.2f}s  {i.samplerate}Hz  ch={i.channels}  {os.path.getsize(p) / 1e6:.2f}MB")
PY
echo "=== GPU 峰值(采样, MiB) ===" >> "$LOG"
sort -n "$LOG.gpu" | tail -2 >> "$LOG"
echo "--- 摘要 ---"
grep -E "^=====|^\[.*\] rc=|smoke_|MiB|^[0-9]+ " "$LOG" | tail -20
