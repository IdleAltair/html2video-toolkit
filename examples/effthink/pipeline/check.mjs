// arena-effthink 全量体检：构建一致性 + 数据口径交叉校验 + 无浏览器渲染断言 + 文案/文档同步
// 用法: node pipeline/check.mjs
// 说明: 全程静态检查（node + vm 里的 DOM 桩），不使用任何浏览器工具、不跑 ffmpeg、不计分。
// 本页数据只有三件：data/model-compare.json（唯一读数源）、data/iterations.csv、data/iterations-stats.json。
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
if (!has("index.html")) bad("index.html 缺失 → node build.mjs");
else {
  const html = rd("index.html");
  chk(html.includes(scriptSrc), "index.html 内嵌的 p_script.js 与构建源逐字一致", "index.html 里的脚本段与 src/p_script.js 不一致 → 重跑 node build.mjs");
  chk(html.includes("</style>") && html.includes('id="stage"') && html.includes('id="sea"'), "index.html 结构完整（样式 / stage / 沉海落幕）", "index.html 缺结构件");
  const staleParts = PARTS.filter((p) => statSync(R("src/" + p)).mtimeMs > statSync(R("index.html")).mtimeMs);
  chk(staleParts.length === 0, "产物不比构建源旧", "以下源文件比 index.html 新，需重建: " + staleParts.join(", "));
  // 停机补偿时长属组织方内部审计口径，一律不得随 __DATA__ 进产物：直接扫成品文件
  const leak = ["补时", "overtime-interruptions", "补偿时长", "冻结"].filter((w) => html.includes(w));
  chk(leak.length === 0, "index.html 成品原文（含 __DATA__ 数据块）不含补时口径", "产物里漏进了禁词: " + leak.join(" / "));
}

// ---------- 2/5 __DATA__ 与数据来源 ----------
console.log("\n== 2/5 __DATA__ 与数据来源 ==");
const html = has("index.html") ? rd("index.html") : "";
// __DATA__ 与 __AVA__ 在同一个 <script> 里，非贪婪正则会在 JSON 之后把 AVA 的赋值一起截进来；
// 这里按括号配对取，遇到字符串内的括号与转义不算。
function grabBalanced(text, from) {
  let depth = 0, i = from, inStr = false, esc = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) return text.slice(from, i + 1); }
  }
  return null;
}
let D = null;
const dm = /window\.__DATA__\s*=\s*/.exec(html);
if (!dm) bad("index.html 里没有 window.__DATA__ 注入块");
else {
  const json = grabBalanced(html, dm.index + dm[0].length);
  if (!json) bad("__DATA__ 花括号不配对，注入块被截断");
  else { try { D = JSON.parse(json); ok("__DATA__ 注入块可解析（" + json.length + " B）"); } catch (e) { bad("__DATA__ JSON 解析失败: " + e.message); } }
}
// 头像表也是 build 时内联进同一个 <script> 的；vm 渲染要拿到它，否则「每根柱都有头像」在桩里永远数是 0
const AVAS = (() => {
  const mark = "window.__AVAS__=", i = html.indexOf(mark);
  if (i < 0) return {};
  try { return JSON.parse(grabBalanced(html, i + mark.length)); } catch (e) { return {}; }
})();
chk(Object.keys(AVAS).length > 15, "头像表已内联（成绩表与柱图的头像都取自这张表）",
  "只内联了 " + Object.keys(AVAS).length + " 张，检查 build.mjs 的 AVA_MAP");
const DATA_FILES = ["data/model-compare.json", "data/iterations.csv", "data/iterations-stats.json"];
const missData = DATA_FILES.filter((f) => !has(f));
chk(missData.length === 0, "data/ 三件读数源齐全（" + DATA_FILES.join(" / ") + "）", "data/ 缺: " + missData.join(", "));
chk(has("data/overtime-interruptions.md") === false, "审计台账 overtime-interruptions.md 没有被复制进本工程", "data/ 里出现了 overtime-interruptions.md，不该进视频工程");
chk(has("data/prev-round-q5kxl") && has("archive/prev-27pages"), "上一轮数据与旧 27 页画面都归档在工程内（迁移只移动不删除）", "缺 data/prev-round-q5kxl/ 或 archive/prev-27pages/");
if (D) {
  const want = ["models", "invariants", "scores", "behavior", "overtime", "reproducibility", "media", "caveats", "peers"];
  const miss = want.filter((k) => !D.compare || !D.compare[k]);
  chk(miss.length === 0, "compare 九大块齐全（含本轮对手榜 peers）", "compare 缺: " + miss.join(", "));
  const eps = ["land", "bomberman", "ctf"];
  chk(eps.every((e) => D.compare.scores[e] && D.compare.scores[e].prev && D.compare.scores[e].cur),
    "三集都有 prev / cur 两端读数", "有一集缺 prev 或 cur");
  chk(D.compare.scores.ctf.cur.overtime != null && D.compare.scores.land.curOvertime != null,
    "夺旗与圈地的加时终版成绩已入库（炸弹人加时未改代码，不必单列一版）", "缺加时终版读数");
  chk((D.compare.behavior.rows || []).length === 6, "behavior.rows = 6（三集 × 两轮）", "behavior.rows 实为 " + (D.compare.behavior.rows || []).length);
  chk(eps.every((e) => D.compare.peers[e] && D.compare.peers[e].rows.length), "peers 三集对手榜都在", "peers 缺场次");
}

