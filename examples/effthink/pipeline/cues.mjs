// 由 script/口播稿.md 生成 data/cues.json —— 整片翻页时间表 + 逐句节拍（?cue=1&auto=1 用）
// 用法: node pipeline/cues.mjs [--tail 12] [--pad 1.5] [--out data/cues.json]
// 口径：每页停留 = 稿子里「口播（N 秒）」的标注秒数；页内各句按汉字数分摊，
//       分摊窗口 = 标注秒数 / 1.15（标注含 15% 气口余量，与重标秒数的口径一致），
//       窗口末尾剩下的那截留给翻页前的停顿，保证最后一句的元素赶在切页前露完。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = (rel) => path.join(ROOT, rel);
const opt = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1]; };
const OUT = opt("out", "data/cues.json");
const TAIL = Number(opt("tail", 12));   // 尾页（无口播）停留：沉海 2.6s + 停一停
const PAD = Number(opt("pad", 1.5));    // 第 1 页前的静默，给录屏留开机时间
const CPS = 5.5, GAP = 0.35, LEAD = 0.4, OVER = 1.15;
const BANNED = ["补时", "overtime-interruptions", "补偿时长", "冻结", "噪声底", "重抽", "哈希",
  "sha1", "schedule_seed", "上一轮", "本轮", "这一轮", "MTP", "n_max", "草稿深度", "spec-draft"];

if (!existsSync(R("script/口播稿.md"))) throw new Error("缺 script/口播稿.md");
const md = readFileSync(R("script/口播稿.md"), "utf8").replace(/\r/g, "");
const secs = [...md.matchAll(/^### (\d\d)[ \t]*(.*)$/gm)];
const caps = [...readFileSync(R("src/p_script.js"), "utf8").matchAll(/\{ cap: "([^"]+)"/g)].map((m) => m[1]);
if (secs.length !== caps.length) throw new Error("口播稿 " + secs.length + " 节 ≠ 画面 " + caps.length + " 页，先同步页数");
secs.forEach((m, i) => { if (Number(m[1]) !== i + 1) throw new Error("口播稿节号不连续：" + m[1] + "（应 " + (i + 1) + "）"); });

// 句子按中文句号切开（小数点、千分位不含这些字符，不会误切）
function sentences(t) {
  const out = [];
  for (const line of t.split(/\n+/)) {
    const s = line.replace(/[*`]/g, "").trim();
    if (!s) continue;
    let buf = "";
    for (const ch of s) { buf += ch; if ("。！？；…".indexOf(ch) >= 0) { out.push(buf.trim()); buf = ""; } }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.filter((x) => x.length > 1);
}
const han = (s) => (s.match(/[一-鿿]/g) || []).length;
const round = (x) => Math.round(x * 1000) / 1000;

const pages = [], sents = [], warn = [];
let clock = PAD;
for (let k = 0; k < secs.length; k++) {
  const n = Number(secs[k][1]);
  const end = k + 1 < secs.length ? secs[k + 1].index : md.length;
  const body = md.slice(secs[k].index + secs[k][0].length, end);
  const mk = /\*\*口播（(\d+) 秒）\*\*：?/.exec(body);
  const spoken = mk ? body.slice(mk.index + mk[0].length)
    .split(/^\s*-?\s*\*\*/m)[0].split("---")[0].trim() : "";
  const ss = sentences(spoken);
  const start = clock;
  let dur;
  if (!ss.length) {
    if (mk) throw new Error("第 " + n + " 节标了秒数却切不出句子");
    dur = TAIL;
    if (n !== secs.length) warn.push("第 " + n + " 节没有口播，按静默页给 " + TAIL + " 秒");
  } else {
    if (!mk) throw new Error("第 " + n + " 节有口播但没标「口播（N 秒）」");
    dur = Number(mk[1]);
    const w = ss.map((s) => Math.max(1, han(s)));
    const natural = w.reduce((a, x) => a + x / CPS, 0) + GAP * (ss.length - 1);
    const window = dur / OVER - LEAD;
    let scale = window / natural;
    if (scale < 0.6 || scale > 1.9) {
      warn.push("第 " + n + " 节实测分摊系数 " + round(scale) + "（标注 " + dur + " 秒 / 稿面 " +
        round(natural) + " 秒），秒数与文本不太对得上");
      scale = Math.min(1.9, Math.max(0.6, scale));
    }
    let acc = LEAD;
    ss.forEach((s, i) => {
      sents.push({ page: n, start: round(start + acc), dur: round(w[i] / CPS * scale), text: s });
      acc += (w[i] / CPS + GAP) * scale;
    });
  }
  pages.push({ start: round(start), dur: round(dur), title: secs[k][2].trim(), cap: caps[k], n: ss.length });
  clock += dur;
}
const last = pages[pages.length - 1];
pages.forEach((p, i) => {
  const nx = pages[i + 1];
  if (nx && round(p.start + p.dur) !== nx.start) throw new Error("第 " + (i + 1) + " 页时间表不闭合");
});
// 画廊那页靠 data-beat 换片，节拍句数必须够
const BT = (readFileSync(R("src/p_script.js"), "utf8").match(/var BT = \[([\d,\s]+)\]/) || [null, ""])[1]
  .split(",").map((x) => Number(x.trim())).filter((x) => x > 0);
if (BT.length) {
  const mx = Math.max.apply(null, BT), p3 = pages[2];
  if (!p3 || p3.n < mx) throw new Error("画廊页（第 3 页）只有 " + (p3 ? p3.n : 0) + " 句，data-beat 最大到 " + mx);
}
const allText = sents.map((s) => s.text).join(" ");
const hit = BANNED.filter((w) => allText.includes(w));
if (hit.length) throw new Error("口播文本里带着不该上画面的口径：" + hit.join(" / "));

const out = {
  note: "由 pipeline/cues.mjs 从 script/口播稿.md 生成，勿手改；改稿后重跑 node pipeline/cues.mjs && node build.mjs",
  cps: CPS, gap: GAP, lead: LEAD, pad: PAD, tail: TAIL,
  total: round(clock), sentences: sents.length, pages: pages.length,
};
out.pages = pages;
out.sentences = sents;
writeFileSync(R(OUT), JSON.stringify(out), "utf8");

console.log("== 逐页时间表（" + pages.length + " 页 / " + sents.length + " 句 / 总 " +
  round(clock) + " 秒 = " + Math.floor(clock / 60) + " 分 " + Math.round(clock % 60) + " 秒）==");
pages.forEach((p, i) => {
  const mm = Math.floor(p.start / 60), ss2 = (p.start % 60).toFixed(1).padStart(4, "0");
  console.log(("  " + (i + 1)).slice(-3) + "  " + mm + "m" + ss2 + "s  +" + String(p.dur).padStart(3) + "s  " +
    p.n + " 句  " + p.title);
});
const end = last.start + last.dur;
console.log("\n落幕在 " + round(end - 3.2) + " 秒（p_script 提前 3.2s 拉绳），整片结束 " + round(end) + " 秒");
console.log("录整片：node pipeline/record-deck.mjs $TMP/deck-silent.mp4 --seconds " +
  Math.ceil(end + 3) + " --chrome \"C:/Program Files/Google/Chrome/Application/chrome.exe\" --ffmpeg \"$PROJECT_ROOT/bin/ffmpeg.exe\" --root \"$PROJECT_ROOT/arena-effthink\"");
if (warn.length) console.log("\n需注意：\n  " + warn.join("\n  "));
