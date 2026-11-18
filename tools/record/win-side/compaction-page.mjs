// 把 pipeline/compaction-evidence.mjs 的原始计数筛成第 23 页能直接画的形状。
// 为什么要这一层：evidence 里的「同一文件重复读」按文件名关键字配对，会把
// 「写 README」当成「读 README」、把同一步（1.75 一次读 greedy 也读 anchor）计两对，
// 直接上画面就是拿误报当证据。这里只留两侧都是读、且两次之间确实夹了折叠的对。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => readFileSync(path.join(ROOT, p), "utf8");
const E = JSON.parse(rd("data/compaction-evidence.json"));

const CN = { land: "圈地", bomberman: "炸弹人", ctf: "夺旗" };
const READ = /\b(read|re-read|dump|cat|grep|scan|view|check|locate|show|inspect|head|list)\b/i;
const WRITE_ONLY = /^(run_code:\s*)?(write|create|patch|build|rewrite|set|save|update)\b/i;
const FIX = /\b(fix|repair|escape|newline|recompile|rebuild|re-apply|redo|again|correct)\b/i;
const isRead = (a) => READ.test(String(a || "")) && !WRITE_ONLY.test(String(a || ""));
const stepNo = (s) => { const [t, n] = String(s).split("."); return (+t) * 10000 + (+n); };

/* ---- 探针一：有没有回头搜被折叠的历史 ---- */
// session_query 不是工具名（那是引擎侧的路由标签）。真名在 packages/session-query 里：
// session_event_read / session_event_search / session_search / session_trace / session_event_trace。
// 轨迹 md 只能看到「列里没写」，所以这条以原始 session 日志的窄口径（模型自己发起的调用）为准。
const c = E.C;
const probe1 = {
  definition: c.definition,
  toolNames: ["session_event_read", "session_event_search", "session_search", "session_trace", "session_event_trace"],
  sessionQuery: c.totals.session_query,
  historyRead: c.totals.history_read,
  crossSession: c.totals.cross_session_action,
  traceOnlyCaveat: (E.caveats || [])[0] || "",
  rawLog: null,
};
try {
  const raw = JSON.parse(rd("data/session-recovery-probe.json"));
  const t = raw.totals || {};
  probe1.rawLog = {
    recoveryCalls: t.family_narrow_anyCallType,          // 模型发起的回读/检索调用，按真名窄口径
    selfLogReads: t.selflogReads,                        // 调用参数指向会话日志自身的次数
    wideMentions: t.family_wide_raw,                     // 宽口径：日志里出现这些名字的总次数（全是引擎写的文本）
    compactDispatch: t.compact_dispatch,                 // 模型自己调 compact_region 的派发消息数
    summaries: t.compactionSummary,
    engineSummaries: t.compactionSummaryWithUsage,       // 带 usage 的 = 引擎发起的那几次
    harnessToldIt: ((raw.notes || {}).harnessExposureSources || []).length,
  };
  probe1.sessionQuery = t.family_narrow_anyCallType;
} catch (e) { console.warn("[compaction-page] 没读到 session-recovery-probe.json，探针一退回轨迹口径: " + e.message); }


/* ---- 探针二 A：同一份文件读第二遍，且两次之间夹着折叠 ---- */
const rereread = [];
for (const g of ["land", "bomberman", "ctf"]) {
  const o = (E.D.D1.perSession || {})[g] || {};
  const seen = new Set();
  (o.fileRepeats || []).forEach((r) => {
    if (!(r.compactionCount > 0)) return;
    if (!isRead(r.fromAction) || !isRead(r.toAction)) return;
    const toStep = String(r.to).split("@")[0];
    if (seen.has(toStep)) return; // 一步里读到的多个关键字只算一次回头
    seen.add(toStep);
    rereread.push({ game: CN[g], file: r.file, from: r.from, to: r.to, gapSteps: r.gapSteps,
      gapMinutes: r.gapMinutes, folds: r.compactionCount, fromAction: r.fromAction, toAction: r.toAction });
  });
}
rereread.sort((a, b) => b.folds - a.folds || b.gapSteps - a.gapSteps);

/* ---- 探针二 B：同一类错误在折叠之后又踩一次 ---- */
// 光靠正则配不出可靠的「复发」：命中行里既有「又踩了一次」也有「修好了，重编译看看」，
// 而且跨回合配对会数出「隔 19994 步」这种没意义的话（1.x → 3.x 中间隔着加时开跑）。
// 所以这里的做法是：**哪一对算真复发由人判**（下面 ADJUDICED，判据是把两边原文逐行读过），
// 步号 / 时刻 / 中间几次折叠 / 原文全部回 evidence 里取，不由人填，数字才不会漂。
const ADJUDICED = [
  { session: "land", family: "printf_newline", a: "1.8", b: "1.78",
    why: "14:37 写第一版时 printf 的 \\n 被工具层吞掉，15:29 改写整份策略时同一处又吞了一次" },
  { session: "bomberman", family: "printf_newline", a: "1.12", b: "1.58",
    why: "17:05 刚把 \\n 修好、17:06 折叠了一次，17:24 用 python heredoc 打补丁时又写坏一次" },
];
const mistake = [];
ADJUDICED.forEach((ad) => {
  const fam = (E.D.D3[ad.family] || {}).perSession || {};
  const hits = (fam[ad.session] || {}).hits || [];
  const folds = (E.A.foldSteps || []).filter((s) => s.session === ad.session);
  const A = hits.find((h) => h.step === ad.a), B = hits.find((h) => h.step === ad.b);
  if (!A || !B) { console.warn("[compaction-page] 人工配对的步号在 evidence 里找不到: " + ad.session + " " + ad.a + "/" + ad.b); return; }
  const [ta, na] = ad.a.split("."), [tb, nb] = ad.b.split(".");
  mistake.push({ game: CN[ad.session], family: (E.D.D3[ad.family] || {}).label, why: ad.why,
    from: A.step + "@" + A.time, to: B.step + "@" + B.time,
    sameTurn: ta === tb, gapSteps: ta === tb ? (+nb) - (+na) : null,
    gapMinutes: (+B.timeMin) - (+A.timeMin), foldsBetween: folds.filter((f) => f.idx > A.idx && f.idx < B.idx).length,
    fromAction: A.action, toAction: B.action, rawA: A.raw, rawB: B.raw });
});
mistake.sort((a, b) => b.foldsBetween - a.foldsBetween || (b.gapSteps || 0) - (a.gapSteps || 0));

