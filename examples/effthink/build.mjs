// 构建 arena-video/index.html
//   = src/p_top.txt + src/p_style.css + src/p_mid.txt + src/p_script.js + src/p_end.txt
// 构建时把 data/ 里的原始数据注入为 window.__DATA__，页面运行时读取渲染。
// —— 目的：token 账单、成绩、提示词、llama 参数都来自 data/ 文件，不手抄进 HTML；
//    同时因为是"构建期内联"，index.html 双击（file://）即可录屏，无需起 http 服务。
//
// 用法: node build.mjs
// 说明: 只做拼装与数据注入，不跑 ffmpeg、不渲染视频、不评分、不编译参赛代码。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, "src");
const DATA = path.join(ROOT, "data");
const OUT = path.join(ROOT, "index.html");
const PARTS = ["p_top.txt", "p_style.css", "p_mid.txt", "p_script.js", "p_end.txt"];

// 缺失文件直接终止，避免拼出半成品
for (const p of PARTS) {
  const f = path.join(SRC, p);
  if (!existsSync(f)) { console.error("[build] 缺构建源: src/" + p); process.exit(1); }
}

// 语法自检（沿用 llm-html2video：构建前 --check p_script.js）
const js = path.join(SRC, "p_script.js");
execFileSync(process.execPath, ["--check", js], { stdio: "inherit" });
console.log("[build] p_script.js 语法 OK");

const readText = (rel) => {
  const f = path.join(ROOT, rel);
  if (!existsSync(f)) { console.warn("[build] 数据缺失(留空): " + rel); return ""; }
  return readFileSync(f, "utf8");
};
const readJson = (rel) => {
  const t = readText(rel);
  if (!t) return null;
  try { return JSON.parse(t); }
  catch (e) { console.error("[build] JSON 解析失败: " + rel + " -> " + e.message); process.exit(1); }
};

