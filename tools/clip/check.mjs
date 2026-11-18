// 全量体检：剪辑完整性 + 展示构建一致性 + 资产就位
// 用法: node pipeline/check.mjs
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ROOT, mediaDur, f1 } from "./lib.mjs";

const PRESENT = process.argv[2] || "presentation-v3";
const table = JSON.parse(readFileSync(path.join(ROOT, "pipeline", "cuts.json"), "utf8"));
let pass = 0, warn = 0, fail = 0;
const ok = m => { pass++; console.log("  PASS  " + m); };
const no = m => { warn++; console.log("  WARN  " + m); };
const bad = m => { fail++; console.log("  FAIL  " + m); };

console.log("== 1/4 成片剪辑（" + table.clips.length + " 段） ==");
for (const c of table.clips) {
  const f = path.join(ROOT, table.outDir, c.name);
  const exp = c.manual ? c.dur : c.out - c.in;
  if (!existsSync(f)) { bad(c.name + "  缺失: " + path.join(table.outDir, c.name)); continue; }
  let dur = 0;
  try { dur = mediaDur(f); } catch (e) { bad(c.name + "  时长探测失败: " + e.message); continue; }
  if (Math.abs(dur - exp) > 0.75) bad(c.name + "  时长 " + f1(dur) + "s ≠ 期望 " + exp + "s（±0.75s）← 残片/裁错，重裁: node pipeline/cut.mjs " + c.name.replace(/\.mp4$/, ""));
  else ok(c.name + "  " + f1(dur) + "s ≈ " + exp + "s");
}

console.log("== 2/4 原始录像（裁剪源） ==");
const srcs = [...new Set(table.clips.filter(c => !c.manual).map(c => c.src))];
for (const s of srcs) {
  const f = path.join(ROOT, table.rawDir, s);
  existsSync(f) ? ok("raw/" + s) : bad("raw/" + s + "  缺失（无法重裁）");
}

console.log("== 3/4 展示（" + PRESENT + "） ==");
const P = path.join(ROOT, PRESENT);
const SRC = path.join(P, "src");
const PARTS = ["p_top.txt", "p_style.css", "p_mid.txt", "p_script.js", "p_end.txt"];
let partsOk = true;
for (const p of PARTS) if (!existsSync(path.join(SRC, p))) { bad("src/" + p + "  缺失"); partsOk = false; }
if (partsOk) {
  try {
    execFileSync(process.execPath, ["--check", path.join(SRC, "p_script.js")], { stdio: "ignore" });
    ok("p_script.js 语法");
    let html = "";
    for (const p of PARTS) html += readFileSync(path.join(SRC, p), "utf8");
    const built = Buffer.byteLength(html);
    const cur = Buffer.byteLength(readFileSync(path.join(P, "index.html")));
    built === cur ? ok("index.html 与构建源一致（" + built + " B）") : no("index.html（" + cur + " B）≠ 构建源（" + built + " B）→ node pipeline/build.mjs");
  } catch (e) { bad("p_script.js 语法错误: " + e.message); }
}
const posters = ["storm-dusk-sea", "ocean-vortex", "thunderstrom"].flatMap(f => ["Q4", "Q5", "nvfp4"].map(q => "shot-" + f + "-" + q + ".png"));
const missA = posters.filter(p => !existsSync(path.join(P, "assets", p)));
missA.length ? bad("assets 缺海报: " + missA.join(", ")) : ok("assets 9 张海报齐全");
existsSync(path.join(P, "assets", "music-loop.wav")) ? ok("assets/music-loop.wav") : bad("assets/music-loop.wav 缺失");

console.log("== 4/4 文档与配音 ==");
for (const f of ["docs/规划.txt", "dubbing/字幕.txt", "dubbing/tts_clips"]) {
  existsSync(path.join(ROOT, f)) ? ok(f) : no(f + "  缺失（可选）");
}

console.log("\n结果: " + pass + " 通过 / " + warn + " 警告 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
