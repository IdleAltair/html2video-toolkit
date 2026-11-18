// 逐页截图：无头 Chrome + CDP，键盘翻页后 captureScreenshot，出图到 shots/pNN.png
// 用法: node pipeline/shots.mjs [起始页] [结束页]     默认全 17 页
// 前提: 已跑过 node build.mjs。截的是终态（?anim=0 关入场动效），与录屏时的动效无关。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "shots");
const PORT = 9379;
const BIN = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!BIN) { console.error("找不到 Chrome/Edge"); process.exit(2); }
if (!existsSync(OUT)) mkdirSync(OUT);

const chrome = spawn(BIN, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(os.tmpdir(), "arena-video-shots")}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(300);
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = l.find((t) => t.type === "page") || null;
  } catch { /* 还没起来 */ }
}
if (!target) { chrome.kill(); console.error("CDP 端点没起来"); process.exit(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const waiting = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
const cdp = (method, params) => new Promise((res) => { const i = ++seq; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });

await cdp("Page.enable"); await cdp("Runtime.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await cdp("Page.navigate", { url: "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/") + "?anim=0&" + (process.env.PAGE_QS || "") });
await sleep(2500);

const countR = await cdp("Runtime.evaluate", { expression: "document.querySelectorAll('.page').length", returnByValue: true });
const TOTAL = Number((countR.result && countR.result.result && countR.result.result.value) || 0);
if (!TOTAL) { ws.close(); chrome.kill(); console.error("没找到 .page，先跑 node build.mjs"); process.exit(2); }
const a = Number(process.argv[2] || 1), b = Math.min(Number(process.argv[3] || TOTAL), TOTAL);
console.log("共 " + TOTAL + " 页，截第 " + a + "–" + b + " 页");

for (let n = a; n <= b; n++) {
  const expr = `(async function(){
    function key(k){ document.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true})); }
    for(var i=0;i<45;i++) key('ArrowLeft');
    for(var j=1;j<${n};j++) key('ArrowRight');
    if(document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    var p=document.querySelector('.page.active');
    return p ? (document.querySelector('#cap')||{}).textContent || '' : 'NO-PAGE';
  })()`;
  const cap = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  const shot = await cdp("Page.captureScreenshot", { format: "png" });
  const name = "p" + String(n).padStart(2, "0") + ".png";
  writeFileSync(path.join(OUT, name), Buffer.from(shot.result.data, "base64"));
  console.log("  " + name + "  " + ((cap.result && cap.result.result && cap.result.result.value) || "").trim());
  await sleep(120);
}
ws.close(); chrome.kill();
console.log("-> shots/");
