// 入场动效实测探针：同一根条在 t 时刻的宽度必须随时间变化，最后停在终态
// 用法: node pipeline/anim-probe.mjs [页码，默认 6] [选择器，默认 .fig svg .bar]
// 例: node pipeline/anim-probe.mjs 13 ".fig svg .lnpath"   ← 量折线描边
const SEL = process.argv[3] || ".fig svg .bar";
// 为什么单独一个脚本：check.mjs 是 DOM 桩渲染（不跑 CSS 动画），layout.mjs 走 ?anim=0 量终态，
// 两边都看不见动画。动画有没有真跑、多久跑完，只能开无头 Chrome 按时刻采样。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = Number(process.argv[2] || 6);
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"]
  .map((p) => p.replace(/\//g, path.sep)).find((p) => existsSync(p));
if (!CHROME) { console.log("找不到 Chrome/Edge"); process.exit(1); }

const port = 9333 + (PAGE % 40);
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + port,
  "--user-data-dir=" + path.join(ROOT, "pipeline", ".prof-anim"), "--no-first-run",
  "--disable-gpu", "--window-size=1920,1080", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const res = await fetch("http://127.0.0.1:" + port + "/json/list").then((r) => r.json()).catch(() => null);
  return res;
}
let list = null;
for (let i = 0; i < 40 && !list; i++) { await sleep(300); list = await targets(); }
const page = (list || []).find((t) => t.type === "page");
if (!page) { console.log("没拿到调试目标"); chrome.kill(); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pend = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const cdp = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const ev = async (expression) => {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : null;
};

await cdp("Page.enable"); await cdp("Runtime.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await cdp("Page.navigate", { url: "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/") });
await sleep(2600);

// 采样用 setInterval 而不是 requestAnimationFrame —— 无头 Chrome 不保证逐帧驱动 rAF，
// 用 rAF 会得到"一条都没采到"的假阴性。整段在一个 awaitPromise 里跑完，不跨调用传状态。
const rows = await ev(`new Promise(function (done) {
  function key(k){ document.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true})); }
  var out = [], t0 = performance.now();
  var h = setInterval(function () {
    var p = document.querySelectorAll('.page')[${PAGE - 1}];
    var b = p && p.querySelector('${SEL}');
    // 折线的 bbox 不随 stroke-dashoffset 变，描边进度只能读 computed 值
    var w = b ? (/lnpath/.test('${SEL}') ? parseFloat(getComputedStyle(b).strokeDashoffset) : +b.getBoundingClientRect().width.toFixed(1)) : null;
    if (w != null && !isNaN(w)) out.push([Math.round(performance.now() - t0), +w.toFixed(2)]);
    if (performance.now() - t0 > 2000) { clearInterval(h); done(JSON.stringify(out)); }
  }, 40);
  for (var j = 1; j < ${PAGE}; j++) key('ArrowRight');
})`);

const samples = JSON.parse(rows || "[]");
if (!samples.length) { console.log("没采到样本（第 " + PAGE + " 页可能没有条形图）"); chrome.kill(); process.exit(1); }
const final = samples[samples.length - 1][1];
const first = samples[0][1];
const growAt = samples.find((s) => s[1] >= final - 0.5);
console.log("第 " + PAGE + " 页首根条宽度采样 " + samples.length + " 点");
console.log("  起始 " + first + " → 终态 " + final + " px");
console.log("  到达终态于 " + (growAt ? growAt[0] + "ms" : "未在 2s 内完成"));
const uniq = new Set(samples.map((s) => s[1])).size;
console.log("  不同宽度取值 " + uniq + " 个" + (uniq > 3 ? " → 动画在跑" : " → 疑似没动画"));
await cdp("Emulation.clearDeviceMetricsOverride").catch(() => {});
chrome.kill();
process.exit(0);
