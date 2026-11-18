# 压缩次数权威计数（截至 2026-10-03 23:50，三场加时全部结束）

计数方法：解 `session*.jsonl.zstd` 全部帧，数 `compaction/summary` 事件；再用
`tool/ptc-dispatch` 里 `name=="compact_region"` 的调用数交叉验证。**判据**：
`compaction/summary` 的 payload 里带 `usage`/`maxTokens` 的那次是引擎独立发起的摘要请求；
不带 `usage` 的是模型在 `compact_region` 里自写摘要、**没有额外请求**。

| 场 | 正赛 | 加时窗口 | 合计 | 其中引擎接管 | compact_region 调用 |
|---|---:|---:|---:|---:|---:|
| 圈地 land-gui2 | 4 | 5 | **9** | 0 | 9 |
| 炸弹人 bomberman-gui1 | 3 | 1（23:2x） | **4** | 1（18:16:37） | 3 |
| 夺旗 ctf-gui1 | 3 | 2 | **5** | 0 | 5 |
| **合计** | **10** | **8** | **18** | **1** | **17** |

交叉验证自洽：三场 `compact_region` 调用数 = 该场 summary 事件数 − 引擎接管数
（9 = 9−0、3 = 4−1、5 = 5−0）。

## 时刻表

- 圈地正赛：14:39:51、14:47:45、15:15:38、16:23:25；加时：22:36:04 ×5（同一步内连折五段，对应 4.20 步自述 "Folding complete (5 folds applied)"）
- 炸弹人正赛：17:06:18、17:29:47、18:16:37（唯一带 `usage`）；加时 1 次（唯一带 `usage`：input 9,582 / output 7,782 / maxTokens 32,768）
- 夺旗正赛：19:22:40、19:52:21、20:17:05；加时：21:28:15、21:29:31

## 需要订正的已发布口径

1. **`stats.json` 的 `compactions[].provider` 是归因标签，不是请求目标。** 源码注释写明
   "Attribution only: no request is made against this route"（`model-summary.ts:45-47`），
   `extract-stats.mjs:58` 直接抄了该字段。因此"压缩由本地 27B 完成"这句话在 17/18 次上不成立
   ——那 17 次**根本没发请求**，摘要是模型在 `compact_region` 的工具调用里顺手写的。
2. **`stats.json` 是 19:03 的旧快照**，夺旗只记到 0 次；实际夺旗正赛 3 次、加时 2 次。
3. 此前文档里的"三场合计 8 次（7 主动 + 1 引擎）"是**只算正赛且用了失真快照**的结果；
   正确口径是正赛 10 次、含加时 18 次。
4. `maxSummaryChars=5000` 与 `headroomTokens=0` 的真实来源是预设 patch（10:45:55 写入）
   与 bundle patch，不是包默认值（默认 3000 / 65536）。

---

## 2026-10-04 再订正（原始 session 日志逐帧解出，见 pipeline/session-recovery-probe.json）

上表「其中引擎接管 1」不对，**实为 2 次**，都在炸弹人（18:16:37 与 23:15:05，两次都带 `usage`/`maxTokens`/`llmStreamCall`）。
`compaction/summary` 合计仍是 18（圈地 9 / 炸弹人 4 / 夺旗 5），`compact_region` 派发消息 **16** 条，
16 + 2 = 18 自洽。上表按场次写的「炸弹人 compact_region 3 次」也应为 **2 次**。

另一条更要紧：**`session_query` 不是工具名**。它是 `stats.json` 里那个归因标签（`model-summary.ts:45-47`
注释写明 "Attribution only: no request is made against this route"）。真正的回读工具叫
`session_event_read` / `session_event_search` / `session_search` / `session_trace` / `session_event_trace`
（`packages/session-query/tool-session-query/src/index.ts:66-115`），且确实挂在跑比赛的那套 profile 上
（`.dsh/profiles/web/cordis.patch.yml:62-82`）。按真名重数：模型自己发起的回读/检索调用三场 **0 次**；
日志里 141 次出现这些名字全是引擎写的文本（`compaction/summary`、`user/message`、`system/message`、
`tool/ptc-dispatch`、`tool/result`），模型自写字段 0 次。
