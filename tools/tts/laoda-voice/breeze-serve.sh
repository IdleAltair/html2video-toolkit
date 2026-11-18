#!/usr/bin/env bash
# 起 BreezeTTS 常驻 API，绑到空闲的 GPU1；日志写项目内（/tmp 会被 WSL 闲置回收清掉）
cd $PROJECT_ROOT/breeze-tts || exit 9
LOG=$PROJECT_ROOT/breeze-tts-setup/api_laoda.log
CUDA_VISIBLE_DEVICES=1 setsid $HOME/breeze-tts-env/.venv/bin/python -m breeze_infer.api ../breeze-tts-2 \
  --host 127.0.0.1 --port 7861 > "$LOG" 2>&1 < /dev/null &
sleep 3
echo "pids: $(pgrep -f breeze_infer | tr '\n' ' ')"
echo "log -> $LOG"
