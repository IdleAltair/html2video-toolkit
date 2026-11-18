// arena-video 全量体检：构建一致性 + 数据口径交叉校验 + 无浏览器渲染断言 + 文案/文档同步
// 用法: node pipeline/check.mjs
// 说明: 全程静态检查（node + vm 里的 DOM 桩），不使用任何浏览器工具、不跑 ffmpeg、不计分。
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PARTS = ["p_top.txt", "p_style.css", "p_mid.txt", "p_script.js", "p_end.txt"];
const R = (rel) => path.join(ROOT, rel);
const rd = (rel) => readFileSync(R(rel), "utf8");
const has = (rel) => existsSync(R(rel));

let pass = 0, warn = 0, fail = 0;
const ok = (m) => { pass++; console.log("  PASS  " + m); };
const no = (m) => { warn++; console.log("  WARN  " + m); };
const bad = (m) => { fail++; console.log("  FAIL  " + m); };
const chk = (cond, msgOk, msgBad) => { cond ? ok(msgOk) : bad(msgBad); };

// ---------- 1/5 构建源与产物 ----------
console.log("== 1/5 构建源与产物 ==");
const missingParts = PARTS.filter((p) => !has("src/" + p));
chk(missingParts.length === 0, "五件套齐全 src/" + PARTS.join(" / "), "构建源缺失: " + missingParts.join(", "));
try {
  execFileSync(process.execPath, ["--check", R("src/p_script.js")], { stdio: "ignore" });
  ok("src/p_script.js 语法 OK");
} catch (e) { bad("src/p_script.js 语法错误: " + e.message); }
const scriptSrc = rd("src/p_script.js");
chk(!/`/.test(scriptSrc), "p_script.js 未使用反引号模板字符串（全文件单引号拼接）", "p_script.js 出现反引号，违反本工程书写约定");
if (!has("index.html")) { bad("index.html 缺失 → node build.mjs"); }
else {
  const html = rd("index.html");
  chk(html.includes(scriptSrc), "index.html 内嵌的 p_script.js 与构建源逐字一致", "index.html 里的脚本段与 src/p_script.js 不一致 → 重跑 node build.mjs");
  chk(html.includes("</style>") && html.includes("id=\"stage\"") && html.includes("id=\"curtain\""), "index.html 结构完整（样式 / stage / 落幕）", "index.html 缺结构件");
  const stale = PARTS.filter((p) => statSync(R("src/" + p)).mtimeMs > statSync(R("index.html")).mtimeMs);
  chk(stale.length === 0, "产物不比构建源旧", "以下源文件比 index.html 新，需重建: " + stale.join(", "));
  // data/scores.md 的审计口径里有停机补偿时长，这类文本不许随 __DATA__ 进产物：直接扫成品文件
  const leak = ["补时", "8 分 05", "3 分 18", "冻结"].filter((w) => html.includes(w));
  chk(leak.length === 0, "index.html 成品原文（含 __DATA__ 数据块）不含补时口径", "产物里漏进了禁词: " + leak.join(" / "));
}

// ---------- 2/5 __DATA__ 与数据来源 ----------
console.log("\n== 2/5 __DATA__ 与数据来源 ==");
const html = has("index.html") ? rd("index.html") : "";
const dm = /<script id="__data">[\s\S]*?window\.__DATA__=([\s\S]*?);\n<\/script>/.exec(html);
let D = null;
if (!dm) bad("index.html 里没有可解析的 __DATA__ 注入块");
else { try { D = JSON.parse(dm[1]); ok("__DATA__ 注入块可解析（" + dm[1].length + " B）"); } catch (e) { bad("__DATA__ JSON 解析失败: " + e.message); } }
const DATA_FILES = ["data/stats.json", "data/trace-land-gui2.md", "data/trace-bomberman-gui1.md", "data/trace-ctf-gui1.md",
  "data/time-cost.json", "data/time-cost.md", "data/clock-reads.json", "data/scores.md",
  "data/score-integrity.md", "data/compaction-counts.md", "data/llama-launch.bat", "data/prompts/land.txt"];
const missData = DATA_FILES.filter((f) => !has(f));
chk(missData.length === 0, "data/ 关键来源齐全（" + DATA_FILES.length + " 个，含加时后的刷新件）", "data/ 缺: " + missData.join(", "));
chk(has("data/overtime-interruptions.md") === false, "审计台账 overtime-interruptions.md 没有被复制进本工程", "data/ 里出现了 overtime-interruptions.md，不该进视频工程");
if (D) {
  const keys = ["land-gui2", "bomberman-gui1", "ctf-gui1"];
  chk(keys.every((k) => D.stats && D.stats[k] && D.stats[k].sessions && D.stats[k].sessions.length), "stats 三场会话齐全（land / bomberman / ctf）", "stats 缺场次");
  chk(keys.every((k) => D.splits && D.splits[k]), "splits 三场正赛/加时拆分都在（build.mjs 解析 trace 生成）", "splits 缺场次");
  chk(!!(D.timeCost && D.timeCost.runs && Object.keys(D.timeCost.runs).length === 3), "timeCost 三场耗时归因已注入", "timeCost 缺失或不全");
  chk(!!(D.clocks && D.clocks.runs && Object.keys(D.clocks.runs).length === 3), "clocks 三场看表记录已注入", "clocks 缺失或不全");
}

// ---------- 3/5 数字口径交叉校验（页面用的数就是这些，不许两头不一致）----------
console.log("\n== 3/5 数字口径交叉校验 ==");
if (D && D.splits) {
  const keys = ["land-gui2", "bomberman-gui1", "ctf-gui1"];
  let splitOk = true, outOk = true, compOk = true;
  const sum = { req: 0, steps: 0, out: 0, err: 0, turns: 0, min: 0, comp: 0, compReg: 0, compOt: 0, otSteps: 0, otOut: 0 };
  keys.forEach((k) => {
    const s = D.splits[k], sess = D.stats[k].sessions[0];
    if (s.reg.steps + s.ot.steps !== s.headerSteps) { splitOk = false; bad(k + " 正赛步 " + s.reg.steps + " + 加时步 " + s.ot.steps + " ≠ trace steps=" + s.headerSteps); }
    if (s.reg.out + s.ot.out !== sess.tokens.output) { outOk = false; bad(k + " 输出 token 两栏之和 " + (s.reg.out + s.ot.out) + " ≠ stats.json " + sess.tokens.output); }
    if (s.compReg + s.compOt !== (sess.compactions || []).length) compOk = false;
    sum.req += sess.modelRequests; sum.steps += s.headerSteps; sum.out += sess.tokens.output;
    sum.err += sess.toolErrors; sum.turns += sess.turns; sum.min += sess.stepMs.totalMin;
    sum.comp += (sess.compactions || []).length; sum.compReg += s.compReg; sum.compOt += s.compOT;
    sum.otSteps += s.ot.steps; sum.otOut += s.ot.out;
  });
  if (splitOk) ok("三场「正赛 + 加时 = trace 步数」自洽（97+44 / 149+54 / 77+47）");
  if (outOk) ok("三场「正赛输出 + 加时输出 = stats.json 输出 token」自洽");
  if (compOk) ok("三场「正赛折叠 + 加时折叠 = stats.json compactions 条数」自洽");
  chk(sum.req === 472 && sum.steps === 468 && sum.turns === 13, "合计：13 轮 / 472 模型请求 / 468 步", "合计口径不符: " + JSON.stringify(sum));
  chk(sum.out === 914450, "合计输出 token = 914,450", "合计输出 token ≠ 914,450（实为 " + sum.out + "）");
  chk(Math.abs(sum.min - 438.5) < 0.05, "合计模型工作时长 = 438.5 分", "合计工时 ≠ 438.5（实为 " + sum.min + "）");
  chk(sum.err === 36, "合计工具报错 = 36 次", "工具报错 ≠ 36（实为 " + sum.err + "）");
  chk(sum.comp === 18 && sum.compReg === 10 && sum.compOt === 8, "压缩次数权威口径：含加时 18 = 正赛 10 + 加时 8", "压缩口径不符: " + sum.comp + " / " + sum.compReg + " / " + sum.compOt);
  chk(sum.otSteps === 145 && sum.otOut === 198084, "加时窗口合计 145 步 / 198,084 输出 token", "加时合计不符: " + sum.otSteps + " / " + sum.otOut);
  // 报错也要两头对平：正赛 + 加时 = stats.json 的 toolErrors
  let errPhaseOk = true, errReg = 0, errOt = 0;
  keys.forEach((k) => {
    const s = D.splits[k], sess = D.stats[k].sessions[0];
    if ((s.errReg || 0) + (s.errOT || 0) !== sess.toolErrors) { errPhaseOk = false; bad(k + " 报错两栏 " + s.errReg + "+" + s.errOT + " ≠ stats " + sess.toolErrors); }
    errReg += s.errReg || 0; errOt += s.errOT || 0;
  });
  if (errPhaseOk) ok("工具报错按阶段拆分闭合：正赛 " + errReg + " + 加时 " + errOt + " = 36");
}
if (D && D.timeCost && D.timeCost.runs) {
  let catOk = true, shareOk = true;
  Object.keys(D.timeCost.runs).forEach((k) => {
    const r = D.timeCost.runs[k];
    const n = r.categories.reduce((a, c) => a + c.stepCount, 0);
    if (n !== r.stepCount) { catOk = false; bad(k + " 各类别步数之和 " + n + " ≠ stepCount " + r.stepCount); }
  });
  if (catOk) ok("timeCost 各类别步数之和 = 该场步数（归类无重复无遗漏）");
  const want = { "land-gui2": 36.8, "bomberman-gui1": 16.1, "ctf-gui1": 30.4 };
  Object.keys(want).forEach((k) => { if (D.timeCost.runs[k].longSharePct !== want[k]) shareOk = false; });
  chk(shareOk, "长考步占比：圈地 36.8% / 炸弹人 16.1% / 夺旗 30.4%", "长考步占比与 time-cost.md 不一致");
}
if (D && D.clocks) {
  const t = D.clocks.totals;
  chk(t.n === 30 && t.main + t.over === t.n && t.solo + t.ride === t.n && t.direct + t.wrap === t.n,
    "看表合计 30 次，且 正赛+加时 / 单独+夹带 / 直调+包装 三种分法各自闭合", "clocks totals 不闭合: " + JSON.stringify(t));
  const per = Object.keys(D.clocks.runs).map((k) => k + ":" + D.clocks.runs[k].n).join(" ");
  const exp = { "ctf-gui1": 20, "land-gui2": 7, "bomberman-gui1": 3 };
  chk(Object.keys(exp).every((k) => D.clocks.runs[k] && D.clocks.runs[k].n === exp[k]),
    "分场看表：夺旗 20 / 圈地 7 / 炸弹人 3（" + per + "）", "分场看表次数与 clock-reads.json 对不上: " + per);
  const listOk = Object.keys(D.clocks.runs).every((k) => D.clocks.runs[k].reads.length === D.clocks.runs[k].n);
  chk(listOk, "每条看表记录都在（reads 长度 = 该场次数，页面可复算密集段与空档）", "reads 明细与计数不符");
}
if (D && D.full && D.ctfFaults) {
  const F = D.full, CF = D.ctfFaults, sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  chk(!!F.land.main && !!F.ctf.main && !!(F.bomb || {}).ctl_ctlmain,
    "圈地 / 夺旗 / 炸弹人的大样本正赛版都已到位（成绩页两端同尺度）", "还有一场只测到加时终版");
  ["main", "ot"].forEach((ph) => {
    const f = CF[ph] || {}, g = (F.ctf[ph] || {}).faults;
    chk(sum(f.byTier) === f.total && f.total === g,
      "夺旗 " + ph + " 段错误 " + f.total + " 局：逐局分档求和 = 总数 = 成绩表「故障局」列",
      "分档合计 " + sum(f.byTier) + " / 逐局 " + f.total + " / 成绩表 " + g);
    chk(sum(f.gamesByTier) === (F.ctf[ph] || {}).games,
      "夺旗 " + ph + " 逐局记录 " + sum(f.gamesByTier) + " 局 = 成绩表 " + (F.ctf[ph] || {}).games + " 局", "局数对不平");
  });
  // 这两句是 README 与稿子里的结论级措辞，分档一变就得改文案，所以钉在这里
  chk(Object.keys(CF.main.byTier || {}).join() === "13",
    "「正赛版崩的 13 局全在十三方档」这句仍成立", "分档已变成 " + Object.keys(CF.main.byTier || {}).join("/"));
  chk(Object.keys(CF.ot.byTier || {}).length > 1,
    "「加时终版崩的局分散在多档」这句仍成立", "加时终版只剩单档：" + Object.keys(CF.ot.byTier || {}).join("/"));
  // 三向拆解：每条只动一个变量，缺一条第 19 页的小字就念不出来
  const nz = (F.bomb || {}).noise || {}, bn = D.bombNoise || {};
  chk(!!(nz.code && nz.schedule && nz.workers),
    "炸弹人三向拆解在库：代码 " + (nz.code || {}).bt + " / 赛程 " + (nz.schedule || {}).bt + " / 并发 " + (nz.workers || {}).bt + " 分",
    "缺 bomb.noise 的某一项");
  chk(bn.differ > 0 && bn.common === 490,
    "炸弹人同赛程只差并发的逐局比对已入库：" + bn.common + " 局里 " + bn.differ + " 局终分不同",
    "缺 data/bomb-noise.json 或局数不对（应先跑 pipeline/bomb-noise.mjs）");
}

// ---------- 4/5 无浏览器渲染断言 ----------
console.log("\n== 4/5 页面渲染（vm + DOM 桩，不开浏览器） ==");
const { default: vm } = await import("node:vm");
let pages = [];
if (D) {
  pages = renderPages(D, scriptSrc);
  // 页数不写死：从 src/p_script.js 的 PAGES 表数出来。加一页时如果忘了同步 README / 字幕，
  // 下面两条断言会各自报出来；写死数字只会让闸门跟着页面一起改，等于没guard。
  const NPAGE = (scriptSrc.match(/\{\s*cap:/g) || []).length;
  chk(NPAGE > 0 && pages.length === NPAGE,
    "渲染页数 " + pages.length + " = p_script.js 里 PAGES 的 " + NPAGE + " 条",
    "页数 = " + pages.length + "，源码 PAGES 有 " + NPAGE + " 条 —— index.html 大概没重建（跑 node build.mjs）");
  const dirty = [];
  pages.forEach((p, i) => {
    ["undefined", "NaN", "[object Object]", "待补", "进行中", "占位"].forEach((w) => {
      if (p.html.includes(w)) dirty.push("第 " + (i + 1) + " 页含「" + w + "」");
    });
  });
  chk(dirty.length === 0, NPAGE + " 页渲染文本无 undefined/NaN/待补/进行中/占位", dirty.join("；"));
  // 屏幕字预算：.screen 里的可见文字 ≤80 字符/页。kicker、图表轴标签、页脚 mini 不计入——
  // 真正的溢出门槛是 layout.mjs（等 fonts.ready 后量底边），这条只管"别把口播印在屏幕上"。
  const SCRIPT = has("script/口播稿.md") ? rd("script/口播稿.md") : "";
  const all = pages.map((p) => p.html).join(" ");
  const wide = [];
  pages.forEach((p, i) => {
    const m = /<div class="tagline screen">([\s\S]*?)<\/div>/.exec(p.html);
    if (!m) { wide.push("第 " + (i + 1) + " 页没有 .screen 屏幕字块"); return; }
    const n = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    if (n > 80) wide.push("第 " + (i + 1) + " 页屏幕字 " + n + " 字符");
  });
  chk(wide.length === 0, "每页屏幕字 ≤80 字符（.screen 内文字，图表标签与 kicker 不计）", wide.join("；"));
  const mustInPage = ["914,450", "468", "472", "memcpy(R.flame, FL,", "1250", "91.1", "103.2",
    "−327", "−313", "58.47", "103.43", "125.64", "6.4"];
  // 只留可见文字再匹配。SVG 的坐标属性全是长小数（width="484.7800237812128" 里就含 "4.7"），
  // 拿成绩数字去整页 HTML 做子串匹配会误命中——这条断言原先就是靠运气通过的。
  const strip = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, (m) => m.replace(/<[^>]*>/g, " ")).replace(/<[^>]*>/g, " ");
  const allTxt = pages.map((p) => strip(p.html)).join(" ");
  const missPage = mustInPage.filter((s) => !allTxt.includes(s));
  chk(missPage.length === 0, "两本账 / memcpy / 看表的关键读数必须自己在页面上", "页面缺关键数字: " + missPage.join(" / "));
  // 成绩页必须显示大样本那一版的数字。小样本旧数一旦回到标题位就是口径漂移；
  // 稿尾第 16 条把 4.7 / 4.9 / −202 / −49 / 144.54 留作对照是允许的，所以这条只查页面。
  const num = (v) => String(v).replace("-", "−");
  const B = (D.full.bomb || {});
  const scale = [[5, D.full.land.main.score, 4.7], [6, D.landAreas.main.mine, 427],
    [9, B.ctl_ctlmain && B.ctl_ctlmain.bt, 56.44], [11, B.ctl_ctlot && B.ctl_ctlot.bt, 144.54],
    [14, D.full.ctf.main.bt, -202], [17, D.full.ctf.ot.bt, -49]];
  const stale = [];
  scale.forEach(([i, want, old]) => {
    const h = strip((pages[i] || {}).html || "");
    if (!h.includes(num(want))) stale.push("第 " + (i + 1) + " 页没出现大样本 " + num(want));
    if (h.includes(num(old))) stale.push("第 " + (i + 1) + " 页仍写着小样本旧数 " + num(old));
  });
  chk(stale.length === 0, "成绩页读大样本（第 6 / 7 / 10 / 12 / 15 / 18 页），小样本旧数不许回到页面", stale.join("；"));
  // 三场各两张横比柱：交卷页一张（本机 vs 同表），加时页一张（还要正赛版与加时终版两根条同框）。
  // 只数 <svg> 里的条形与 <text> 标签——页面小字里也会提到对手名，拿整页文字做子串匹配会假通过。
  const PEER = [["land", "main", 5], ["land", "ot", 7], ["bomb", "main", 9], ["bomb", "ot", 11], ["ctf", "main", 14], ["ctf", "ot", 17]];
  const CTLK = { main: "ctl_ctlmain", ot: "ctl_ctlot" };
  const inSvg = (h) => (h.match(/<svg[\s\S]*?<\/svg>/g) || []).join("\n");
  const pk = [];
  PEER.forEach(([g, ph, i]) => {
    const svg = inSvg((pages[i] || {}).html || "");
    const src = (D.full[g] || {})[g === "bomb" ? CTLK[ph] : ph] || {};
    const names = Object.keys(src.ratings || {}).filter((n) => n !== "本地 27B");
    const meN = ph === "ot" ? 2 : 1, want = names.length + meN;
    const bars = (svg.match(/class="bar"/g) || []).length;
    if (bars !== want) pk.push("第 " + (i + 1) + " 页横比柱画了 " + bars + " 根，应为 " + want + " 根（" + names.length + " 家对手 + " + meN + " 根本机）");
    const miss = names.filter((n) => svg.indexOf(">" + n + "<") < 0);
    if (miss.length) pk.push("第 " + (i + 1) + " 页柱子里没画出：" + miss.join(" / "));
    if (ph === "ot" && (!svg.includes("正赛交卷版") || !svg.includes("加时终版"))) pk.push("第 " + (i + 1) + " 页没把正赛版与加时终版两根条摆在一起");
  });
  chk(pk.length === 0, "三场六张同表横比柱齐备（按 <svg> 里的条形根数与标签数），加时那三张还要新旧两版本机同框", pk.join("；"));
  // 上面那条是同源计算的（期望值和页面都出自 challenge-full.json），抓不到"数据本身就少一家"。
  // 这条拿成绩表原文做独立核对：原文里的有名次数 = ratings 条目数。
  const named = (f) => {
    if (!has("data/full-src/" + f)) return null;
    return rd("data/full-src/" + f).split(/\r?\n##\s/)[0].split(/\r?\n/)
      .map((l) => l.split("|").map((x) => x.trim()))
      .filter((c) => /^\d+$/.test(c[1]) && c[2] && c[2] !== "模型" && c[2] !== "选手").length;
  };
  const vs = [];
  [["land", "main", "land-main-ratings.md"], ["land", "ot", "land-ot-ratings.md"],
   ["ctf", "main", "ctf-main-scores.md"], ["ctf", "ot", "ctf-ot-scores.md"]].forEach(([g, ph, f]) => {
    const n = named(f), have = Object.keys(((D.full[g] || {})[ph] || {}).ratings || {}).length;
    if (n === null) vs.push("缺 " + f);
    else if (n !== have) vs.push(g + "." + ph + " 解析出 " + have + " 家，原文表里有名次的 " + n + " 家");
  });
  chk(vs.length === 0, "横比柱的对手数与成绩表原文逐家对得上（独立于 challenge-full.json）", vs.join("；"));
  const banned = ["补时", "overtime-interruptions", "冻结式", "8 分 05 秒", "3 分 18 秒"];
  const hit = banned.filter((w) => all.includes(w));
  chk(hit.length === 0, "页面文案不含「补时」及停机补偿时长等被禁止的口径（崩溃只说「崩了一次、续跑」）", "页面出现禁词: " + hit.join(" / "));
  const missBoth = ["851", "313", "438.5"]
    .filter((s) => !allTxt.includes(s) && !SCRIPT.includes(s));
  chk(missBoth.length === 0, "其余细节「页面或稿子」至少一处命中即可（技术细节允许撤到简介/置顶）", "两头都没有: " + missBoth.join(" / "));
  const leak2 = [];
  pages.forEach((p, i) => {
    const t = p.html.replace(/<[^>]*>/g, "");
    if (/\/"|\brx=|\bclass=|\bopacity=/.test(t)) leak2.push("第 " + (i + 1) + " 页有属性泄漏成文字（标签没闭合）");
  });
  chk(leak2.length === 0, "SVG 标签全部闭合（多余 /> 会让 rx=\"3\" 泄漏成页面文字）", leak2.join("；"));
  const visible = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, (m) => m.replace(/<[^>]*>/g, " ")).replace(/<[^>]*>/g, " ").replace(/\s+/g, "").length;
  const over = [];
  pages.forEach((p, i) => {
    const n = visible(p.html);
    if (n > 1700) over.push("第 " + (i + 1) + " 页可见文字 " + n + " 字符");
  });
  chk(over.length === 0, "每页可见文字量仍在单屏预算内（≤1,700 字符/页，SVG 内只算标注）", "以下页可能溢出，需拆页或删冗余: " + over.join("；"));
  const caps = [];
  pages.forEach((p, i) => { if (!/<h1 class="title"|class="kicker"|class="bignum"/.test(p.html)) caps.push("第 " + (i + 1) + " 页没有 kicker/title"); });
  chk(caps.length === 0, "每页都有 kicker 或 title（录屏时页名与 HUD 对得上）", caps.join("；"));
}

// ---------- 5/5 文案与文档同步 ----------
console.log("\n== 5/5 配音文案与文档 ==");
if (has("dubbing/字幕.txt")) {
  const sub = rd("dubbing/字幕.txt");
  const lines = sub.split(/\r?\n/);
  const spoken = lines.filter((l) => /^\s*(\d+m?in)?\d*s?\s+\S/.test(l) && !/^\s*[#【]/.test(l));
  const timeOk = lines.filter((l) => l.trim() && !/^\s*[#【]/.test(l)).every((l) => /^(?:\d+min)?\d+s\s+\S/.test(l.trim()));
  chk(timeOk && spoken.length > 80, "字幕.txt 台词行格式合法（行首 Xs / XminYs，共 " + spoken.length + " 句）", "字幕有行首时间戳不合法的行");
  const body = lines.filter((l) => l.trim() && !/^\s*[#【]/.test(l));
  const marks = [];
  lines.forEach((l) => { const m = /第\s*(\d+)\s*页/.exec(l); if (m && /^\s*[#【]/.test(l)) marks.push(Number(m[1])); });
  // 末尾允许没有台词（静默落幕），但中间不许跳号：marks 必须正好是 1..k。
  const seqOk = marks.length > 0 && marks.every((n, i) => n === i + 1);
  chk(seqOk, "字幕.txt 页码标注从第 1 页连续到第 " + marks.length + " 页" +
    (marks.length < pages.length ? "（末尾 " + (pages.length - marks.length) + " 页无台词，静默落幕）" : "，与页面数一致"),
    "页码标注跳号或数量不符: " + marks.join(","));
  const bannedSub = ["补时", "overtime-interruptions"];
  const hitSub = bannedSub.filter((w) => sub.includes(w));
  chk(hitSub.length === 0, "字幕文案不含被禁止口径", "字幕出现禁词: " + hitSub.join(" / "));
  const stalePhrase = body.filter((l) => /待补|比赛进行中/.test(l));
  chk(stalePhrase.length === 0, "台词行（跳过分节注释）里已无「待补 / 比赛进行中」", "仍有待补口径: " + stalePhrase.join(" / ").slice(0, 120));
} else bad("dubbing/字幕.txt 缺失");
if (has("README.md")) {
  const rm = rd("README.md");
  const rows = (rm.match(/^\| (\d{2}) \|/gm) || []).map((s) => Number(s.slice(2, 4)));
  chk(rows.length === pages.length, "README 页面清单行数 = " + rows.length + "，与渲染页数一致", "README 清单 " + rows.length + " 行 ≠ 页数 " + pages.length);
  chk(rows.every((n, i) => n === i + 1), "README 页码从 01 连续编号", "README 页码不连续");
  chk(!/补时/.test(rm), "README 不含被禁止口径", "README 出现禁词「补时」");
  chk(/clock-reads\.json/.test(rm) && /time-cost\.json/.test(rm) && /compaction-counts\.md/.test(rm) &&
      /challenge-full\.json/.test(rm) && /ctf-faults\.json/.test(rm), "README 目录结构已登记新增数据件", "README 未登记新增数据件");
} else bad("README.md 缺失");
const cuts = has("pipeline/cuts.json") ? JSON.parse(rd("pipeline/cuts.json")) : null;
if (!cuts) bad("pipeline/cuts.json 缺失");
else if (!cuts.clips.length) no("pipeline/cuts.json clips 为空（还没有实机录屏，属预期状态）");
else ok("pipeline/cuts.json 已登记 " + cuts.clips.length + " 段录屏");
chk(existsSync("$PROJECT_ROOT/NotoSansSC-Regular.otf"), "中文字体（绝对路径引用）在位", "NotoSansSC-Regular.otf 找不到，页面会掉字体");

console.log("\n结果: " + pass + " 通过 / " + warn + " 警告 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

// ---------- DOM 桩渲染 ----------
function renderPages(data, src) {
  const pages = [];
  const mk = () => {
    const el = { className: "", dataset: {}, _html: "", style: { setProperty() {} },
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      appendChild() {}, querySelector() { return mk(); }, querySelectorAll() { return []; }, textContent: "" };
    Object.defineProperty(el, "innerHTML", { get() { return this._html; }, set(v) { this._html = v; } });
    return el;
  };
  const stage = { appendChild(el) { if (el._html) pages.push({ cls: el.className, html: el._html }); }, querySelectorAll() { return []; } };
  const hud = mk();
  hud.firstElementChild = { style: {} };
  const doc = { createElement: mk, addEventListener() {}, querySelector: (s) => (s === "#stage" ? stage : hud),
    documentElement: { style: { setProperty() {} } }, body: { classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } } } };
  const ctx = vm.createContext({ window: { __DATA__: data }, document: doc, console: { log() {}, warn() {}, error() {} },
    location: { search: "" }, performance: { now: () => 0 }, requestAnimationFrame: () => {} });
  vm.runInContext(src, ctx, { filename: "p_script.js" });
  return pages;
}
