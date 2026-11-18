# arena-p3r 合并说明（2026-10-06）

本目录由两份工程合成，**基准是 dsh 那份**：

| 来源 | 位置 | 状态 |
|---|---|---|
| `arena-p3r-sample` | WSL `~/deepseek-harness/workplace/arena-p3r-sample` | **基准**，10-06 27 页 / 中文轴 387.13s，日语与中文两版 4K 成片都已交。**原目录继续在 dsh 名下活动，本目录是它的副本** |
| `arena-video` | 原 `$WORKSPACE\arena-video` | 我方 Windows 侧那份，停在 10-04 的 25 页 v8。独有件已收进 `win-side/`，**原件 24 MB 已于 10-06 删除**（删前跑覆盖率核查：114 个文件在 `arena-p3r/` 下都有同 md5 副本，另 609 个是 `pipeline/.prof-anim` 的无头 Chrome profile 垃圾，一并清掉） |

**要改页面请回 WSL 那份改**（dsh 在活动），改完再同步过来；在本目录改会造成双头分叉。

## 拷贝范围与校验

`src data script tools pipeline build.mjs index.html clips.json *.md` + `assets/` + `clips/` + `dubbing/` 定稿，共 161 MB。

- 文本与代码 **101 个文件逐文件 md5 全一致**
- `assets/` 23 文件 / 33,604,113 B、`clips/` 26 文件 / 54,502,263 B、`dubbing/tts_clips/` 113 文件 / 67,212,764 B —— 文件数与总字节三项全等
- **重建验证**：在本目录跑 `node build.mjs` 成功，产物与拷来的 `index.html` 都是 1,305,870 字符，唯一差异是 `__DATA__.generatedAt` 这个构建时刻（11:40:42Z → 14:12:26Z），其余逐字节相同 → 合并后的工程自洽，且构建是确定性的。

## 8 个同名不同内容的文件，全部取 dsh 版

mtime 是裁决依据，dsh 侧 8 个全比我方新（10-05～10-06 vs 10-03～10-04）：

| 文件 | 我方（留档在 `win-side/superseded/`） | dsh（本目录正文） |
|---|---|---|
| `src/p_script.js` | 10-04 21:07 · 25 页 | 10-06 19:04 · 27 页 + `cuePlay` 修复 |
| `src/p_style.css` | 10-04 12:39 | 10-06 01:43（含 `body.clean #seaHint{display:none}`） |
| `src/p_mid.txt` | 10-03 19:24 | 10-05 22:15 |
| `script/口播稿.md` | 10-04 21:52 · v8（25 页，447 行 / 17,819 字） | 10-06 02:27 · **v10（27 页，内部讨论版，343 行 / 13,474 字）** |
| `data/challenge-full.json`、`data/ctf-faults.json`、`data/bomb-blind-zone.json`、`pipeline/bomb-blind-zone.py` | 10-04 | 10-05 |

口播稿字数从 17,819 掉到 13,474 **不是丢内容**：v9/v10 把原来写在口播里的"每页要点"拆成了独立的「页面文字」字段，旁白本身改短、数字口径按大样本重算过，且含用户后续的直接改动。v8 整份在 `win-side/superseded/口播稿.md`，要对旧版旁白去那儿看。

## 没重复搬的

- **中文配音 72 句**：dsh 侧 `dubbing/tts_clips_zh/` 的 73 个文件与我归档的
  `../laoda-zh-dub/out/zh-72/` **逐字节相同**（73 项 md5 全等，只差一个 `durations.json`），
  所以本目录不复制一份，需要时用 `laoda-zh-dub/out/zh-72/`。
- **日语配音 `tts_clips/`（111 句 + `full_preview.wav` + `subtitles.srt`）搬了** —— 那是唯一副本，不在别处。

## 成片：三部定稿已收进 `../raw/`，其余留在 dsh 侧

用户 10-06 拍板"只收三部定稿"。三份都做了 md5 校验（源 = dsh 的 `review/`，全 OK）：

| 文件（在 `../raw/`） | 实测规格 | 内容 |
|---|---|---|
| `【AI算法对抗大赛】小模型也想打比赛~qwen3.8-27B堂堂出道！.mp4` | 4K60 / 849.55s / 593,379,444 B | **发布稿**，与 `$OUTPUT_DIR\arena-video-4k-交付版.mp4` 同片长同尺寸 |
| `full-4k-zh.mp4` | 4K60 / 387.13s / 351,334,461 B | **中文女声版** |
| `full-p01-27.mp4` | 1440p30 / 844.03s / 164,707,150 B | 1440p 旧版成片 |

旁白语言是**按片长对轴判定的**（387.13s 对上中文轴、849.55s 与 844.0s 对上日语轴 852s），不是听出来的。

留在 dsh 侧没搬的中间产物：`full-4k-zh.video.mp4` 763 MB、`full-4k.video-retimed*.mp4` 540/546 MB、`*.sub.mp4` 字幕层，
以及两个抽帧目录 `full-p01-27.video-frames` 6.0 GB + `preview-p01-03.video-frames` 1.6 GB（纯中间产物，可让 dsh 清）。
- `dubbing/` 里的中间产物：`_preview_tmp/` 334 MB、`tts_clips_1.0/` 71 MB（旧语速版）、
  `_montage/ _speedtest/ _regen_out/ _regen2_out/ _noisefix/ _ab/ _ab2/ tts_clips_1.1_old/ tts_clips_backup/`。
- `.arena-replays .arena-shots .arena-clips .clips` —— 对我只读，一个字节都没写。

## `win-side/` 里是什么

- `pipeline/` **20 个 dsh 侧没有的工具**：`layout.mjs`（CDP 驱动无头 Chrome 量真实版式溢出，字符预算不算数）、
  `check.mjs`（全量体检）、`clip-mining.mjs` 与 `-v2.mjs`（高光候选池挖掘）、`anim-probe.mjs`、`shot.mjs`、
  `compaction-evidence.mjs`、`compaction-page.mjs`、`session-recovery-probe.mjs`、`areas.mjs`、`faults.mjs`、
  `bomb-noise.mjs`、`bomb-ctl.py`、`ot3_bomb_w2.py`、`ot3-wait-run.sh`、`full2json.mjs`、`dub.mjs`、
  `cuts.json`、`_scriptcheck.mjs`、`_syncsecs.mjs`
- `logs/` 7 个比赛日志（`ot-{land,bomb,ctf}.log`、`ot2-*`、`ctl-bomb.log`、`ot3-bomb-w2.log`）
- `archive/` 旧版页面 v1-23pages / v2-23pages-old
- `dubbing/` `字幕.txt`（v8 期日语稿）+ `ja-roxy-test/`（洛琪希日语音色测试，5.9 MB）
- `superseded/` 上表那 8 个文件的旧版 + 我方旧 `README-win.md` / `build.mjs` / `index.html`
