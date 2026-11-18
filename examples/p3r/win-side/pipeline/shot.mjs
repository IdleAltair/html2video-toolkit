// 逐页截图（无头 Chrome + CDP）：醒来看图验收浅色版式和 SVG 图表用，也用于录屏前的构图检查
// 用法: node pipeline/shot.mjs 1,4,12,17        → 输出到 %TEMP%/arena-shot/p01.png …
//       node pipeline/shot.mjs all             → 全部页
// 说明: 与 layout.mjs 同一套 CDP 通道；等 document.fonts.ready 之后再拍，否则中文字体没加载完。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(os.tmpdir(), "arena-shot");
mkdirSync(OUT, { recursive: true });
const PORT = 9378;
const BIN = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!BIN) { console.error("找不到 Chrome/Edge"); process.exit(2); }

const chrome = spawn(BIN, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(os.tmpdir(), "arena-video-shot")}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(300);
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = l.find((t) => t.type === "page") || null; } catch { }
}
if (!target) { chrome.kill(); console.error("CDP 端点没起来"); process.exit(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const waiting = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
const cdp = (method, params) => new Promise((res) => { const i = ++seq; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });

await cdp("Page.enable"); await cdp("Runtime.enable");
// 2560×1440 是录屏目标分辨率；deviceScaleFactor 1，截图即成片构图
await cdp("Emulation.setDeviceMetricsOverride", { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
await cdp("Page.navigate", { url: "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/") });
await sleep(2600);

const countR = await cdp("Runtime.evaluate", { expression: "document.querySelectorAll('.page').length", returnByValue: true });
const TOTAL = Number((countR.result && countR.result.result && countR.result.result.value) || 0);
if (!TOTAL) { ws.close(); chrome.kill(); console.error("没有 .page，先跑 node build.mjs"); process.exit(2); }

const arg = process.argv[2] || "1";
const want = arg === "all" ? Array.from({ length: TOTAL }, (_, i) => i + 1) : arg.split(",").map((x) => Number(x)).filter(Boolean);

for (const n of want) {
  const expr = `(async function(){
    function key(k){ document.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true})); }
    for(var i=0;i<60;i++) key('ArrowLeft');
    for(var j=1;j<${n};j++) key('ArrowRight');
    if(document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    var p=document.querySelector('.page.active');
    return p ? (p.dataset.i) : -1;
  })()`;
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  const shown = r.result && r.result.result ? r.result.result.value : null;
  if (String(shown) !== String(n - 1)) { console.log("跳过第 " + n + " 页（当前停在 " + shown + "）"); continue; }
  await sleep(1700);   // 擦除转场 620ms + 入场动效最长约 1.5s，等它走完再拍
  const shot = await cdp("Page.captureScreenshot", { format: "png" });
  // Page.captureScreenshot 的返回值直接挂在 m.result 上（不像 Runtime.evaluate 还有一层 result）
  const b64 = shot.result && (shot.result.data || (shot.result.result && shot.result.result.data));
  if (!b64) { console.error("第 " + n + " 页截图失败"); continue; }
  const f = path.join(OUT, "p" + String(n).padStart(2, "0") + ".png");
  writeFileSync(f, Buffer.from(b64, "base64"));
  console.log("写出 " + f);
}
ws.close(); chrome.kill();
