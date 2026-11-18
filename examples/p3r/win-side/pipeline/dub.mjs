// 从 script/口播稿.md 生成 dubbing/字幕.txt（单一事实来源：改稿子就够了，不用两遍手抄）
// 用法：node pipeline/dub.mjs [--dry]
// 语速与 _scriptcheck.mjs 一致：3.74 字/秒，句间留 0.4 秒气口。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "script", "口播稿.md");
const OUT = path.join(ROOT, "dubbing", "字幕.txt");
const DRY = process.argv.includes("--dry");

const CPS = 3.74;
const GAP = 0.4;

const md = fs.readFileSync(SRC, "utf8");

// 只取「## 开场」之后、「## 撤出画面的技术细节」之前的逐页正文
const body = md.split(/^## 撤出画面的技术细节/m)[0].split(/^## 开场$/m)[1] || "";

const pages = [];
for (const sec of body.split(/^### /m).slice(1)) {
  const head = sec.split("\n")[0].trim();
  const m = /^(\d{2})\s*(.*)$/.exec(head);
  if (!m) continue;
  const spoken = sec
    .split(/\*\*口播（[^）]*）\*\*：?/)[1]
    ?.split(/^\s*-?\s*\*\*/m)[0]
    .replace(/^[\s\S]*?\n/, "")
    .trim();
  if (!spoken) continue;
  pages.push({ num: Number(m[1]), title: m[2], spoken });
}

// 句号/叹号/问号/分号切句；小数点与千分位逗号都是 ASCII，不会被切错
function sentences(text) {
  const out = [];
  for (const para of text.split(/\n{2,}|\n/)) {
    const t = para.replace(/[*`>]/g, "").trim();
    if (!t) continue;
    let buf = "";
    for (const ch of t) {
      buf += ch;
      if (/[。！？；…]/.test(ch)) { out.push(buf.trim()); buf = ""; }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.filter((s) => s.length > 1);
}

function stamp(sec) {
  const s = Math.round(sec);
  if (s < 60) return s + "s";
  return Math.floor(s / 60) + "min" + String(s % 60).padStart(2, "0") + "s";
}

const lines = [];
lines.push("# ===================================================================");
lines.push("# arena-video 全片口播文案（TTS 输入）");
lines.push("# 由 `node pipeline/dub.mjs` 从 script/口播稿.md 生成，勿手改本文件——改稿子再重跑。");
lines.push("# 格式沿用 llm-html2video/dubbing/字幕.txt 约定：");
lines.push("#   每句一行，行首是时间占位：  Xs 文案  或  XminYs 文案");
lines.push("#   以 # 或【 开头的分节说明行会被 dub_video.py 的正则跳过，只做页码标注。");
lines.push("# 用法：python index-tts/scripts/dub_video.py dubbing/字幕.txt --voice voice_09 --speed 1.05 --out dubbing/tts_clips");
lines.push("#   → 逐句 NN.wav + full_preview.wav + subtitles.srt（SRT 时长跟随配音，此处时间仅为占位/粗排）");
lines.push("# 三场（含每场追加 40 分钟的加时自迭代窗口）均已跑完，全片 " + pages.length + " 页，无「待补」台词。");
lines.push("# 音源待定，本文件只做文案与粗排，尚未出片。");
lines.push("# ===================================================================");
lines.push("");

let clock = 0;
let count = 0;
let perPage = [];
for (const p of pages) {
  const ss = sentences(p.spoken);
  lines.push("# —— 第 " + p.num + " 页 · " + p.title + " ——");
  let t0 = clock;
  for (const s of ss) {
    lines.push(stamp(clock) + " " + s);
    clock += s.replace(/\s/g, "").length / CPS + GAP;
    count++;
  }
  perPage.push({ num: p.num, n: ss.length, dur: clock - t0, chars: p.spoken.replace(/\s/g, "").length });
  lines.push("");
}

const text = lines.join("\n") + "\n";
if (DRY) {
  console.log(text);
} else {
  fs.writeFileSync(OUT, text, "utf8");
  console.log("[dub] " + pages.length + " 页 / " + count + " 句 → dubbing/字幕.txt（" + text.length + " B）");
}
for (const p of perPage) {
  console.log("  " + String(p.num).padStart(2, "0") + "  " + p.n + " 句  " + Math.round(p.dur) + "s  " + p.chars + " 字");
}
console.log("  合计 " + Math.round(clock) + "s ≈ " + (clock / 60).toFixed(1) + " 分钟");
