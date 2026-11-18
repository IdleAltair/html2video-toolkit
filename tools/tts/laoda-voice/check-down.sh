#!/usr/bin/env bash
# 复查 Breeze 服务是否真的停了（GPU 占用 + 端口）
echo "procs: [$(pgrep -f breeze_infer | tr '\n' ' ')]"
c=$(curl -s --noproxy '*' -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:7861/docs)
echo "http_code=$c   (000 = 端口已释放)"
nvidia-smi --query-gpu=index,memory.used --format=csv,noheader