// ---------- 3/5 数字口径交叉校验 ----------
console.log("\n== 3/5 数字口径交叉校验 ==");
if (D) {
  const C = D.compare, IT = D.iters || [], IS = D.itersStats || {};
  // 台账计数只允许由 iter-stats.mjs 复算，页面不许手抄；这条把它和 CSV 再对一次
  const attempts = IT.filter((r) => r.kind === "改动").length;
  const keep = IT.filter((r) => r.verdict === "KEEP").length;
  const rb = IT.filter((r) => r.verdict === "ROLL BACK").length;
  chk(IT.length === IS.totalRows && attempts === IS.attempts && keep === IS.keep && rb === IS.rollback,
    "台账闭合：CSV " + IT.length + " 行 = stats.totalRows，改动 " + attempts + " / 留下 " + keep + " / 撤回 " + rb,
    "CSV 与 iterations-stats.json 不一致: " + IT.length + "/" + IS.totalRows + " " + attempts + "/" + IS.attempts);
  const byEpSum = Object.values(IS.byEp || {}).reduce((a, x) => a + x.attempts, 0);
  chk(byEpSum === IS.attempts, "按集拆分之和 = 总尝试次数（" + byEpSum + "）", "byEp 合计 " + byEpSum + " ≠ attempts " + IS.attempts);
  const kinds = Object.entries(IS.kinds || {}).reduce((a, [k, v]) => a + v, 0);
  chk(kinds === IS.totalRows, "kind 分布之和 = 总行数", "kind 合计 " + kinds + " ≠ " + IS.totalRows);
  // 表格用的短读数必须与同一行的长读数对得上：炸弹人跑了两遍加时、轮次同名（R1..R4），
  // 早先按 (ep, round) 映射短读数，第二遍的表格就串成了第一遍的数。
  const norm = (x) => String(x).replace(/−/g, "-").replace(/\s+/g, "").toLowerCase();
  const crossTalk = [];
  IT.forEach((r, i) => {
    const hay = norm([r.change, r.params, r.selfplay_reading, r.verdict_basis, r.note].join(" "));
    (String(r.reading_short).match(/-?\d+(?:\.\d+)?/g) || []).forEach((n) => {
      if (!hay.includes(norm(n))) crossTalk.push("第" + (i + 2) + "行 " + r.ep + "/" + r.round + "：短读数「" + r.reading_short + "」的 " + n + " 不在本行长文本里");
    });
  });
  chk(crossTalk.length === 0, "台账短读数与同行长读数一一对得上（防两遍加时串味）", crossTalk.slice(0, 3).join("；"));
  // 行为表：每集两轮的 outputTok 差必须与页面口径一致（页面用 bsum 现算，这里独立复算）
  const bsum = (round, f) => C.behavior.rows.filter((r) => r.round === round).reduce((a, r) => a + r[f], 0);
  const outP = bsum("prev", "outputTok"), outC = bsum("cur", "outputTok");
  chk(outP === 914450 && outC === 698977,
    "三集合计输出 token：上一轮 914,450 → 本轮 698,977（" + ((outC / outP - 1) * 100).toFixed(1) + "%）",
    "合计 token 口径变了: " + outP + " / " + outC + " —— 第 16 页的文案要同步");
  chk(bsum("prev", "requests") === 472 && bsum("cur", "requests") === 398,
    "三集合计模型请求：472 → 398 次", "请求合计 " + bsum("prev", "requests") + " / " + bsum("cur", "requests"));
  // 每集的 tokPerReq × requests 与 outputTok 同量级（口径自检，抓填错的行）
  let ratioOk = true;
  C.behavior.rows.forEach((r) => {
    if (Math.abs(r.tokPerReq * r.requests - r.outputTok) > r.outputTok * 0.02) {
      ratioOk = false; bad(r.ep + "." + r.round + " tokPerReq×requests=" + (r.tokPerReq * r.requests) + " 与 outputTok " + r.outputTok + " 差超 2%");
    }
  });
  if (ratioOk) ok("每行 tokPerReq × requests ≈ outputTok（2% 内），行为表自洽");
  // 成绩两端与对手榜必须同源：本机在榜上的那一次必须等于 scores 里的读数
  const pairs = [["bomberman", "bt", "main", 2], ["ctf", "main", "main", 3], ["land", "main", "main", 1]];
  let same = true;
  pairs.forEach(([ep, field, ph, dec]) => {
    const row = (C.peers[ep].rows || []).find((r) => /your-bot|你的 bot/.test(r.name));
    const want = Number(C.scores[ep].cur[ph]).toFixed(dec);
    if (Number(row[field]).toFixed(dec) !== want) { same = false; bad(ep + " 榜上 " + row[field] + " ≠ scores." + ph + " " + want); }
  });
  if (same) ok("本机读数在 scores 与 peers 两处一致（成绩页与对手榜同源）");
  // 名次分正赛与加时两个字段：第 11 页曾把加时终版的 11/12 当成正赛名次念
  const cr = C.scores.ctf.cur;
  chk(cr.rankMain === C.peers.ctf.us.rankMain && cr.rankOvertime === C.peers.ctf.us.rankOvertime,
    "夺旗名次拆成 rankMain / rankOvertime 且与对手榜一致（" + cr.rankMain + " → " + cr.rankOvertime + "）",
    "名次字段与 peers 不一致，成绩页会念错名次");
  // 夺旗两次漂移：对手极值与中位必须能由 rows 复算，页面那句「超出范围两倍」才站得住
  const dr = (C.peers.ctf.rows || []).filter((r) => !/你的 bot/.test(r.name)).map((r) => r.overtime - r.main);
  const med = dr.slice().sort((a, b) => a - b)[Math.floor(dr.length / 2)];
  const ds = C.peers.ctf.driftStats || {};
  chk(dr.length === ds.rivals && Math.min(...dr) === ds.min && Math.max(...dr) === ds.max && med === ds.median,
    "夺旗 " + dr.length + " 家对手两次漂移 " + ds.min + " ~ +" + ds.max + "、中位 +" + ds.median + " 可复算",
    "漂移统计复算不符: n=" + dr.length + " min=" + Math.min(...dr) + " max=" + Math.max(...dr) + " median=" + med);
  const td = C.peers.ctf.tierDiff || {};
  chk(Object.keys(td).length === 8 && Object.values(td).every((v) => v > 0),
    "夺旗八个分档两次之差全为正（页面「八档全涨」这句仍成立）", "有档不为正: " + JSON.stringify(td));
  // 圈地加时的配对：本机在场与同代码对照组，两者差异率都必须能由分母复算
  const pr = C.scores.land.curOvertime.pair || {};
  const rate = (o) => Number((o.differ / o.games * 100).toFixed(1));
  chk(rate(pr.withUs) === pr.withUs.rate && rate(pr.sameCode) === pr.sameCode.rate,
    "圈地配对差异率可复算：" + pr.withUs.rate + "%（" + pr.withUs.differ + "/" + pr.withUs.games + "）对 " +
    pr.sameCode.rate + "%（" + pr.sameCode.differ + "/" + pr.sameCode.games + "）",
    "配对率复算不符: " + rate(pr.withUs) + " / " + rate(pr.sameCode));
  chk(pr.floorPct === pr.sameCode.rate, "圈地可检出下限 = 同代码对照组差异率", "floorPct " + pr.floorPct + " ≠ 对照组 " + pr.sameCode.rate);
  // 两个模型的参数量必须完全相同，否则第 2 页「差的是量化档」这句就错了
  const m = C.models;
  chk(m["prev-q5kxl"].paramsB === m["cur-q4"].paramsB && m["prev-q5kxl"].tensors === m["cur-q4"].tensors,
    "两模型参数量与张量数完全相同（" + m["prev-q5kxl"].paramsB + " B / " + m["prev-q5kxl"].tensors + " 张量）",
    "参数量或张量数不相等，第 2 页文案要改");
  // —— 21 页版新增：两模型并表的前提与逐家标注 ——
  const CMP = C.comparability || {};
  const PBk = (ep) => (C.peers || {})[ep] || {};
  chk(CMP.samePool === true && (CMP.evidence || []).length >= 3,
    "两轮对手池同一批源码，且证据不止一条（并表的唯一前提）", "comparability 缺或不成立，成绩表不许并排");
  const noTag = [];
  ["land", "bomberman", "ctf"].forEach((ep) => {
    (PBk(ep).rows || []).forEach((r) => { if (!r.tool || r.q5 == null) noTag.push(ep + "/" + r.name); });
    if (!PBk(ep).q5Us) noTag.push(ep + " 缺 q5Us 本机对照");
  });
  chk(noTag.length === 0, "三集对手榜逐家都有外壳与 Q5_K_XL 那一次的分数", "缺标注: " + noTag.join(" / "));
  const bpBad = [];
  ["prev-q5kxl", "cur-q4"].forEach((k) => {
    const mm = C.models[k];
    const want = (mm.sizeGB * 8) / mm.paramsB;
    if (Math.abs(mm.bitsPerParam - want) > 0.01) bpBad.push(k + " 记 " + mm.bitsPerParam + " 应为 " + want.toFixed(2));
    if (!mm.service || !mm.service.ctx || !mm.service.mtpTokS) bpBad.push(k + " 缺服务参数或实测速度");
  });
  chk(bpBad.length === 0, "平均比特数 = 文件大小×8/参数量，且两模型都有服务参数与实测 tok/s", bpBad.join("；"));
  chk(!!(C.harness && C.harness.preset && C.harness.route), "外壳信息齐（预设名与本地路由都在）", "harness 缺字段");
  // 服务端 .bat 的 --reasoning-effort 两轮不同，但 dsh 请求侧带 max（=xhigh）会覆盖它 → 不是变量。
  // 早先把它列进 caveats 当混淆项，是错的；这条断言防止再被写回去。
  const sd = C.serviceDelta || {};
  const sdFlat = (sd.different || []).map((x) => (typeof x === "string" ? x : [x.item, x.why].join(" "))).join(" ");
  chk(sdFlat.indexOf("reasoning-effort") < 0 &&
      /max/.test(sd.notAVariable || "") && (sd.same || []).join(" ").indexOf("xhigh") > 0,
    "reasoning-effort 已归到非变量（dsh 的 max 档覆盖服务端默认）",
    "serviceDelta 又把 reasoning-effort 当变量了，或没写清覆盖关系");
  chk((sd.different || []).every((x) => typeof x !== "object" || x.onScreen === false),
    "MTP 草稿深度这类参数差只留档、标了不进画面", "有一条参数差没标 onScreen:false");
  const VOL = C.volume || {};
  chk(VOL.land.duelGames + VOL.land.meleeGames === C.scores.land.games &&
    VOL.bomberman.games === C.scores.bomberman.games && VOL.ctf.games === C.scores.ctf.games,
    "事实卡里的对局量与成绩页同源（圈地 " + VOL.land.duelGames + "+" + VOL.land.meleeGames + " = " + C.scores.land.games + "）",
    "对局量与 games 字段对不上");
  chk((C.scores.land.prev.duelStats || {}).avgArea > 0 && (C.scores.ctf.prev.bySizeMain || {})["2"] < 0,
    "两个模型同表对比页所需的 prev 统计已入库", "prev 的分项统计缺失");
  const mixSum = (mm) => Object.values(mm.quantMixByParams).reduce((a, b) => a + b, 0);
  chk(Math.abs(mixSum(m["prev-q5kxl"]) - 100) < 0.6 && Math.abs(mixSum(m["cur-q4"]) - 100) < 0.6,
    "量化构成的占比之和 ≈ 100%", "构成占比之和: " + mixSum(m["prev-q5kxl"]) + " / " + mixSum(m["cur-q4"]));
}

