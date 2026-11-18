# 续跑说明（2026-10-17 23:55 中断）

## 为什么中断

WSL 的 `/dev/dxg` 消失，`nvidia-smi` 报 “GPU access blocked by the operating system”。这是 WSL2 在 Windows 侧驱动重置/服务退出后常见的掉卡，VM 内无法恢复，只能 `wsl --shutdown` 重启。dsh 服务跑在这个 WSL 里（WSL 内 127.0.0.1:3080 在监听），所以重启会断开当前会话。

## 恢复后第一件事

```powershell
wsl --shutdown
# 重新打开 dsh，进入会话后说「继续配音」
```

## 配音步骤（GPU 恢复后）

1. 起 Breeze 常驻 API（约 60 s 加载，判据是 `/docs` 返回 200，不看 curl 退出码）：

```bash
setsid $HOME/breeze-tts-env/.venv/bin/python -m breeze_infer.api \
  $DESKTOP/screenshot/llm-html2video/breeze-tts-2 \
  --host 127.0.0.1 --port 7861 \
  > $DESKTOP/screenshot/llm-html2video/breeze-tts-setup/api_serve.log 2>&1 < /dev/null &
curl -s --noproxy '*' -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7861/docs
```

2. 跑 35 句（可续跑，已完成的会跳过）：

```bash
cd $WORKSPACE/deepseek-harness/workplace/local-deploy-27b-out/tts
python3 dub.py            # 逐句合成到 tts/clips/NN.wav
python3 dub.py --report   # 体检：时长、字数、语速
```

3. 拿到每页实测时长后：
   - 覆盖 `deck/index.html` 的 `CUES`（15 个 ms）
   - p12 的 `swap:{ms:9000,at:[23000]}` 按实测调整切段点
   - 更新 `字幕-draft.txt` 时间码

4. 录屏：`index.html?cue=1&wait=1&clean=1` → OBS 开录 → `window.__startCue()`。

## 当前状态

- deck：15 页，动效已升级（推格 520 / 整版 560 / 落版 420），p12 分两段（定死账目 → 能动三处），p13 四条 WDDM 口径，结束页红条收束。WSL、暂存、E 盘三处同步。
- 口播稿：`narration/口播稿-分页.md`，用户已改定，p12/p13/p15 是新版。
- 口播稿校对：已改 7 处错字/口径（in8kv→int8 KV、200多→180 等）。
- 待办：TTS → CUES → 字幕 → 录屏 → 合成。
