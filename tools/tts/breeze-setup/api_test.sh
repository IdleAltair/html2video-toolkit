#!/bin/bash
# 常驻流式 API 验证（修正：curl 必须 --noproxy，否则被 WSL 的 http_proxy 劫持成 502）
set -u
PROJ=$PROJECT_ROOT
VENV=$HOME/breeze-tts-env/.venv
S=$PROJ/breeze-tts-setup
PORT=7861
export TOKENIZERS_PARALLELISM=false
export no_proxy='*' NO_PROXY='*'          # 本地回环一律不走代理
cd "$PROJ/breeze-tts" || exit 1
: > "$S/api.log"

# 先清掉可能残留的实例（我上一轮起的）
for pid in $(pgrep -f "breeze[_]infer.ap[i]"); do kill -9 "$pid" 2>/dev/null; done
sleep 2

setsid "$VENV/bin/python" -m breeze_infer.api ../breeze-tts-2 \
  --host 127.0.0.1 --port "$PORT" >> "$S/api.log" 2>&1 < /dev/null &
sleep 1
SRV=$(pgrep -f "breeze[_]infer.ap[i]" | head -1)
echo "server pid=$SRV"

code=000
for i in $(seq 1 90); do
  code=$(curl -s --noproxy '*' -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/docs" 2>/dev/null)
  [ "$code" = "200" ] && break
  kill -0 "$SRV" 2>/dev/null || { echo "server 退出"; break; }
  sleep 2
done
echo "docs http=$code (第 $i 次探测)"

req() {
  local n=$1 t0=$SECONDS
  curl -s --noproxy '*' -m 300 -X POST "http://127.0.0.1:$PORT/v1/audio/speech" \
    -F "text=[笑] 欢迎来到今晚的故事时间，让我们一起开始吧。" \
    -F "instruction=一位温柔自信的年轻女性，声音清晰，语气亲切。" \
    -F "cfg_scale=4" -F "seed=42" \
    -o "$S/api_$n.pcm" \
    -w "  http=%{http_code} bytes=%{size_download} t=%{time_total}s\n"
  echo "  req$n wall=$((SECONDS - t0))s"
}
req 1
req 2
req 3

"$VENV/bin/python" - <<'PY'
import soundfile as sf, numpy as np, glob, os
for p in sorted(glob.glob("$PROJECT_ROOT/breeze-tts-setup/api_*.pcm")):
    raw = os.path.getsize(p)
    if raw == 0:
        print(os.path.basename(p), "空响应"); continue
    x = np.fromfile(p, dtype="<i2").astype("float32") / 32768.0
    w = p[:-4] + ".wav"
    sf.write(w, x, 24000, subtype="PCM_16")
    print(os.path.basename(w), f"{len(x)/24000:.2f}s")
PY

kill -9 "$SRV" 2>/dev/null; sleep 2
pgrep -f "breeze[_]infer.ap[i]" >/dev/null && echo "警告: 进程仍在" || echo "server 已退出"
timeout 3 bash -c "echo > /dev/tcp/127.0.0.1/$PORT" 2>/dev/null && echo "警告: 端口仍占用" || echo "端口 $PORT 已释放"
tr -d '\r' < "$S/check_wav.py" > ~/.cw.py
"$VENV/bin/python" ~/.cw.py "$S/api_*.wav"
echo "=== api.log 尾部 ==="; tail -8 "$S/api.log"
