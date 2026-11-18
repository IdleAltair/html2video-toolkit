#!/usr/bin/env bash
# 探测源视频音轨 + 本地可用的 torch / 分离库
set +e
FF=$HOME/mamba/envs/ninfer/bin/ffmpeg
FP=$HOME/mamba/envs/ninfer/bin/ffprobe
SRC="$WORKSPACE/谁最会说人话？我抓了6个AI挑战地狱级测试！【牢大百科10】.mp4"
echo "=== src exists ==="
ls -la "$SRC"
echo "=== format/streams ==="
"$FP" -v error -show_entries format=duration,bit_rate \
  -show_entries stream=index,codec_type,codec_name,sample_rate,channels,bit_rate \
  -of default=noprint_wrappers=1 "$SRC"
echo "=== numpy/scipy/torch/demucs availability ==="
for PY in $HOME/mamba/envs/ninfer/bin/python /usr/bin/python3; do
  echo "--- $PY ---"
  "$PY" - <<'EOF'
import importlib, sys
print("py", sys.version.split()[0])
for m in ("numpy", "scipy", "soundfile", "torch", "demucs", "librosa", "onnxruntime", "modelscope"):
    try:
        mod = importlib.import_module(m)
        print(" OK ", m, getattr(mod, "__version__", "?"))
    except Exception as e:
        print(" no  ", m, type(e).__name__)
EOF
done
echo "=== other conda envs / venvs under home ==="
ls $HOME/mamba/envs/ 2>/dev/null
ls -d $HOME/*/venv $HOME/*/.venv $HOME/venv* 2>/dev/null
echo "=== any demucs/uvr weights cached ==="
ls -d ~/.cache/torch/hub/checkpoints ~/.cache/huggingface 2>/dev/null
find $WORKSPACE -maxdepth 3 -iname "*.htdemucs*" -o -maxdepth 3 -iname "demucs*" 2>/dev/null | head
