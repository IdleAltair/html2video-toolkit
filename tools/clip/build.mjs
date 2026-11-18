// 构建 presentation-vX/index.html = p_top.txt + p_style.css + p_mid.txt + p_script.js + p_end.txt
// 用法: node pipeline/build.mjs [presentation-vX]   （缺省 presentation-v3）
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ROOT } from "./lib.mjs";

const PRESENT = process.argv[2] || "presentation-v3";
const SRC = path.join(ROOT, PRESENT, "src");
const OUT = path.join(ROOT, PRESENT, "index.html");
const PARTS = ["p_top.txt", "p_style.css", "p_mid.txt", "p_script.js", "p_end.txt"];

const js = path.join(SRC, "p_script.js");
execFileSync(process.execPath, ["--check", js], { stdio: "inherit" });
console.log("[build] p_script.js 语法 OK");

let html = "";
for (const p of PARTS) {
  const f = path.join(SRC, p);
  html += readFileSync(f, "utf8");
  console.log("[build] + " + p + " (" + readFileSync(f).length + " B)");
}
writeFileSync(OUT, html);
console.log("[build] -> " + OUT + " (" + Buffer.byteLength(html) + " B)");
