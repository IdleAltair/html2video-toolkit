@echo off
REM ============================================================
REM  Qwen3.8-27B-Uncensored Code + Vision - layer split
REM  思考模式(官方推荐)+ 微调 | Q5_K_XL 19.7GB | vision-f16 | b10448
REM  可选调整:
REM    --reasoning-effort 嫌代码随机可降 --temp 0.7-0.8;想直答用 --reasoning off
REM    --reasoning-budget 2000 ^ (限制单轮思考长度,省时间/上下文)
REM    启用 MTP(已实测 tensor+MTP+--cache-ram 0 = 72t/s 稳定):
REM      --spec-type draft-mtp ^ + --spec-draft-n-max 2 ^
REM    注意: MTP 必须配 --cache-ram 0,否则 LCP 缓存命中会卡死(issue #26425)
REM ============================================================

set MODEL=D:/biubiu/local-llm/models/Qwen-3.8-uncensored-27b/Qwen-3.8-uncensored-27b-Q5_K_XL/Qwen3.8-27B-UD-Q5_K_XL.gguf
set MMPROJ=D:/biubiu/local-llm/models/Qwen-3.8-uncensored-27b/Qwen-3.8-uncensored-27b-Q4km/Qwen3.8-27B-Uncensored-vision-f16.gguf
set LLAMA=D:/biubiu/local-llm/llama.cpp-cuda-b10448-bak/llama-server.exe

echo [Code + Vision - layer] Qwen3.8-27B-Uncensored- port 8080- tensor split
echo.

%LLAMA% ^
  -m "%MODEL%" ^
  --mmproj "%MMPROJ%" ^
  --jinja ^
  -c 152000 ^
  -ngl 99 ^
  --split-mode tensor ^
  --tensor-split 0.5,0.5 ^
  --host 127.0.0.1 ^
  --port 8080 ^
  -fa on ^
  --no-warmup ^
  -np 1 ^
  -b 2048 ^
  -ub 1024 ^
  -ctk q8_0 ^
  -ctv q8_0 ^
  --reasoning on ^
  --spec-type draft-mtp ^
  --spec-draft-n-max 2 ^
  --reasoning-effort xhigh ^
  --reasoning-preserve ^
  --parallel 1 ^
  --temp 1 ^
  --top-k 20 ^
  --top-p 0.95 ^
  --min-p 0.0 ^
  --repeat-penalty 1.0

echo.
echo [Code + Vision - tensor] Server stopped.
pause