// ---- 正赛 / 加时（每场追加的自迭代窗口）拆分：按 trace 表的「步号」列 turn.step 拆 ----
// 口径：加时 = "追加一个 40 分钟的自迭代窗口"那条消息之后开的 turn，按 turn 号切。
//   圈地 fromTurn=3（21:59 起，44 步）、炸弹人 fromTurn=3（22:57 起，54 步）、夺旗 fromTurn=3（21:11 起，47 步）。
//   夺旗注意别用 fromTurn=2：turn 2 起点 20:30 是正赛期间我发的那句"有没有试过自迭代"，它属于正赛，
//   算进加时会得到 49 步 / 63,518 tok，和 data/scores.md 加时表里的"47 步"打架。
// 步数、输出 token、工时都从 data/trace-*.md 逐步求和；压缩次数按「首次加时步的时刻」切 data/stats.json 的 compactions[]。
const OT_FROM_TURN = { "land-gui2": 3, "bomberman-gui1": 3, "ctf-gui1": 3 };
const TRACE_FILE = {
  "land-gui2": "data/trace-land-gui2.md",
  "bomberman-gui1": "data/trace-bomberman-gui1.md",
  "ctf-gui1": "data/trace-ctf-gui1.md",
};
const TRACE_ROW = /^\|\s*(\d+)\.(\d+)\s*\|\s*(\d{2}:\d{2})\s*\|\s*([0-9.]+)(m|s)\s*\|\s*([0-9]+)\s*\/\s*([0-9]+)\s*\/\s*([0-9]+)\s*\|/;
function parseTrace(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = TRACE_ROW.exec(line);
    if (!m) continue;
    out.push({
      turn: Number(m[1]), step: Number(m[2]), t: m[3],
      seconds: Number(m[4]) * (m[5] === "m" ? 60 : 1),
      inTok: Number(m[6]), outTok: Number(m[7]), cacheRead: Number(m[8]),
    });
  }
  return out;
}
// stats.json 的 compactions[].time 是 epoch(ms)，按东八区取 HH:MM 后与 trace 的时刻同口径可比
function hhmmOf(ms) {
  try {
    return new Date(ms).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch (e) { return ""; }
}
function sum(arr, f) { return arr.reduce((a, x) => a + f(x), 0); }
function r1(x) { return Math.round(x * 10) / 10; }
function phaseAgg(rows) {
  return {
    steps: rows.length,
    turns: [...new Set(rows.map((x) => x.turn))].sort((a, b) => a - b),
    out: sum(rows, (x) => x.outTok),
    in: sum(rows, (x) => x.inTok),
    cacheRead: sum(rows, (x) => x.cacheRead),
    minutes: r1(sum(rows, (x) => x.seconds) / 60),
    first: rows.length ? rows[0].t : null,
    last: rows.length ? rows[rows.length - 1].t : null,
  };
}
const SPLITS = {};
const STATS = readJson("data/stats.json") || {};
for (const key of Object.keys(OT_FROM_TURN)) {
  const rows = parseTrace(readText(TRACE_FILE[key]));
  if (!rows.length) { console.warn("[build] trace 解析为空，拆分留空: " + TRACE_FILE[key]); continue; }
  const from = OT_FROM_TURN[key];
  const reg = rows.filter((x) => x.turn < from);
  const ot = rows.filter((x) => x.turn >= from);
  const comps = ((((STATS[key] || {}).sessions || [])[0] || {}).compactions) || [];
  const otStart = ot.length ? ot[0].t : "99:99";
  const compOT = comps.filter((c) => hhmmOf(c.time) >= otStart).length;
  const headerSteps = Number((/steps=(\d+)/.exec(readText(TRACE_FILE[key])) || [])[1] || 0);
  SPLITS[key] = {
    fromTurn: from, otStart: otStart,
    headerSteps: headerSteps,
    headerCompactions: Number((/compactions=(\d+)/.exec(readText(TRACE_FILE[key])) || [])[1] || 0),
    reg: phaseAgg(reg), ot: phaseAgg(ot),
    compReg: comps.length - compOT, compOT: compOT, compTotal: comps.length,
  };
}

// ---- 耗时归因：data/time-cost.json 太大（逐步清单/原文摘要），只注入页面要用的聚合字段 ----
const TCFULL = readJson("data/time-cost.json");
let TIMECOST = null;
if (TCFULL && TCFULL.runs) {
  TIMECOST = { generatedAtLocal: TCFULL.generatedAtLocal, thresholds: TCFULL.thresholds, runs: {} };
  for (const k of Object.keys(TCFULL.runs)) {
    const r = TCFULL.runs[k];
    TIMECOST.runs[k] = {
      label: r.label, stepCount: r.stepCount,
      wall: r.wall, effective: r.effective, effectiveWithToolTail: r.effectiveWithToolTail,
      stepMs: r.stepMs, tokens: r.tokens,
      longestCategory: r.longestCategory,
      longStepCount: r.longStepCount, longMinutes: r.longMinutes, longSharePct: r.longSharePct,
      compactionCount: (r.compactions || []).length, nudgeCount: r.nudgeCount,
      toolErrors: (r.toolErrors || {}).correctFieldCount,
      // 报错发生的时刻（HH:MM），第 09 页要画"11 次挤在 41 分钟里"的密集段
      errTimes: ((r.toolErrors || {}).events || []).map((e) => String(e.t || "").slice(0, 5)),
      serviceErrors: (r.serviceErrors || []).map((s) => s.t),
      topSteps: (r.topSteps || []).map((s) => ({ step: s.step, t: s.t, minutes: s.minutes, out: s.out, cat: s.cat, act: s.act })),
      categories: (r.categories || []).map((c) => ({
        cat: c.cat, label: c.label, stepCount: c.stepCount, minutes: c.minutes,
        minutesExact: c.minutesExact, sharePct: c.sharePct, medianS: c.medianS, p95S: c.p95S,
        worst: c.worst ? { step: c.worst.step, t: c.worst.t, minutes: c.worst.minutes, out: c.worst.out, act: c.worst.act } : null,
      })),
    };
  }
}

// ---- 工具报错也按同一刀切开（正赛 27 / 加时 9），供第 20 页两本账用 ----
if (TCFULL && TCFULL.runs) {
  for (const k of Object.keys(SPLITS)) {
    const ev = (((TCFULL.runs[k] || {}).toolErrors || {}).events) || [];
    const start = SPLITS[k].ot && SPLITS[k].ot.first ? SPLITS[k].ot.first : "99:99";
    let ot = 0;
    ev.forEach((e) => { if (String(e.t || "").slice(0, 5) >= start) ot++; });
    SPLITS[k].errOT = ot;
    SPLITS[k].errReg = ev.length - ot;
    SPLITS[k].errTotal = ev.length;
  }
}

// ---- 大样本（challenge.py --full）复核结果：正赛版与加时终版各一轮 ----
const FULL = readJson("data/challenge-full.json");

// ---- 看计时器统计：data/clock-reads.json（逐条读数 + 汇总，命令原文不进页面）----
const CRFULL = readJson("data/clock-reads.json");
let CLOCKS = null;
if (CRFULL && CRFULL.runs) {
  CLOCKS = { totals: CRFULL.totals, runs: {} };
  for (const k of Object.keys(CRFULL.runs)) {
    const list = CRFULL.runs[k];
    const cnt = (f) => list.filter(f).length;
    CLOCKS.runs[k] = {
      n: list.length,
      main: cnt((x) => x.phase === "main"), over: cnt((x) => x.phase !== "main"),
      solo: cnt((x) => x.standalone), ride: cnt((x) => !x.standalone),
      direct: cnt((x) => x.via === "direct"), wrapper: cnt((x) => x.via !== "direct"),
      soloMain: cnt((x) => x.phase === "main" && x.standalone),
      first: list.length ? list[0].t : null, last: list.length ? list[list.length - 1].t : null,
      reads: list.map((x) => ({ t: x.t, phase: x.phase, solo: !!x.standalone, via: x.via, printed: x.printed })),
    };
  }
}

// ---- 组装 __DATA__（全部源自 data/）----
const DATAOBJ = {
  generatedAt: new Date().toISOString(),
  // ── 新片唯一读数源 ──
  // 模型规格 / 成绩对照 / 行为五指标 / 时间占比 / 加时台账 / 可复现性，全部来自这一个文件
  compare: readJson("data/model-compare.json"),
  // 13 轮改动的逐条台账（CSV 全字段带双引号、字段内不含引号，故只需按引号态切逗号）
  iters: (() => {
    const t = readText("data/iterations.csv");
    if (!t) return [];
    const cut = (line) => {
      const cells = []; let cur = "", q = false;
      for (const c of line) {
        if (c === '"') { q = !q; continue; }
        if (c === "," && !q) { cells.push(cur); cur = ""; continue; }
        cur += c;
      }
      cells.push(cur);
      return cells;
    };
    const rows = t.split(/\r?\n/).filter((l) => l.trim()).map(cut);
    const head = rows.shift() || [];
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
  })(),
  // 台账计数由 pipeline/iter-stats.mjs 复算生成，页面只读它、不手抄「18 次 / 5 次」这类数
  itersStats: readJson("data/iterations-stats.json"),
  // 正赛 / 加时 拆分（来自 data/trace-*.md + data/stats.json）
  splits: SPLITS,
  // 夺旗八方局逐回合比分（diag8.json 抽稀：每 5 回合一点，81 点 × 8 方），第 17 页折线用
  diag8: readJson("data/ctf-diag8-scores.json"),
  // 大样本复核（challenge.py --full）：正赛版 / 加时终版各一轮，成绩页优先读这里
  full: FULL,
  // 夺旗段错误的分档分布（pipeline/faults.mjs 从逐局 结果.jsonl 数出来，成绩表只有总数）
  ctfFaults: readJson("data/ctf-faults.json"),
  // 夺旗两代加时终版 bot 的分档实测 + 决策代码行号（第 27 页策略对照的唯一读数源）
  ctfStrategy: readJson("data/ctf-strategy.json"),
  // 圈地单挑面积（大样本 results.jsonl 逐局 areas 平均），第 7 页自测 vs 评测的对照
  landAreas: readJson("data/land-areas.json"),
  // 炸弹人同赛程、只差并发的逐局终分比对（pipeline/bomb-noise.mjs），第 19 页量评测本身的抖动
  bombNoise: readJson("data/bomb-noise.json"),
  // 主动压缩的代价：折叠次数 / 重放税 / 两类探针（pipeline/compaction-page.mjs 筛 data/compaction-evidence.json）
  compactionPage: readJson("data/compaction-page.json"),
  // 火焰数组截断的实际代价：十人档逐局回放里本机被炸死在盲区（格号≥313）的比例（pipeline/bomb-blind-zone.py）
  blindZone: readJson("data/bomb-blind-zone.json"),
  // 小样本参赛轮的对照表（full 未到位时成绩页回退到这里，字段同名）
  legacy: readJson("data/legacy-scores.json"),
  // 逐步时间归因（来自 data/time-cost.json）
  timeCost: TIMECOST || {},
  // 看计时器次数（来自 data/clock-reads.json）
  clocks: CLOCKS || {},
  // token 账单主数据（务必来自 stats.json）
  stats: STATS,
  // 成绩：本地 27B 参赛轮 + 正式赛参照
  scores: {
    landChallenge:     readJson("data/land-challenge-ratings.json"),
    officialLand:      readJson("data/official/land-ratings.json"),
    officialCtf:       readJson("data/official/ctf-ratings.json"),
    officialBomberman: readJson("data/official/bomberman-ratings.json"),
    bombermanBt:       readJson("data/bomberman-bt.json"),
  },
  // 环境事实：llama 启动参数原样（一个字不改）
  bat: readText("data/llama-launch.bat"),
  // 提示词原文（三集各一段，展示用）
  prompts: {
    land:      readText("data/prompts/land.txt"),
    bomberman: readText("data/prompts/bomberman.txt"),
    ctf:       readText("data/prompts/ctf.txt"),
  },
};

const AVA_FILE = path.join(ROOT, "assets/ava-27b.png");
const avaScript = existsSync(AVA_FILE)
  ? "\nwindow.__AVA__=\"data:image/png;base64," + readFileSync(AVA_FILE).toString("base64") + "\";"
  : "";
// 视频槽素材表：clips.json 存在时按 <场>=<相对路径> 注入，页面用它渲染 <video>；不存在就还是 REC 占位。
const CLIPS_FILE = path.join(ROOT, "clips.json");
const SINK_FILE = path.join(ROOT, "assets/sink-fig.png");
const sinkScript = existsSync(SINK_FILE)
  ? "\nwindow.__SINK__=\"data:image/png;base64," + readFileSync(SINK_FILE).toString("base64") + "\";"
  : "";
const clipsScript = existsSync(CLIPS_FILE)
  ? "\nwindow.__CLIPS__=" + readFileSync(CLIPS_FILE, "utf8").trim() + ";"
  : "";
// 配音时间轴：cues.json 由 pipeline/dub.py --timeline 生成，?cue=1 用它逐页点亮元素。
const CUES_FILE = path.join(ROOT, "data/cues.json");
const cuesScript = existsSync(CUES_FILE)
  ? "\nwindow.__CUES__=" + readFileSync(CUES_FILE, "utf8").trim() + ";"
  : "";
const dataScript =
  "<script id=\"__data\">/* injected from data/ by build.mjs — 勿手改 */\n" +
  "window.__DATA__=" + JSON.stringify(DATAOBJ) + ";" + avaScript + sinkScript + clipsScript + cuesScript + "\n</script>";

// ---- 拼接 ----
let html = "";
for (const p of PARTS) {
  let chunk = readFileSync(path.join(SRC, p), "utf8");
  if (p === "p_mid.txt") chunk = chunk.replace("<!--@DATA@-->", dataScript);
  html += chunk;
  console.log("[build] + " + p + " (" + readFileSync(path.join(SRC, p), "utf8").length + " B)");
}

if (html.includes("<!--@DATA@-->")) {
  console.error("[build] 警告: p_mid.txt 未放置 <!--@DATA@--> 注入点，数据未内联");
}

// ---- 字体：两个字重的 WOFF2 子集内联（assets/ 缺失时回退到开发机的绝对路径）----
const FONT_FALLBACK = "file:///$DESKTOP/screenshot/llm-html2video/NotoSansSC-Regular.otf";
for (const [token, rel] of [["__FONT400__", "assets/noto-400.woff2"], ["__FONT700__", "assets/noto-700.woff2"]]) {
  const f = path.join(ROOT, rel);
  const val = existsSync(f) ? "data:font/woff2;base64," + readFileSync(f).toString("base64") : FONT_FALLBACK;
  html = html.split(token).join(val);
  console.log("[build] font " + (existsSync(f) ? rel + " 内联 " + Math.round(readFileSync(f).length / 1024) + "KB" : "缺失，回退绝对路径"));
}

// ---- 选手头像：横比柱顶端的小圆头像，名字 -> assets/avas/<file>@96.png ----
const AVA_MAP = {
  "本地 27B": "local-27b", "27B": "local-27b",
  "Sonnet 5": "sonnet-5.5", "Sonnet 5.5": "sonnet-5.5",
  "GPT-6 Astra": "gpt-6-astra", "Opus 5.5": "opus-5.5",
  "GPT-6 Sol": "gpt-6-sol", "GPT-6.1 Sol": "gpt-6-sol",
  "MiMo V2.6 Pro": "mimo-v2.6-pro", "Kimi K3": "kimi-k3", "GLM 5.3": "glm-5.3",
  "DeepSeek V4.1 Flash": "deepseek-v4.1-flash", "Fable 5.1": "fable-5.1",
  "Qwen 3.8 Max": "qwen-3.8-max",
  "豆包 Seed 2.1 Turbo": "doubao-seed-2.1-turbo", "豆包 Seed 2.1": "doubao-seed-2.1-turbo",
  "神秘模型": "base", "Base": "base", "基准": "base",
  "Coder390": "local-27b", "Q5_K_XL": "local-27b", "锚点 · greedy": "base",
};
const avaMap = {};
for (const [name, file] of Object.entries(AVA_MAP)) {
  const f = path.join(ROOT, "assets/avas", file + "@96.png");
  if (existsSync(f)) avaMap[name] = "data:image/png;base64," + readFileSync(f).toString("base64");
}
const avaScript2 = "\nwindow.__AVAS__=" + JSON.stringify(avaMap) + ";";
html = html.replace("window.__DATA__=", avaScript2 + "\nwindow.__DATA__=");
console.log("[build] 头像内联 " + Object.keys(avaMap).length + " 张");

writeFileSync(OUT, html);
console.log("[build] -> " + OUT + " (" + Buffer.byteLength(html) + " B)");
console.log("[build] __DATA__ 大小 " + Buffer.byteLength(dataScript) + " B；来源 stats/scores/bat/prompts 全部内联");
