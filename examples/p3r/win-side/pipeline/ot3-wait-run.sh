#!/usr/bin/env bash
# 等 land / ctf 那一串评测跑完，再单独跑炸弹人 workers=2 复跑（不与其它评测并发，避免抢核影响判时）
set -u
L=$WORKSPACE/arena-video/logs
echo "[wait] $(date +%H:%M:%S) 开始等前面的评测收尾" >> "$L/ot3-bomb-w2.log"
while pgrep -f 'challenge\.py|round_robin\.py|evaluate\.py' > /dev/null 2>&1; do
  sleep 30
done
sleep 15
echo "[wait] $(date +%H:%M:%S) 前面的评测已退出，启动 bomb workers=2 复跑" >> "$L/ot3-bomb-w2.log"
python3 -X utf8 $WORKSPACE/arena-video/pipeline/ot3_bomb_w2.py >> "$L/ot3-bomb-w2.log" 2>&1
echo "bomb_w2_exit=$?" >> "$L/ot3-bomb-w2.log"
echo "[wait] $(date +%H:%M:%S) 复跑结束" >> "$L/ot3-bomb-w2.log"
