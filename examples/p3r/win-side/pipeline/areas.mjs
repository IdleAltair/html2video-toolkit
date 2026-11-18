// 从大样本 run 的 results.jsonl 重算「本机 vs 贪心基准」的平均面积，替掉第 7 页那组小样本读数（427 : 538 / 312 局）。
// 用法：node pipeline/areas.mjs   →  写出 data/land-areas.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WSL = "//wsl.localhost/Ubuntu-22.04$HOME/deepseek-harness/workplace/meow-ai-arena/land/challenge-runs";
const RUNS = { main: "20261004-050654", ot: "20261004-044226" };
const ME = "your-bot@you#1", GREEDY = "anchor-greedy";

const res = { _src: "land/challenge-runs/<run>/results.jsonl 的 duel 局逐局 areas 平均；pipeline/areas.mjs 生成。" };
for (const [tag, dir] of Object.entries(RUNS)) {
  const rows = fs.readFileSync(WSL + "/" + dir + "/results.jsonl", "utf8").trim().split("\n").map(JSON.parse);
  const acc = {};                       // name -> {sum, n}
  for (const r of rows) {
    if (r.mode !== "duel") continue;    // 面积对照只在单挑档有意义，混战是多方
    r.names.forEach((n, i) => {
      const a = (acc[n] = acc[n] || { sum: 0, n: 0 });
      a.sum += r.areas[i]; a.n++;
    });
  }
  const avg = (n) => (acc[n] ? acc[n].sum / acc[n].n : null);
  const mine = rows.filter((r) => r.mode === "duel" && r.names.includes(ME));
  res[tag] = {
    run: dir, games: mine.length,
    mine: Math.round(avg(ME)), greedy: Math.round(avg(GREEDY)),
    winRate: Number((mine.filter((r) => r.names[r.winner] === ME).length / mine.length * 100).toFixed(1))
  };
}
fs.writeFileSync(path.join(ROOT, "data", "land-areas.json"), JSON.stringify(res, null, 1) + "\n", "utf8");
console.log(JSON.stringify(res, null, 1));
console.log("→ data/land-areas.json");
