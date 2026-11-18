// 把 challenge.py --full 的成绩表解析成 data/challenge-full.json，供页面渲染（页内不手抄数字）
// 用法: node pipeline/full2json.mjs
// 输入: data/full-src/{land,bomb,ctf}-{main,ot}-*.md（从 WSL 的 challenge-runs 目录拷来的原始成绩表）
// 说明: main = 正赛交卷版，ot = 加时终版；两版跑同一档（--full）才能同口径比名次。
//       bomb.ctl* = 固定赛程的对照跑批（--seed 20261004、三组只差一个变量），
//       正赛版与加时终版各 1320 局、座位与地图逐局相同，所以那对差值是代码的差值。
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "data", "full-src");
const rd = (f) => (existsSync(path.join(SRC, f)) ? readFileSync(path.join(SRC, f), "utf8") : "");
const num = (s) => { const m = /-?\d+(?:\.\d+)?/.exec(String(s).replace(/,/g, "")); return m ? Number(m[0]) : null; };
const cells = (line) => line.split("|").map((x) => x.trim());
const rowsOf = (text, who) => text.split(/\r?\n/).filter((l) => l.includes(who) && /^\s*\|/.test(l)).map(cells);

const out = {
  _src: "challenge.py --full 大样本复核。run 目录见 runs 字段；原始表拷在 data/full-src/。main=正赛交卷版，ot=加时终版。",
  runs: {}, games: {},
};