// ---------- 4/5 无浏览器渲染断言 ----------
console.log("\n== 4/5 页面渲染（vm + DOM 桩，不开浏览器） ==");
const CRNAME = "Coder390", Q5NAME = "Q5_K_XL";
const PB2 = (ep) => (((D || {}).compare || {}).peers || {})[ep] || {};
const { default: vm } = await import("node:vm");
let pages = [];
if (D) {
  pages = renderPages(D, scriptSrc, AVAS);
  const NPAGE = (scriptSrc.match(/\{\s*cap:/g) || []).length;
  chk(NPAGE > 0 && pages.length === NPAGE,
    "渲染页数 " + pages.length + " = p_script.js 里 PAGES 的 " + NPAGE + " 条",
    "页数 = " + pages.length + "，源码 PAGES 有 " + NPAGE + " 条 —— index.html 大概没重建（跑 node build.mjs）");
  const CAPS = [...scriptSrc.matchAll(/\{ cap: "([^"]+)"/g)].map((m) => m[1]);
  const pg = (kw) => {
    let i = CAPS.indexOf(kw);
    if (i < 0) i = CAPS.findIndex((c) => c.startsWith(kw));
    if (i < 0) { bad("画面里没有 cap「" + kw + "」这一页，后续按 cap 定位的断言全部作废"); throw new Error("闸门里点了个不存在的页：「" + kw + "」"); }
    return i;
  };
  chk(pages.length === CAPS.length && CAPS.length === 26,
    "页数 26 = PAGES 的 cap 条数（三场交卷页各含表格与柱图两态，不再单列一页）",
    "渲染 " + pages.length + " 页 / cap " + CAPS.length + " 条，PLAN 与画面已不同步");
  const dupCap = CAPS.filter((c, i) => CAPS.indexOf(c) !== i);
  chk(dupCap.length === 0, "26 个 cap 互不重复（pg() 按 cap 找页才不会串）", "重复 cap: " + dupCap.join(" / "));
  // 只扫文本：头像的 base64 里出现 NaN / undefined 这类子串是巧合，不是画面上的脏值
  const strip = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, (m) => m.replace(/<[^>]*>/g, " ")).replace(/<[^>]*>/g, " ");
  // 只扫文本：头像 base64 里出现 NaN / undefined 这类子串是巧合，不是画面上有脏值
  const dirty = [];
  pages.forEach((p, i) => {
    ["undefined", "NaN", "[object Object]", "待补", "进行中", "占位", "null"].forEach((w) => {
      if (strip(p.html).includes(w)) dirty.push("第 " + (i + 1) + " 页含「" + w + "」");
    });
  });
  chk(dirty.length === 0, NPAGE + " 页渲染文本无 undefined/NaN/[object Object]/null/待补", dirty.join("；"));
  const wide = [];
  pages.forEach((p, i) => {
    const ms = [...p.html.matchAll(/<div class="tagline screen">([\s\S]*?)<\/div>/g)];
    if (!ms.length) { wide.push("第 " + (i + 1) + " 页没有 .screen 屏幕字块"); return; }
    ms.forEach((m) => {
      const n = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
      if (n > 80) wide.push("第 " + (i + 1) + " 页一段屏幕字 " + n + " 字符");
    });
  });
  chk(wide.length === 0, "每段屏幕字 ≤80 字符（两态各算一段，图表标签与 kicker 不计）", wide.join("；"));
  // reproducibility 那几段在数据件里是 markdown，星号必须在渲染前剥掉（数据块里带星号是允许的）
  const stars = [];
  pages.forEach((p, i) => { if (/\*\*/.test(strip(p.html))) stars.push("第 " + (i + 1) + " 页"); });
  chk(stars.length === 0, "页面可见文本里没有 markdown 星号", stars.join("；") + " 泄漏了星号");
  const swapLeft = [];
  pages.forEach((p, i) => { if (/class="swap"|class="sA"|class="sB"|stageMark/.test(p.html)) swapLeft.push("第 " + (i + 1) + " 页"); });
  chk(swapLeft.length === 0 && !/function swap\(/.test(scriptSrc), "旧换图槽（.swap / .sA / .sB / stageMark）不留残骸，换画法改由 .panes 两态承担", swapLeft.join("；") + " 还留着旧换图槽");
  const paneBad = [];
  pages.forEach((p, i) => {
    const n = (p.html.match(/class="pane (tb|bb)"/g) || []).length;
    const st = (p.html.match(/class="pane bb"[^>]*data-stage/g) || []).length;
    if (n === 0) return;
    if (n !== 2) paneBad.push("第 " + (i + 1) + " 页有 " + n + " 个 pane，两态必须成对");
    if (st !== 1) paneBad.push("第 " + (i + 1) + " 页的柱图态没挂 data-stage");
  });
  chk(paneBad.length === 0, "带 .panes 的页一律两态成对，柱图态带 data-stage", paneBad.join("；"));
  const vizThin = [];
  pages.forEach((p, i) => {
    const svg = (p.html.match(/<svg[\s\S]*?<\/svg>/g) || []).join("");
    if (!svg) return;
    const fs = [...svg.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    if (fs.length && Math.min.apply(null, fs) < 17) vizThin.push("第 " + (i + 1) + " 页图里最小字号 " + Math.min.apply(null, fs) + " 单位");
  });
  chk(vizThin.length === 0, "图里最小字号 ≥17 个 viewBox 单位（铺满宽后折算约 ≥24px）", vizThin.join("；"));
  const allTxt = pages.map((p) => strip(p.html)).join(" ");
  const mustInPage = ["239.82", "58.47", "−385", "−256", "−346", "17.6", "18.3", "6.4", "27.3",
    "914,450", "698,977", "八档全涨", "未改一行", "Coder390", "Q5_K_XL", "低于 greedy", "外壳", "思考档"];
  const missPage = mustInPage.filter((s) => !allTxt.includes(s));
  chk(missPage.length === 0, "关键读数与两句核心表述必须自己在页面上", "页面缺: " + missPage.join(" / "));
  // 名次不许串页：夺旗交卷页（第 12 页）只报交卷那次，加时页（第 15 页）才报 11/12
  const txt = (i) => strip(((pages[i] || {}).html || "")).replace(/\s+/g, "");
  const rankBad = [];
  if (!txt(pg("夺旗 · 交卷成绩")).includes("−385")) rankBad.push("夺旗表页没有交卷版读数 −385");
  if (!txt(pg("夺旗 · 交卷成绩")).includes("−346")) rankBad.push("夺旗表页没有 Q5_K_XL 那次的 −346");
  if (txt(pg("夺旗 · 交卷成绩")).includes("11/12")) rankBad.push("夺旗表页串进了加时名次 11/12");
  if (!txt(pg("夺旗 · 加时终版")).includes("11/12")) rankBad.push("夺旗加时终版页没写名次 11/12");
  chk(rankBad.length === 0, "夺旗名次按页分开（第 12 页交卷 12/12、第 15 页加时 11/12）", rankBad.join("；"));
  // 第 13 页那句「八档里几档比 Q5_K_XL 高」必须按分档实测数出来（七档那句是加时终版比 Q5 的交卷，串到交卷页就错了）
  const CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const CT = D.compare.scores.ctf, hiT = Object.keys(CT.cur.bySizeMain).filter((k) => CT.cur.bySizeMain[k] > (CT.prev.bySizeMain || {})[k]).length;
  const otT = Object.keys(CT.cur.bySizeOvertime || {}).filter((k) => CT.cur.bySizeOvertime[k] > (CT.prev.bySizeMain || {})[k]).length;
  chk(txt(pg("夺旗 · 两个模型同表")).includes("八档里" + CN[hiT] + "档比"),
    "第 13 页的分档高低句与实测一致（交卷对交卷 " + hiT + "/8 档更高）",
    "第 13 页那句八档对比与数据不符，实测 " + hiT + " 档（加时终版对 Q5 交卷才是 " + otT + " 档）");
  // 对比表的两个模型列不许颠倒：按行名定位后逐位核对。
  // 只比"这行有没有这些数"是抓不到颠倒的（同源同出一张 json 时两边都在页面上），必须比位置。
  const sc2 = (v) => { const x = Number(v); const t = Math.abs(x) % 1 < 1e-9 ? String(Math.round(x)) : String(Number(x.toFixed(2))); return t.replace("-", "−"); };
  const pick = (o, p) => p.reduce((x, k) => (x == null ? x : x[k]), o);
  const rowNums = (pi, name) => {
    // 贪婪取到最后一个 </tbody>：夺旗那张同表拆了两栏（11 行的自然高撑破 .fig），
    // 非贪婪只截到第一栏，第二栏的「13人档」就找不到了。thead 的行没有 <td>，不会误匹配。
    const tb = (/tbody>([\s\S]*)<\/tbody>/.exec((pages[pi] || {}).html || "") || [])[1] || "";
    const tr = (tb.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []).find((t) => {
      const k = (/<td>([\s\S]*?)<\/td>/.exec(t) || [])[1] || "";
      return k.replace(/<[^>]*>/g, "").replace(/\s+/g, "") === name;
    });
    if (!tr) return null;
    return (tr.match(/<td class="num[^"]*"[^>]*>([^<]*)<\/td>/g) || []).map((x) => />([^<]*)<\/td>/.exec(x)[1]).slice(0, 2);
  };
  const ORD = [
    ["圈地 · 两个模型同表", "单挑分", ["scores", "land", "cur", "duel"], ["scores", "land", "prev", "duel"]],
    ["圈地 · 两个模型同表", "混战Elo", ["scores", "land", "cur", "meleeElo"], ["scores", "land", "prev", "meleeElo"]],
    ["圈地 · 两个模型同表", "总分", ["scores", "land", "cur", "main"], ["scores", "land", "prev", "main"]],
    ["炸弹人 · 两个模型同表", "10人档", ["scores", "bomberman", "cur", "bySize", "10"], ["scores", "bomberman", "prev", "bySize", "10"]],
    ["炸弹人 · 两个模型同表", "总分BT", ["scores", "bomberman", "cur", "main"], ["scores", "bomberman", "prev", "main"]],
    ["夺旗 · 两个模型同表", "总分", ["scores", "ctf", "cur", "main"], ["scores", "ctf", "prev", "main"]],
    ["夺旗 · 两个模型同表", "2人档", ["scores", "ctf", "cur", "bySizeMain", "2"], ["scores", "ctf", "prev", "bySizeMain", "2"]],
    ["夺旗 · 两个模型同表", "13人档", ["scores", "ctf", "cur", "bySizeMain", "13"], ["scores", "ctf", "prev", "bySizeMain", "13"]],
  ];
  const flipped = [];
  ORD.forEach(([cap, name, cp, pp]) => {
    const pi = pg(cap), got = rowNums(pi, name);
    if (!got) { flipped.push("「" + cap + "」找不到行「" + name + "」"); return; }
    const want = [sc2(pick(D.compare, cp)), sc2(pick(D.compare, pp))];
    if (got.join("|") !== want.join("|")) flipped.push("「" + cap + "」「" + name + "」两列是 " + got.join(" / ") + "，应为 " + want.join(" / "));
  });
  chk(flipped.length === 0, "对比表 Coder390 / Q5_K_XL 两列逐行按位核对（防颠倒）", flipped.join("；"));
  const svgOf = (i) => ((pages[i] || {}).html || "").match(/<svg[\s\S]*?<\/svg>/g) || [];
  const countBars = (i) => { const m = svgOf(i).join("\n").match(/class="bar"/g); return m ? m.length : 0; };
  const countAva = (i) => (svgOf(i).join("\n").match(/<image /g) || []).length;
  const rowsOf = (i) => ((((pages[i] || {}).html || "").match(/<tr/g) || []).length) - 1;
  const PB = D.compare.peers;
  // 10-10 口径：三场交卷页各带两态 —— 表格态先读榜，柱图态是同一份数据换画法（本机两根各占一次交卷）。
  const tbOf = (h) => { const a = h.indexOf('class="pane tb"'), b = h.indexOf('class="pane bb'); return a < 0 || b < 0 ? null : h.slice(a, b); };
  const bbOf = (h) => { const b = h.indexOf('class="pane bb"'); return b < 0 ? null : h.slice(b); };
  const rowsIn = (h) => ((h.match(/<tr/g) || []).length) - 1;
  const barsIn = (h) => { const m = h.match(/class="bar"/g); return m ? m.length : 0; };
  const avaIn = (h) => (h.match(/<image /g) || []).length;
  const b3 = [];
  [["land", "圈地"], ["bomberman", "炸弹人"], ["ctf", "夺旗"]].forEach(([ep, nm]) => {
    const ti = pg(nm + " · 交卷成绩"), pb = PB[ep];
    const all = (pages[ti] || {}).html || "";
    const th = tbOf(all), chh = bbOf(all);
    if (!th || !chh) { b3.push(nm + " 交卷页没切出表格态/柱图态"); return; }
    if (rowsIn(th) !== pb.table.length) b3.push(nm + " 表格态 " + rowsIn(th) + " 行，应为 " + pb.table.length + " 行");
    if (barsIn(th) !== 0) b3.push(nm + " 表格态里还挂着柱图");
    if (!/<th>\s*外壳\s*<\/th>/.test(th) || !/<th>\s*思考档\s*<\/th>/.test(th)) b3.push(nm + " 表页缺外壳/思考档列头");
    if (!th.includes("两次平均")) b3.push(nm + " 表页没写云端那一列是两次平均");
    if (barsIn(chh) !== pb.table.length) b3.push(nm + " 柱图态 " + barsIn(chh) + " 根，应为 " + pb.table.length + " 根（不含加时终版）");
    if (avaIn(chh) !== pb.table.length) b3.push(nm + " 柱图态头像 " + avaIn(chh) + " 个，应为 " + pb.table.length + " 个");
    if (/<tr/.test(chh)) b3.push(nm + " 柱图态里还挂着表");
    if (!/data-stage="2"[^>]*data-beat="\d+"|data-beat="\d+"[^>]*data-stage="2"/.test(chh))
      b3.push(nm + " 柱图态没同时挂 data-stage 与 data-beat，口播翻到那句时不会切换");
    [[th, "表格态"], [chh, "柱图态"]].forEach(([h, w]) => {
      if (h.indexOf(CRNAME) < 0 || h.indexOf(Q5NAME) < 0) b3.push(nm + " " + w + "两个模型名不齐");
    });
  });
  chk(b3.length === 0, "三场交卷页 = 同一张榜的两态：表格态只有表，柱图态只有柱且每根带头像、由 data-beat 触发", b3.join("；"));
  // 圈地的思考档逐家按截图标注（用户 10-10）：WorkBuddy 那三家没动档，其余六家写 medium / high
  const WANT_EFF = { "opus-5.5@claude-code": "medium", "sonnet-5@claude-code": "high", "gpt-6-astra@codex": "medium", "gpt-6-sol@codex": "high", "mimo-2.6-pro@zcode": "high", "mystery-model@zcode": "high", "kimi-k3@workbuddy": "平台默认", "glm-5.3@workbuddy": "平台默认", "deepseek-4.1f@workbuddy": "平台默认" };
  const eb = [];
  Object.keys(WANT_EFF).forEach((k) => {
    const r = PB.land.table.find((x) => x.name === k);
    if (!r) eb.push("圈地表里没有 " + k);
    else if (r.effort !== WANT_EFF[k]) eb.push(k + " 标成「" + r.effort + "」，应为 " + WANT_EFF[k]);
  });
  if (/各家官方推荐档/.test((pages[pg("圈地 · 交卷成绩")] || {}).html || "")) eb.push("圈地表格还在用笼统的「各家官方推荐档」");
  chk(eb.length === 0, "圈地九家对手的「思考档」逐家按截图标注，「平台默认」= 这家在 WorkBuddy 没动档", eb.join("；"));
  // 三张加时终版成绩页：同一份 chart 数据，且必须说清两种头像框归谁
  const b4 = [];
  [["land", "圈地"], ["bomberman", "炸弹人"], ["ctf", "夺旗"]].forEach(([ep, nm]) => {
    const idx = pg(nm + " · 加时终版"), h = (pages[idx] || {}).html || "", ch = PB[ep].chart;
    if (countBars(idx) !== ch.length) b4.push(nm + " 加时终版页画了 " + countBars(idx) + " 根，应为 " + ch.length + " 根");
    if (countAva(idx) !== ch.length) b4.push(nm + " 加时终版页头像 " + countAva(idx) + " 个，应为 " + ch.length + " 个");
    if (!h.includes("虚线框")) b4.push(nm + " 加时终版页没说明两种头像框的归属");
  });
  chk(b4.length === 0, "三张加时终版柱页含两个模型的交卷版与加时终版共四根本机柱，每根带头像", b4.join("；"));
  // 画廊页按口播轮播：三块回放位靠绝对定位换位（DOM 只有 3 个视频），右侧一场一张竖向详版卡
  const gh = (pages[2] || {}).html || "", gb = [];
  const cnt = (h, re) => (h.match(re) || []).length;
  if (cnt(gh, /data-seq="/g) !== 3) gb.push("data-seq " + cnt(gh, /data-seq="/g) + " 个（应 3：三张详版卡）");
  if (cnt(gh, /data-beat="/g) !== 3) gb.push("data-beat " + cnt(gh, /data-beat="/g) + " 个（应 3 拍）");
  if (cnt(gh, /class="vslot fill/g) !== 3) gb.push("回放位 " + cnt(gh, /class="vslot fill/g) + " 个（应 3，主副位靠绝对定位换位）");
  ["1,128", "1,320", "1,016"].forEach((x) => { if (!strip(gh).includes(x)) gb.push("画廊页找不到局数 " + x); });
  chk(gb.length === 0, "第 3 页画廊 = 主位换片 + 一场一张竖卡，三场的局数都在这一页读出", gb.join("；"));
  // 拍号必须真是「触发句在本页的句序」：稿子或画面任一边改了，这里都会重新对齐
  (() => {
    if (!has("script/口播稿.md")) { chk(false, "口播稿在位（拍号映射靠它校验）", "缺 script/口播稿.md"); return; }
    const md = rd("script/口播稿.md").replace(/\r/g, "");
    const secs = [...md.matchAll(/^### (\d\d)[ \t]*(.*)$/gm)];
    const bad = [];
    secs.forEach((m, k) => {
      const n = Number(m[1]);
      const body = md.slice(m.index + m[0].length, k + 1 < secs.length ? secs[k + 1].index : md.length);
      const bm = /\*\*拍\*\*：(.+)/.exec(body);
      if (!bm) return;
      const sp = /\*\*口播（[^）]*）\*\*：?/.exec(body);
      const text = sp ? body.slice(sp.index + sp[0].length).split(/^\s*-?\s*\*\*/m)[0].split("---")[0].trim() : "";
      const S = [];
      text.split(/\n+/).forEach((para) => {
        const t = para.replace(/\*/g, "").trim();
        if (!t) return;
        let buf = "";
        for (const ch of t) { buf += ch; if ("。！？；…".includes(ch)) { if (buf.trim().length > 1) S.push(buf.trim()); buf = ""; } }
        if (buf.trim().length > 1) S.push(buf.trim());
      });
      const want = [];
      for (const x of bm[1].matchAll(/第\s*(\d+)\s*拍\s*→\s*(?:触发句)?「([^」]+)」/g)) {
        const trig = x[2].replace(/\s+/g, "");
        const idx = S.findIndex((tt) => tt.replace(/\s+/g, "").startsWith(trig.slice(0, 12)));
        if (idx < 0) { bad.push("第 " + n + " 页触发句不在口播里：" + x[2].slice(0, 16)); continue; }
        want.push(idx + 1);
      }
      const gotN = (((pages[n - 1] || {}).html || "").match(/data-beat="(\d+)"/g) || []).map((g) => Number(/\d+/.exec(g)[0]));
      const miss = want.filter((w) => gotN.indexOf(w) < 0);
      const extra = gotN.filter((g) => want.indexOf(g) < 0);
      if (miss.length || extra.length) bad.push("第 " + n + " 页 data-beat = " + (gotN.join(",") || "无") + "，稿子算出来是 " + want.join(","));
    });
    chk(bad.length === 0, "拍号 = 触发句在本页的句序（稿面与画面双向对齐）", bad.join("；"));
  })();
  // 平均速度 / 量化后缀 / 最长一步 / 净工时口径：四条都要在画面上（用户 10-10）
  const bsum2 = (round, f) => D.compare.behavior.rows.filter((r) => r.round === round).reduce((a, r) => a + r[f], 0);
  const brow2 = (ep, round) => D.compare.behavior.rows.find((r) => r.ep === ep && r.round === round) || {};
  const AS = D.compare.avgSpeed || {}, cb = AS.combined || {}, p2 = (pages[1] || {}).html || "";
  chk(p2.includes("平均生成速度") && p2.includes(String(cb.cur)) && p2.includes(String(cb.prev)) && p2.includes("Q4LynnStyle"),
    "第 2 页柱标签带量化后缀、速度格填三场平均速度", "第 2 页缺平均速度或量化后缀");
  const lsBad = [];
  [["land", "圈地"], ["bomberman", "炸弹人"], ["ctf", "夺旗"]].forEach(([ep, nm]) => {
    const ls = (D.compare.behavior.longestSteps || {})[ep] || {}, h = (pages[pg(nm + " · 思考量与时间")] || {}).html || "";
    ["cur", "prev"].forEach((rd) => {
      const o = ls[rd] || {};
      if (!o.act || sc2(o.min) !== sc2(brow2(ep, rd).maxStepMin)) lsBad.push(ep + "/" + rd + " 最长一步没写动作或分钟数与读数不符");
      if (o.act && !h.includes(o.act)) lsBad.push(ep + "/" + rd + " 页面上找不到「" + o.act + "」");
    });
    if (!h.includes("同口径")) lsBad.push(ep + " 思考量页没注明净工时同口径");
  });
  chk(lsBad.length === 0, "三个思考量页标注了「最长一步在干什么」并注明净工时两次同口径", lsBad.join("；"));

  /* ---------- 第三批意见（10-10 下午）：难度表 / 堆叠时长柱 / 尺度标注 / 双刻度柱 ---------- */
  const BH3 = D.compare.behavior, WS3 = BH3.windowSplit.perEp, SC3 = D.compare.scaleNotes;
  const CW3 = D.compare.contextWindow, DF3 = D.compare.difficulty, SK3 = D.compare.scores;
  const nf = (n) => Number(n).toLocaleString("en-US");
  // 页面上的文本是 esc() 过的，数据件里的 > < & 要先换成实体才比得上
  const escTxt = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // 净工作柱拆成「正赛 + 加时」两段：两段之和必须真的等于该场 effectiveMin，否则画面上的加法是编的
  const b5 = [];
  ["land", "bomberman", "ctf"].forEach((ep) => {
    ["cur", "prev"].forEach((rd2) => {
      const o = WS3[ep][rd2], row = BH3.rows.find((r) => r.ep === ep && r.round === rd2);
      if (Math.abs(o.main + o.overtime - row.effectiveMin) > 0.05)
        b5.push(ep + "/" + rd2 + " 正赛 " + o.main + " + 加时 " + o.overtime + " ≠ 净工作 " + row.effectiveMin);
    });
  });
  const wsum = (rd2, key) => ["land", "bomberman", "ctf"].reduce((a, e) => a + WS3[e][rd2][key], 0);
  [pg("圈地 · 思考量与时间"), pg("炸弹人 · 思考量与时间"), pg("夺旗 · 思考量与时间"), pg("轴二")].forEach((idx) => {
    const m = svgOf(idx).join("\n").match(/>([\d.]+)\+([\d.]+) = ([\d.]+) ?分</);
    if (!m) { b5.push("第 " + (idx + 1) + " 页的净工作柱没写出「正赛+加时 = 合计」"); return; }
    if (Math.abs(Number(m[1]) + Number(m[2]) - Number(m[3])) > 0.05) b5.push("第 " + (idx + 1) + " 页柱尾的加法不成立：" + m[0]);
  });
  chk(b5.length === 0, "净工作柱的两段相加 = 该场 effectiveMin，三集与合计四处都成立", b5.join("；"));
  // 每根成绩柱都要说清尺度：对数集要写出每 +400 分 = 10 倍、每 100 分的实际倍数
  const b6 = [];
  [["圈地 · 交卷成绩", "land"], ["圈地 · 加时终版", "land"], ["炸弹人 · 交卷成绩", "bomberman"],
   ["炸弹人 · 加时终版", "bomberman"], ["夺旗 · 交卷成绩", "ctf"], ["夺旗 · 加时终版", "ctf"]].forEach(([cap, ep]) => {
    const idx = pg(cap), h = (pages[idx] || {}).html || "", o = SC3[ep];
    if (!h) { b6.push("「" + cap + "」没渲染出来"); return; }
    if (!h.includes(o.log ? "对数" : "线性")) b6.push("「" + cap + "」没写这场比赛的尺度");
    if (o.log && (!h.includes(o.perK) || !h.includes(o.per100.toFixed(2))))
      b6.push("「" + cap + "」缺「每 +400 分 = 10 倍」或每 100 分的倍数");
  });
  chk(b6.length === 0, "六张成绩柱页都标明尺度，对数那两场写出每 +400 分 = 10 倍、每 100 分 ≈ 1.78 倍", b6.join("；"));
  // 第 16 页：左侧三集难度表 + 右侧两模型双柱，涨跌条那种「条长 = 差值」的读法已经废掉
  const p16h = (pages[pg("横比 · 三集难在哪")] || {}).html || "", p16bh = (pages[pg("横比 · 两涨一跌")] || {}).html || "", b7 = [];
  if (rowsOf(pg("横比 · 三集难在哪")) !== DF3.dims.length) b7.push("难度表 " + rowsOf(pg("横比 · 三集难在哪")) + " 行，数据件有 " + DF3.dims.length + " 行");
  DF3.dims.forEach((d) => ["land", "bomberman", "ctf"].forEach((e) => { if (!d[e]) b7.push("难度表「" + d.k + "」缺 " + e + " 一格"); }));
  if (!p16h.includes("夺旗 &gt; 炸弹人 &gt; 圈地")) b7.push("页面上没有难度排序那句");
  if (!p16h.includes("组织方评估")) b7.push("难度表没写明这是组织方评估、不是实测读数");
  if (/别写|视野/.test(p16h)) b7.push("数据件里给我看的内部备注上屏了");
  if (!/class="hard"/.test(p16h)) b7.push("难度表没把夺旗那一列单独提亮");
  if (DF3.order[0] !== "ctf") b7.push("难度排序第一的不是夺旗");
  if (countBars(pg("横比 · 两涨一跌")) !== 6) b7.push("成绩方向双柱 " + countBars(pg("横比 · 两涨一跌")) + " 根，应为三行 × 2 = 6 根");
  if (!p16bh.includes("−256") || !p16bh.includes("−52.3")) b7.push("最终加时页找不到夺旗那行的 −256 / −52.3");
  if (/deltaBars/.test(scriptSrc)) b7.push("deltaBars 已是死代码，还留在源里");
  chk(b7.length === 0, "难度表页（夺旗列提亮、内部备注不上屏、写明组织方评估）+ 最终加时页三行双柱（负分行带零线）", b7.join("；"));
  // 第 17 页：token 与请求数各一套刻度。合成一张图时请求数会被 91 万压成看不见的一像素
  const p17h = (pages[pg("轴一 · 思考用量")] || {}).html || "", sv17 = svgOf(pg("轴一 · 思考用量")), b8 = [];
  if (sv17.length !== 2) b8.push("轴一页有 " + sv17.length + " 张柱图，应为 token / 请求数两张");
  sv17.forEach((g, k) => { if ((g.match(/<image /g) || []).length !== 2) b8.push("轴一第 " + (k + 1) + " 组柱的头像不是 2 个"); });
  if (!p17h.includes("三场比赛合计请求数")) b8.push("请求数那组没有小标题");
  [bsum2("prev", "requests"), bsum2("cur", "requests")].forEach((v) => { if (!p17h.includes(nf(v))) b8.push("轴一页找不到请求数 " + v); });
  chk(b8.length === 0, "轴一两组柱各自刻度，请求数那组真的画得出来（472 → 398）", b8.join("；"));
  // 第 2 页三格：速度要标归属、上下文两个值、外壳不再重复第三遍
  const b9 = [];
  ["cur", "prev"].forEach((rd2) => {
    const nm = rd2 === "cur" ? CRNAME : Q5NAME, v = String(cb[rd2]);
    if (!p2.includes(nm + " " + v)) b9.push("平均速度里 " + v + " 没贴在 " + nm + " 后面");
  });
  if (!p2.includes(Math.round(CW3.serviceMax / 1000) + "k 最大") || !p2.includes(Math.round(CW3.usable / 1000) + "k 可用"))
    b9.push("上下文没写成 152k 最大 / 145k 可用");
  if (CW3.compactionWindow - CW3.reserve !== CW3.usable) b9.push("压缩阈值 − 预留 ≠ 可用上下文");
  if (!p2.includes("压缩阈值")) b9.push("没写 230k − 85k 这个来处");
  if (p2.includes("同一套外壳与预设")) b9.push("外壳那格还在重复第三遍同环境");
  chk(b9.length === 0, "第 2 页：速度按模型标注、上下文 152k/145k 且写出 230k−85k、外壳不再重复", b9.join("；"));
  // 逐条钉住画面文案，防止回退
  const b10 = [];
  if (!(pages[pg("圈地 · 两个模型同表")] || {}).html.includes("换来了圈地面积")) b10.push("圈地同表页抬头不是「省下的思考换来了圈地面积」（Q4 混战平均面积 526 高于 Q5 的 219，方向不能写反）");
  const rk1 = SK3.land.cur.meleeStats.avgRank, rk0 = SK3.land.prev.meleeStats.avgRank;
  if (!(rk0 - rk1 > 0)) b10.push("混战平均名次不是提升，差值不该为正");
  if (!(pages[pg("圈地 · 两个模型同表")] || {}).html.includes("+" + (Math.round((rk0 - rk1) * 100) / 100) + " 位"))
    b10.push("名次差没写成 +1.04 位（现在是提升 " + (rk0 - rk1).toFixed(2) + " 位）");
  if (!(pages[pg("炸弹人 · 加时台账")] || {}).html.includes("第二次机会")) b10.push("炸弹人加时台账页没改成「第二次机会」");
  if (!(pages[pg("炸弹人 · 加时终版")] || {}).html.includes("同一份代码")) b10.push("炸弹人加时终版页没写「与交卷版同一份代码」（原「加时收尾」页已按 10-10 意见并进口播）");
  if (!(pages[pg("夺旗 · 思考量与时间")] || {}).html.includes("三场比赛里最难的一场")) b10.push("夺旗思考量页没点出它是三场比赛里最难");
  if (!(pages[pg("横比 · 三集难在哪")] || {}).html.includes("弱模型连规则都不一定读得懂")) b10.push("难度表页没把「考验对复杂场景的理解」这句写到屏幕字上");
  const psum = (pages[pg("总结")] || {}).html || "";
  if (psum.includes("判断留给观众") || psum.includes("不给谁更强")) b10.push("第 28 页那两行多余结论还在");
  if (!psum.includes("one-shot")) b10.push("第 28 页没标 one-shot");
  if (!psum.includes("想得短，同样的时间做得更多")) b10.push("第 28 页没写「简单的问题：想得短、做得更多」");
  if (!psum.includes("该长考的那场没有变短")) b10.push("第 28 页没写「复杂的问题没丢长考」");
  if (psum.includes("智力上限")) b10.push("第 28 页那两行白色小字（智力上限那条）还留着");
  // 第 27 页两代最终 bot 对照。期望值写死在这里，与 data/ctf-strategy.json 不同源，手改数据件会被抓。
  const p27t = [pg("夺旗 · 两代最终 bot"), pg("夺旗 · 两代捡旗读数")].map((i) => strip((pages[i] || {}).html || "").replace(/\s+/g, "")).join("");
  ["L221", "L462", "L609", "8.39", "12.78", "0.41–0.67", "0.55–0.89"].forEach((k) => { if (!p27t.includes(k)) b10.push("第 27 页找不到「" + k + "」"); });
  if (/39 分|低 39/.test(p27t)) b10.push("第 27 页把交卷那 39 分差写成了因果（同码重跑就抖 70.8 分）");
  if ((pages[pg("完")] || {}).html.includes("可以回溯")) b10.push("收尾页的白字段没删干净");
  [["圈地 · 交卷成绩", ["var(--q5)"]], ["炸弹人 · 交卷成绩", ["var(--q5)"]], ["夺旗 · 交卷成绩", ["var(--q5)"]],
   ["圈地 · 加时终版", ["var(--q5)", "var(--q5ot)", "var(--me-ot)"]],
   ["炸弹人 · 加时终版", ["var(--q5)", "var(--q5ot)", "var(--me-ot)"]],
   ["夺旗 · 加时终版", ["var(--q5)", "var(--q5ot)", "var(--me-ot)"]]].forEach(([cap, cols]) =>
    cols.forEach((c) => { if (!(pages[pg(cap)] || {}).html.includes(c)) b10.push("「" + cap + "」缺 " + c + " 这根柱的单独上色"); }));
  chk(b10.length === 0, "历轮意见逐条钉在画面上（抬头 / 名次差为正 / 第二次机会 / 同代码故同分 / 夺旗最难 / one-shot / 本机柱上色 / 第 27 页行号与倍数 / 第 28 页两句骨干）", b10.join("；"));
  const spBad = [];
  ["cur", "prev"].forEach((rd) => {
    let tok = 0, sec = 0;
    Object.keys(AS.perEp || {}).forEach((ep) => {
      const o = AS.perEp[ep]; tok += o[rd + "Tok"]; sec += o[rd + "GenS"];
      if (Math.abs(o[rd] - Math.round(o[rd + "Tok"] / o[rd + "GenS"] * 10) / 10) > 0.11) spBad.push(ep + "/" + rd + " 平均速度与自己的分子分母不符");
    });
    if (Math.abs(cb[rd] - Math.round(tok / sec * 10) / 10) > 0.11) spBad.push(rd + " 三集合计 " + cb[rd] + "，复算 " + (tok / sec).toFixed(1));
  });
  chk(spBad.length === 0, "平均速度 = Σ输出tok ÷ Σ生成秒，每场与三集合计都对得上", spBad.join("；"));
  chk(Object.keys(AS.perEp || {}).reduce((a, e) => a + AS.perEp[e].curTok, 0) === bsum2("cur", "outputTok"),
    "平均速度的分子与画面别处的输出 tok 同源（同一个 698,977）", "分子与 outputTok 合计不同源");
  // 对手池列 = 两次算术平均；本机两行 = 各自那一次原值；柱图比表多两根（两模型的加时终版）
  const tbBad = [];
  ["land", "bomberman", "ctf"].forEach((ep) => {
    const P = PB[ep], f = ep === "bomberman" ? "bt" : "main", by = {};
    (P.rows || []).forEach((r) => { by[r.name] = r; });
    const us = by[Object.keys(by).find((k) => /your-bot|你的 bot/.test(k))] || {};
    (P.table || []).forEach((r) => {
      if (r.who === "peer") {
        const o = by[r.name] || {}, w = Math.round(((Number(o[f]) + Number(o.q5)) / 2) * 100) / 100;
        if (Math.abs(w - r.score) > 0.011) tbBad.push(ep + " " + r.name + " 表里 " + r.score + "，复算 " + w);
      } else if (r.who === "me" && Math.abs(Number(us[f]) - r.score) > 0.011) tbBad.push(ep + " 本机行不是交卷原值");
      else if (r.who === "q5" && Math.abs(Number(us.q5) - r.score) > 0.011) tbBad.push(ep + " Q5_K_XL 行不是它那一次的原值");
    });
    if ((P.chart || []).length !== (P.table || []).length + 2) tbBad.push(ep + " 柱图根数应比表多 2（两模型各多一根加时终版）");
  });
  chk(tbBad.length === 0, "对手池列 = 两次算术平均，本机两行 = 各自原值，柱图多两根加时终版", tbBad.join("；"));
  // 全片不许用轮次指代：观众没看过前一次，只认得两个模型名
  const roundWords = ["上一轮", "本轮", "这一轮", "上次比赛", "前一轮"];
  const rw = roundWords.filter((w) => allTxt.includes(w));
  chk(rw.length === 0, "页面不出现「上一轮 / 本轮」这类轮次指代（一律用模型名）", "还留着: " + rw.join(" / "));
  // 两轮 MTP 草稿深度不同（n_max=3 接受率反而更低），速度不同口径 → 参数差不上画面，速度写作「总体差不多」
  const mtpWords = ["MTP draft", "草稿深度", "spec-draft", "n_max", "n-max", "draft-n"];
  const mw = mtpWords.filter((w) => allTxt.includes(w));
  chk(mw.length === 0 && allTxt.includes("总体差不多"),
    "MTP 参数差没上画面，两个模型的生成速度按「总体差不多」表述", "画面还留着: " + mw.join(" / "));
  // 观众不知道前因后果的内部量：sha 值、噪声底、重抽、seed 名一律不上画面
  const banned2 = ["噪声底", "重抽", "哈希", "sha1", "finalSha", "schedule_seed", "flag_seed", "session.v4", "steps-coder390"];
  const hit2 = banned2.filter((w) => allTxt.includes(w));
  const hex = (allTxt.match(/\b[0-9a-f]{12}\b/g) || []).slice(0, 3);
  chk(hit2.length === 0 && hex.length === 0, "sha 值 / 噪声底 / 重抽 / seed 这类细节不在画面上", "还留着: " + hit2.join(" / ") + (hex.length ? " 十六进制串 " + hex.join(" ") : ""));
  const banned = ["补时", "overtime-interruptions", "补偿时长", "崩溃续跑台账", "去毒", "abliterated", "uncensored", "Uncensored"];
  const all = pages.map((p) => p.html).join(" ");
  const hit = banned.filter((w) => all.includes(w));
  chk(hit.length === 0, "页面文案不含「补时」等被禁止的审计口径", "页面出现禁词: " + hit.join(" / "));
  const leakTag = [];
  pages.forEach((p, i) => {
    const t = p.html.replace(/<[^>]*>/g, "");
    if (/\/"|\brx=|\bclass=|\bopacity=/.test(t)) leakTag.push("第 " + (i + 1) + " 页有属性泄漏成文字（标签没闭合）");
  });
  chk(leakTag.length === 0, "SVG 标签全部闭合（多余 /> 会让 rx=\"3\" 泄漏成页面文字）", leakTag.join("；"));
  const visible = (h) => strip(h).replace(/\s+/g, "").length;
  const over = [];
  pages.forEach((p, i) => { const n = visible(p.html); if (n > 1700) over.push("第 " + (i + 1) + " 页可见文字 " + n + " 字符"); });
  chk(over.length === 0, "每页可见文字量仍在单屏预算内（≤1,700 字符/页，SVG 内只算标注）", "需拆页或删冗余: " + over.join("；"));
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
  chk(timeOk && spoken.length > 60, "字幕.txt 台词行格式合法（行首 Xs / XminYs，共 " + spoken.length + " 句）", "字幕有行首时间戳不合法的行");
  const marks = [];
  lines.forEach((l) => { const m = /第\s*(\d+)\s*页/.exec(l); if (m && /^\s*[#【]/.test(l)) marks.push(Number(m[1])); });
  const seqOk = marks.length > 0 && marks.every((n, i) => n === i + 1);
  chk(seqOk, "字幕页码标注从第 1 页连续到第 " + marks.length + " 页" +
    (marks.length < pages.length ? "（末尾 " + (pages.length - marks.length) + " 页无台词，静默落幕）" : "，与页面数一致"),
    "页码标注跳号或数量不符: " + marks.join(","));
  chk(!/补时|overtime-interruptions/.test(sub), "字幕文案不含被禁止口径", "字幕出现禁词");
} else no("dubbing/字幕.txt 还没写（口播稿阶段产出，画面定稿前不阻塞）");
if (has("README.md")) {
  const rm = rd("README.md");
  const rows = (rm.match(/^\| (\d{2}) \|/gm) || []).map((s) => Number(s.slice(2, 4)));
  chk(rows.length === pages.length, "README 页面清单 " + rows.length + " 行 = 渲染页数", "README 清单 " + rows.length + " 行 ≠ 页数 " + pages.length);
  chk(rows.every((n, i) => n === i + 1), "README 页码从 01 连续编号", "README 页码不连续");
  chk(!/补时/.test(rm), "README 不含被禁止口径", "README 出现禁词「补时」");
  chk(/model-compare\.json/.test(rm) && /iterations\.csv/.test(rm) && /iterations-stats\.json/.test(rm),
    "README 已登记三件读数源", "README 未登记新数据件");
} else no("README.md 还没写（画面定稿后补）");
chk(has("PLAN.md"), "PLAN.md 在位（给外部评审读的自包含简报）", "缺 PLAN.md，外部评审要自己翻代码");
chk(existsSync("$PROJECT_ROOT/NotoSansSC-Regular.otf"), "中文字体（绝对路径引用）在位", "NotoSansSC-Regular.otf 找不到，页面会掉字体");

console.log("\n结果: " + pass + " 通过 / " + warn + " 警告 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

// ---------- DOM 桩渲染 ----------
function renderPages(data, src, avas) {
  const pages = [];
  const mk = () => {
    const el = { className: "", dataset: {}, _html: "", style: { setProperty() {} },
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
      appendChild() {}, querySelector() { return mk(); }, querySelectorAll() { return []; }, textContent: "" };
    Object.defineProperty(el, "innerHTML", { get() { return this._html; }, set(v) { this._html = v; } });
    return el;
  };
  const stage = { appendChild(el) { if (el._html) pages.push({ cls: el.className, html: el._html }); }, querySelectorAll() { return []; } };
  const hud = mk();
  hud.firstElementChild = { style: {} };
  const doc = { createElement: mk, addEventListener() {}, getElementById: () => mk(),
    querySelectorAll: () => [],
    querySelector: (s) => (s === "#stage" ? stage : hud),
    documentElement: { style: { setProperty() {} } }, body: { classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } } } };
  const ctx = vm.createContext({ window: { __DATA__: data, __AVAS__: avas || {}, addEventListener() {} }, document: doc,
    console: { log() {}, warn() {}, error() {} },
    location: { search: "" }, performance: { now: () => 0 }, requestAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout() {} });
  vm.runInContext(src, ctx, { filename: "p_script.js" });
  return pages;
}
