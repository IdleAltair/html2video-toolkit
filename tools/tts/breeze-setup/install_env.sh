#!/bin/bash
# 建 BreezeTTS 的 Linux venv（WSL ext4）并装依赖；权重下载同时在进行
set -u
PROJ=$PROJECT_ROOT
LOG=$PROJ/breeze-tts-setup/env_install.log
VENV=$HOME/breeze-tts-env/.venv
export PATH="$HOME/.local/bin:$PATH"
export UV_HTTP_TIMEOUT=180
exec >>"$LOG" 2>&1
echo "===== $(date -Is) start ====="
rm -rf $HOME/breeze-tts-env
uv venv --python 3.11 "$VENV" || { echo "FATAL venv"; exit 1; }
"$VENV/bin/python" -V

echo "--- torch/torchaudio cu128 (sm_120 for 5060 Ti) ---"
uv pip install --python "$VENV/bin/python" \
  torch==2.9.1+cu128 torchaudio==2.9.1+cu128 \
  --index-url https://download.pytorch.org/whl/cu128 \
  || echo "WARN torch cu128 index failed"

echo "--- requirements.txt ---"
uv pip install --python "$VENV/bin/python" -r "$PROJ/breeze-tts/requirements.txt"

echo "--- flash-attn 可选（eager 路径不需要）：跳过源码编译 ---"
echo "=== verify ==="
"$VENV/bin/python" - <<'PY'
import torch, transformers, soundfile, qwen_tts
print("torch", torch.__version__, "cuda", torch.version.cuda)
print("cuda available", torch.cuda.is_available(), "dev", torch.cuda.get_device_name(0))
print("capability", torch.cuda.get_device_capability(0))
print("transformers", transformers.__version__)
print("soundfile", soundfile.__libsndfile_version__)
PY
uv pip freeze --python "$VENV/bin/python" | grep -iE "^(torch|torchaudio|numpy|transformers|qwen-tts|soundfile|fastapi|accelerate|librosa|onnxruntime) " 
echo "===== $(date -Is) done rc=$? ====="
