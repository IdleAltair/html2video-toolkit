// 量同一份炸弹人加时终版在「同一套赛程、只差并发」下的非确定性 → data/bomb-noise.json
// 用法: node pipeline/bomb-noise.mjs
// 输入: WSL 的 challenge-runs/{ctl-ot-w7-*,ctl-ot-w2-*}/results.json（两份 schedule.json 已核对逐局相同）
// 为什么要单独数：BT 差 22 分只说明"变了"，"490 局里 273 局终分不同"才说明这台评测本身有多抖。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = path.join("//wsl.localhost/Ubuntu-22.04$HOME/deepseek-harness/workplace/meow-ai-arena/bomberman/challenge-runs");
const A = "ctl-ot-w7-110757", B = "ctl-ot-w2-111642";
const ME = "你的 bot";

function mine(run) {
  const m = new Map();
  for (const r of JSON.parse(readFileSync(path.join(RUNS, run, "results.json"), "utf8"))) {
    const res = r.result;
    const names = res.names || [];
    if (names.indexOf(ME) < 0) continue;
    m.set([r.size, res.seed, names.join("|")].join("#"), { i: names.indexOf(ME), res: res });
  }
  return m;
}

const a = mine(A), b = mine(B);
const bySize = {};
let common = 0, differ = 0;
for (const k of a.keys()) {
  const x = b.get(k);
  if (!x) continue;
  const ra = a.get(k), rb = x;
  const size = k.split("#")[0];
  const e = (bySize[size] = bySize[size] || { games: 0, differ: 0, w7: 0, w2: 0 });
  common++;
  const d = JSON.stringify(ra.res.points) !== JSON.stringify(rb.res.points);
  if (d) differ++;
  e.games++; e.differ += d ? 1 : 0;
  e.w7 += ra.res.points[ra.i]; e.w2 += rb.res.points[rb.i];
}
Object.keys(bySize).forEach((s) => {
  const e = bySize[s];
  e.w7 = Math.round(e.w7 / e.games * 1000) / 1000;
  e.w2 = Math.round(e.w2 / e.games * 1000) / 1000;
});

const out = {
  _src: "同一份加时终版、同一套 1320 局赛程（schedule_seed 20261004），只把并发从 7 压到 2，逐局比对终分。",
  runs: [A, B], workers: [7, 2], common: common, differ: differ,
  differPct: Math.round(differ / common * 1000) / 10,
  bySize: bySize,
};
writeFileSync(path.join(ROOT, "data", "bomb-noise.json"), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
