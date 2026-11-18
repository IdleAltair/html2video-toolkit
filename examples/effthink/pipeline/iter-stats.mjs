// iter-stats.mjs — 从 data/iterations.csv 复算迭代台账的计数，供页面与 check.mjs 用。
// 目的：「改动尝试数 / 采纳数」这类数字一律由脚本数出来，不手抄进页面。
// 用法: node pipeline/iter-stats.mjs [--json]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV = path.join(ROOT, "data/iterations.csv");

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
if (!existsSync(CSV)) { console.error("缺 data/iterations.csv"); process.exit(1); }
const rows = readFileSync(CSV, "utf8").split(/\r?\n/).filter((l) => l.trim()).map(cut);
const head = rows.shift();
// 逐行核列数：Object.fromEntries 会静默补齐缺失列，所以必须在这里按原始 cell 数判，
// 否则少一个字段会让整行右移一位、把 verdict 挪到 verdict_basis 去。
const ragged = rows.map((r, i) => ({ line: i + 2, n: r.length, ep: r[0], round: r[2] }))
                   .filter((x) => x.n !== head.length);
const objs = rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
const changes = objs.filter((o) => o.kind === "改动");
const keeps = changes.filter((o) => o.verdict === "KEEP");
const rolls = changes.filter((o) => o.verdict === "ROLL BACK");
const byEp = {};
for (const o of changes) {
  byEp[o.ep] = byEp[o.ep] || { attempts: 0, keep: 0, rollback: 0, filesSaved: 0 };
  const b = byEp[o.ep];
  b.attempts += 1;
  if (o.verdict === "KEEP") b.keep += 1;
  if (o.verdict === "ROLL BACK") b.rollback += 1;
  if (o.files_saved === "是") b.filesSaved += 1;
}
const out = {
  csvColumns: head,
  totalRows: objs.length,
  raggedRows: ragged,
  kinds: objs.reduce((a, o) => ((a[o.kind] = (a[o.kind] || 0) + 1), a), {}),
  attempts: changes.length,
  keep: keeps.length,
  rollback: rolls.length,
  verdictsSeen: [...new Set(objs.map((o) => o.verdict))].sort(),
  byEp,
  windows: [...new Set(objs.map((o) => o.window))],
};
console.log("改动尝试 " + out.attempts + " 次｜采纳 " + out.keep + "｜回滚 " + out.rollback);
console.log("按集:", JSON.stringify(byEp));
console.log("kind 分布:", JSON.stringify(out.kinds));
console.log("verdict 词表:", out.verdictsSeen.join(" / "));
console.log("列数不等于表头的行:", ragged.length ? JSON.stringify(ragged) : "无", "｜总行", objs.length);
let rc = 0;
if (ragged.length) { console.log("!! 有行的列数与表头不符，字段会整体右移一位"); rc = 1; }
const stray = out.verdictsSeen.filter((v) => !["KEEP", "ROLL BACK", "N/A"].includes(v));
if (stray.length) { console.log("!! verdict 词表外的值:", stray.join(" / ")); rc = 1; }
if (process.argv.includes("--json")) {
  writeFileSync(path.join(ROOT, "data/iterations-stats.json"), JSON.stringify(out, null, 1) + "\n");
  console.log("-> data/iterations-stats.json");
}
process.exit(rc);