/* ---------- 圈地：ratings.md ---------- */
// 三场的展示名统一（圈地原始名带 @脚手架，横比柱要和另两场并排看就得去掉）
const ALIAS = {
  "sonnet-5@claude-code": "Sonnet 5", "anchor-sparring": "陪练锚点", "gpt-6-astra@codex": "GPT-6 Astra",
  "opus-5.5@claude-code": "Opus 5.5", "gpt-6-sol@codex": "GPT-6 Sol", "mimo-2.6-pro@zcode": "MiMo V2.6 Pro",
  "kimi-k3@workbuddy": "Kimi K3", "glm-5.3@workbuddy": "GLM 5.3", "your-bot@you": "本地 27B",
  "deepseek-4.1f@workbuddy": "DeepSeek V4.1 Flash", "anchor-greedy": "贪心基准", "anchor-random": "随机锚点",
  "mystery-model@zcode": "神秘模型", "基准": "贪心基准", "你的 bot": "本地 27B",
};
const alias = (n) => ALIAS[n] || n;
// 主表 = 第一个 "## " 之前的那张排名表；后面的"各 bot 统计"表不参与横比
const headTable = (text) => text.split(/\r?\n##\s/)[0];
const rankRows = (text, valCol) => headTable(text).split(/\r?\n/)
  .map(cells).filter((c) => /^(\d+|—|锚点)$/.test(c[1]) && c[2] && num(c[valCol]) !== null)
  .map((c) => ({ rank: /^\d+$/.test(c[1]) ? Number(c[1]) : null, name: alias(c[2]), anchor: c[1] === "锚点" || c[1] === "—", value: num(c[valCol]) }));

function parseLand(tag) {
  const f = readdirSync(SRC).find((x) => x.startsWith("land-" + tag) && x.endsWith(".md"));
  if (!f) return null;
  const text = rd(f);
  const mine = rowsOf(text, "your-bot@you")[0];
  if (!mine) return null;
  const rnd = rowsOf(text, "anchor-random")[0];
  const rows = rankRows(text, 3);
  const field = Math.max.apply(null, rows.filter((r) => r.rank).map((r) => r.rank));
  const ratings = {}, anchors = {};
  rows.forEach((r) => { if (r.anchor) anchors[r.name] = r.value; else ratings[r.name] = r.value; });
  return {
    score: num(mine[3]), rank: Number(mine[1]), field: field,
    duel: { score: num(mine[6]), elo: num(mine[7]) },
    melee: { score: num(mine[8]), elo: num(mine[9]) },
    randomAnchorElo: rnd ? num(rnd[9]) : null,
    randomAnchorMelee: rnd ? num(rnd[8]) : null,
    ci95: mine[4], ratings: ratings, anchors: anchors,
  };
}

/* ---------- 炸弹人：汇总.md（BT 表 + 人数档表）---------- */
function parseBomb(tag) {
  // 加一个 "-" 才不会被 bomb-otw2-summary.md 抢走 "ot" 这一档
  const f = readdirSync(SRC).find((x) => x.startsWith("bomb-" + tag + "-") || x.startsWith("bomberman-" + tag + "-"));
  if (!f) return null;
  const text = rd(f);
  const bt = text.slice(text.indexOf("## BT"));
  const order = bt.split(/\r?\n/).filter((l) => /^\s*\|/.test(l) && !/^\s*\|[-:]*\|/.test(l) && !/选手/.test(l))
    .map(cells).filter((c) => c[1] && c[1] !== "选手" && c[2] !== "BT 实力值");
  const i = order.findIndex((c) => c[1].includes("你的 bot"));
  if (i < 0) return null;
  const field = order.filter((c) => c[1] !== "Base").length;
  const bySize = {};
  text.split(/\r?\n/).filter((l) => /^\s*\|/.test(l)).map(cells)
    .filter((c) => /^\d+$/.test(c[1]) && c[2] && c[2].includes("你的 bot"))
    .forEach((c) => {
      bySize[c[1]] = { mine: num(c[6]), games: num(c[3]), live: num(c[4]), kill: num(c[5]), faults: num(c[9]) };
    });
  text.split(/\r?\n/).filter((l) => /^\s*\|/.test(l)).map(cells)
    .filter((c) => /^\d+$/.test(c[1]) && c[2] === "Base")
    .forEach((c) => { if (bySize[c[1]]) { bySize[c[1]].base = num(c[6]); bySize[c[1]].baseFaults = num(c[9]); } });
  // 同表其他选手的 BT：横比柱状图必须和标题那个数出自同一张表，否则就是两张表互相冒充
  const ratings = {}, anchors = {};
  order.forEach((c) => { if (c[1] === "Base") anchors["贪心基准"] = num(c[2]); else ratings[alias(c[1])] = num(c[2]); });
  const gm = /完成\s*([\d,]+)\s*局/.exec(text);
  return { bt: num(order[i][2]), rank: i + 1, field: field, bySize: bySize, ratings: ratings, anchors: anchors,
    games: gm ? num(gm[1]) : null };
}

/* ---------- 夺旗：成绩.md ---------- */
function parseCtf(tag) {
  const f = readdirSync(SRC).find((x) => x.startsWith("ctf-" + tag));
  if (!f) return null;
  const text = rd(f);
  const head = text.split(/\r?\n/).find((l) => l.includes("实力值") && l.includes("故障局"));
  if (!head) return null;
  const cols = cells(head).map((c) => c.replace(/人$/, ""));
  const mine = rowsOf(text, "你的 bot")[0];
  if (!mine) return null;
  const g = (name) => num(mine[cols.indexOf(name)]);
  const bySize = {};
  cols.filter((c) => /^\d+$/.test(c)).forEach((c) => { bySize[c] = g(c); });
  const field = Math.max.apply(null, text.split(/\r?\n/).filter((l) => /^\s*\|\s*\d+\s*\|/.test(l)).map((l) => Number(cells(l)[1])));
  const gm = /(\d+)\s*局/.exec(text);
  const ratings = {}, anchors = {};
  rankRows(text, 3).forEach((r) => { if (r.anchor) anchors[r.name] = r.value; else ratings[r.name] = r.value; });
  return {
    bt: g("实力值"), rank: Number(mine[1]), field: field, ci95: mine[4],
    bySize: bySize, faults: g("故障局"), games: gm ? Number(gm[1]) : null,
    ratings: ratings, anchors: anchors,
  };
}

["main", "ot"].forEach((tag) => {
  const l = parseLand(tag), b = parseBomb(tag), c = parseCtf(tag);
  if (l) (out.land = out.land || {})[tag] = l;
  if (b) (out.bomb = out.bomb || {})[tag] = b;
  if (c) (out.ctf = out.ctf || {})[tag] = c;
});
// 固定赛程对照：同一套 1320 局（schedule_seed 20261004），三组各只差一个变量
//   ctlmain / ctlot  —— 只差代码版本（正赛交卷版 vs 加时终版），并发都是 7
//   ctlot  / ctlotw2 —— 只差并发（7 → 2），代码同一份、赛程同一套
const CTL = {
  ctlmain: { workers: 7, src: "contestants/archive/pre-selfiter-20261003/bomberman-gui1/submission/bot.cpp", run: "ctl-main-w7-105906" },
  ctlot: { workers: 7, src: "contestants/runs/bomberman-gui1/submission/bot.cpp", run: "ctl-ot-w7-110757" },
  ctlotw2: { workers: 2, src: "contestants/runs/bomberman-gui1/submission/bot.cpp", run: "ctl-ot-w2-111642" },
};
if (out.bomb) {
  out.bomb.ctlSeed = 20261004;
  Object.keys(CTL).forEach((tag) => {
    const p = parseBomb(tag);
    if (p) { p.workers = CTL[tag].workers; p.src = CTL[tag].src; p.run = CTL[tag].run; out.bomb["ctl_" + tag] = p; }
  });
  const a = out.bomb.ctl_ctlmain, b = out.bomb.ctl_ctlot, c = out.bomb.ctl_ctlotw2;
  if (a && b) out.bomb.ctlDelta = { bt: Math.round((b.bt - a.bt) * 100) / 100, from: a.rank, to: b.rank, field: a.field };
  // 三向拆解：每一条都只动一个变量
  if (a && b && out.bomb.ot) {
    out.bomb.noise = {
      code: { bt: Math.round((b.bt - a.bt) * 100) / 100, held: "同赛程、同并发 7" },
      schedule: { bt: Math.round((b.bt - out.bomb.ot.bt) * 100) / 100, held: "同一份加时终版、同并发 7，只有赛程换 seed" },
    };
    if (c) out.bomb.noise.workers = {
      bt: Math.round((c.bt - b.bt) * 100) / 100, held: "同一份加时终版、同一套赛程，只有并发 7 → 2",
    };
  }
}
// 同一份加时终版再跑一轮，只把并发从 7 压到 2
if (out.bomb && out.bomb.ot) out.bomb.ot.workers = 7;
const w2 = parseBomb("otw2");
if (out.bomb && out.bomb.ot && w2) { w2.workers = 2; out.bomb.otRerun = w2; }
// 自测读数沿用 legacy（那是模型自己跑出来的八局对打，不随评测档变化）
if (out.land) out.land.selftest = JSON.parse(rd0("legacy-scores.json")).land.selftest;
function rd0(f) { return readFileSync(path.join(ROOT, "data", f), "utf8"); }
// 每场的局数
if (out.land && out.land.ot) out.games.land = 1128;
if (out.ctf && out.ctf.ot) out.games.ctf = out.ctf.ot.games;
if (out.bomb && out.bomb.ot) out.games.bomb = 1320;

writeFileSync(path.join(ROOT, "data", "challenge-full.json"), JSON.stringify(out, null, 1) + "\n");
console.log("写出 data/challenge-full.json");
console.log(JSON.stringify(out, null, 1));
