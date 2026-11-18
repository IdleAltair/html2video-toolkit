// 夺旗段错误取证：从每一局的 结果.jsonl 数出「谁的、在哪个人数档、多少局、报的什么」，
// 落成 data/ctf-faults.json 供页面与 check.mjs 引用（成绩表只有故障总数，没有分档）。
// 用法：node pipeline/faults.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WSL = "//wsl.localhost/Ubuntu-22.04$HOME/deepseek-harness/workplace/meow-ai-arena/ctf/challenge-runs";
const RUNS = { main: "20261004-051730/games", ot: "20261004-050148/games" };
const ME = "你的 bot";

const out = { _src: "各 run 的 结果.jsonl 逐局 faults 字段统计；总数与 成绩.md 的「故障局」列一致，这里多出分档与报错原文。" };
for (const [tag, rel] of Object.entries(RUNS)) {
  const p = path.join(WSL, rel, "结果.jsonl");
  if (!fs.existsSync(p)) { console.error("缺文件：" + p); continue; }
  const tiers = {}, games = {}; let total = 0, maxMs = 0, msg = "";
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const g = JSON.parse(line);
    games[g.size] = (games[g.size] || 0) + 1;
    const f = (g.faults || {})[ME];
    if (f) { total++; tiers[g.size] = (tiers[g.size] || 0) + 1; msg = String(f); maxMs = Math.max(maxMs, (g.max_ms || {})[ME] || 0); }
  }
  out[tag] = { run: rel.split("/")[0], games: Object.values(games).reduce((a, b) => a + b, 0), gamesByTier: games, total, byTier: tiers, msg, maxMs: Number(maxMs.toFixed(2)) };
  console.log(tag + "：" + JSON.stringify(out[tag]));
}
fs.writeFileSync(path.join(ROOT, "data", "ctf-faults.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
console.log("→ data/ctf-faults.json");