/* ---- 折叠税 ---- */
const durs = (E.A.foldSteps || []).map((s) => s.durSec).filter((x) => x != null).sort((a, b) => a - b);
const an = E.B.anchors || [];
const cacheBefore = Math.max.apply(null, (E.A.foldSteps || []).map((s) => s.cacheRead || 0).concat([0]));const after = an.map((x) => x.cacheRead).filter((x) => x != null);
const newIn = an.map((x) => x.tokIn).filter((x) => x != null);
const tax = {
  events: E.A.compactionEventTotal,
  headerEvents: E.A.headerCompactionTotal,
  foldSteps: (E.A.foldSteps || []).length,
  perSession: Object.keys(CN).reduce((a, g) => {
    a[CN[g]] = (E.A.foldSteps || []).filter((s) => s.session === g).length; return a;
  }, {}),
  noteMinSec: durs[0], noteMaxSec: durs[durs.length - 1],
  noteMedianSec: durs[Math.floor(durs.length / 2)],
  cacheMaxBefore: cacheBefore, afterMin: Math.min.apply(null, after), afterMax: Math.max.apply(null, after),
  replayMinTok: Math.min.apply(null, newIn), replayMaxTok: Math.max.apply(null, newIn),
  anchors: (E.B.verdict || {}).distinctAnchorCount != null ? E.B.verdict.distinctAnchorCount : an.length,
  selfInitiated: probe1.rawLog ? probe1.rawLog.compactDispatch : null,
  engineTaken: probe1.rawLog ? probe1.rawLog.engineSummaries : null,
  rawAnchors: (E.B.verdict || {}).rawEventAnchorCount != null ? E.B.verdict.rawEventAnchorCount : an.length,
  familyHits: Object.keys(E.D.D3).reduce((a, k) => {
    if (E.D.D3[k] && E.D.D3[k].totalHits != null) a[(E.D.D3[k].label || k)] = E.D.D3[k].totalHits; return a;
  }, {}),
};

const out = {
  generatedBy: "pipeline/compaction-page.mjs",
  note: "全部字段从 data/compaction-evidence.json 筛出；evidence 又是逐条解析 data/trace-*.md 得来的，页面不手抄数字。",
  screening: {
    readVerbRegex: String(READ), writeReject: String(WRITE_ONLY),
    droppedPairs: (E.D.D1.perSession.land.fileRepeatPairs_total + E.D.D1.perSession.ctf.fileRepeatPairs_total +
      E.D.D1.perSession.bomberman.fileRepeatPairs_total) - rereread.length -
      (E.D.D1.perSession.land.fileRepeatPairs_total - E.D.D1.perSession.land.fileRepeatPairs_acrossCompaction) -
      (E.D.D1.perSession.ctf.fileRepeatPairs_total - E.D.D1.perSession.ctf.fileRepeatPairs_acrossCompaction) -
      (E.D.D1.perSession.bomberman.fileRepeatPairs_total - E.D.D1.perSession.bomberman.fileRepeatPairs_acrossCompaction),
    evidenceAcrossFold: E.D.D1.perSession.land.fileRepeatPairs_acrossCompaction +
      E.D.D1.perSession.ctf.fileRepeatPairs_acrossCompaction +
      E.D.D1.perSession.bomberman.fileRepeatPairs_acrossCompaction,
  },
  probe1, probe2: { rerereadAcrossFold: rereread, mistakeAcrossFold: mistake,
    redoSameEditStrict: Object.keys(E.D.D2).reduce((n, g) => n + ((E.D.D2[g] || {}).recurrencePairsWithin10Steps || 0), 0) },
  tax,
};
writeFileSync(path.join(ROOT, "data/compaction-page.json"), JSON.stringify(out, null, 1) + "\n");
console.log("[compaction-page] 折叠 " + tax.events + " 事件 / " + tax.foldSteps + " 动作步 · " +
  "回查历史 " + probe1.sessionQuery + " · 重读跨折叠 " + rereread.length + " 对（evidence 口径 " +
  out.screening.evidenceAcrossFold + "）· 同类错误复发 " + mistake.length + " 例 · 重做编辑 " +
  out.probe2.redoSameEditStrict);
rereread.forEach((r) => console.log("  重读 " + r.game + " " + r.file + " " + r.from + "→" + r.to +
  " 隔 " + r.gapSteps + " 步 / " + r.folds + " 次折叠 :: " + r.toAction));
mistake.forEach((m) => console.log("  复发 " + m.game + " 「" + m.family + "」 " + m.from + "→" + m.to +
  " 隔 " + m.gapSteps + " 步 / " + m.foldsBetween + " 次折叠 :: " + m.toAction));
