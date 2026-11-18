// 按 cuts.json 从 raw/ 裁剪成片到 clips/（HEVC 2560x1440@60 + AAC，与现有剪辑一致）
// 用法:
//   node pipeline/cut.mjs --list              列出剪辑表
//   node pipeline/cut.mjs Q4-test1            裁一段（名可省 .mp4）
//   node pipeline/cut.mjs --all               裁全部非 manual 段
//   node pipeline/cut.mjs --dry Q4-test1      只打印命令
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, ffmpeg, mediaDur, run, f1 } from "./lib.mjs";

const table = JSON.parse(readFileSync(path.join(ROOT, "pipeline", "cuts.json"), "utf8"));

const args = process.argv.slice(2);
const dry = args.includes("--dry");

function match(name) {
  return table.clips.find(c => c.name === name || c.name === name + ".mp4");
}

if (args.includes("--list") || args.length === 0) {
  console.log("剪辑表（" + table.clips.length + " 段）:");
  for (const c of table.clips) {
    const dur = c.manual ? c.dur : c.out - c.in;
    console.log("  " + c.name.padEnd(32) + (c.manual ? " [manual] " : "") + " " + (c.mark || "") + "  " + dur + "s  " + c.scene);
  }
  process.exit(0);
}

let names = args.filter(a => !a.startsWith("--"));
if (args.includes("--all")) names = table.clips.filter(c => !c.manual).map(c => c.name);
if (names.length === 0) { console.error("用法见文件头注释"); process.exit(1); }

let fail = 0;
for (const n of names) {
  const c = match(n);
  if (!c) { console.error("[cut] 剪辑表无此段: " + n); fail++; continue; }
  if (c.manual) { console.log("[cut] 跳过 manual 段: " + c.name + "（手工裁出，无入点记录）"); continue; }
  const src = path.join(ROOT, table.rawDir, c.src);
  const out = path.join(ROOT, table.outDir, c.name);
  const dur = c.out - c.in;
  if (!existsSync(src)) { console.error("[cut] 缺原始录像: " + src); fail++; continue; }
  const ffargs = ["-y", "-ss", String(c.in), "-i", src, "-t", String(dur), ...table.encode, out];
  if (dry) {
    console.log("[dry] " + ffmpeg() + " " + ffargs.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(" "));
    continue;
  }
  run(ffmpeg(), ffargs, c.name);
  const got = mediaDur(out);
  const ok = Math.abs(got - dur) <= 0.75;
  console.log("[cut] " + c.name + " 时长 " + f1(got) + "s（期望 " + dur + "s）" + (ok ? " ✓" : " ✗ 偏差过大"));
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
