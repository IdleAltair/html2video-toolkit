// 版式体检：无头 Chrome + CDP，逐页量三件事——内容底边是否越过 1080、有没有内容被 overflow 藏住、
// SVG 里的文字/图形是否画出 viewBox（画出就被裁掉，DOM 量不到：第 4 页整条图飞出去过、第 7 页「基准 606」被裁成「基准 6」）
// 用法: node pipeline/layout.mjs [起始页] [结束页]
// 前提: 本机有 Chrome/Edge，且已跑过 node build.mjs。等 document.fonts.ready 之后再量，
//       否则中文 webfont 未加载，数字会系统性偏小（这个坑踩过）。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 9377;
const CAND = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const BIN = CAND.find(existsSync);
if (!BIN) { console.error("找不到 Chrome/Edge，无法量版式"); process.exit(2); }

const chrome = spawn(BIN, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(os.tmpdir(), "arena-video-layout")}`, "about:blank"], { stdio: "ignore" });
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
// ?anim=0 关掉入场动效：量的必须是终态，动画中途的 translateY / scaleX 会把底边量小
await cdp("Page.navigate", { url: "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/") + "?anim=0" });
await sleep(2500);

const countR = await cdp("Runtime.evaluate", { expression: "document.querySelectorAll('.page').length", returnByValue: true });
const TOTAL = Number((countR.result && countR.result.result && countR.result.result.value) || 0);
if (!TOTAL) { ws.close(); chrome.kill(); console.error("没找到 .page，先跑 node build.mjs"); process.exit(2); }
const a = Number(process.argv[2] || 1), b = Math.min(Number(process.argv[3] || TOTAL), TOTAL);
console.log("共 " + TOTAL + " 页，检查第 " + a + "–" + b + " 页\n");
let bad = 0, seen = 0;
for (let n = a; n <= b; n++) {
  const expr = `(async function(){
    function key(k){ document.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true})); }
    for(var i=0;i<40;i++) key('ArrowLeft');
    for(var j=1;j<${n};j++) key('ArrowRight');
    if(document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    var p=document.querySelector('.page.active');
    if(!p) return {skip:true};
    var lim=p.getBoundingClientRect().bottom-parseFloat(getComputedStyle(p).paddingBottom);
    var mb=0,at='',hidden=0;
    p.querySelectorAll('*').forEach(function(e){
      var r=e.getBoundingClientRect(); if(!r.width&&!r.height) return;
      if(r.bottom>mb){mb=r.bottom;at=(typeof e.className==='string'?e.className:e.tagName).slice(0,24);}
      var oy=getComputedStyle(e).overflowY;
      if(e.scrollHeight-e.clientHeight>4&&/auto|hidden|scroll/.test(oy))hidden+=e.scrollHeight-e.clientHeight;
    });
    // SVG 里超出 viewBox 的内容会被直接裁掉，DOM 的 getBoundingClientRect 量不到（第 4 页曾整条图飞出画布还报 ok）
    var svgOut=0,svgAt='';
    p.querySelectorAll('svg').forEach(function(s){
      var vb=s.viewBox&&s.viewBox.baseVal; if(!vb||!vb.width) return;
      s.querySelectorAll('*').forEach(function(e){
        if(!/^(text|rect|circle)$/i.test(e.tagName)) return;   // line/path 多是装饰连线，bbox 会虚高
        if(typeof e.getBBox!=='function') return;
        var b; try{ b=e.getBBox(); }catch(x){ return; }
        if(!b.width&&!b.height) return;
        var ovr=Math.max(b.x+b.width-vb.x-vb.width, vb.x-b.x, b.y+b.height-vb.y-vb.height, vb.y-b.y);
        if(ovr>svgOut){ svgOut=Math.round(ovr); svgAt=e.tagName+':'+(e.textContent||'').slice(0,12)+'@'+Math.round(b.x)+'→'+Math.round(b.x+b.width); }
      });
    });
    return {bot:Math.round(mb),over:Math.round(mb-lim),past:Math.round(mb-1080),hidden:Math.round(hidden),svg:svgOut,at:at+' '+svgAt};
  })()`;
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  const v = r.result && r.result.result ? r.result.result.value : null;
  if (!v || v.skip) break;
  seen++;
  const fail = v.past > 0 || v.hidden > 4 || v.svg > 2;
  if (fail) bad++;
  console.log(String(n).padStart(2), fail ? "FAIL" : "ok  ", "底边", String(v.bot).padStart(5),
    "超视口", String(v.past).padStart(4), "超内容线", String(v.over).padStart(4), "被藏", String(v.hidden).padStart(4),
    "出框", String(v.svg).padStart(4), v.at);
}
ws.close(); chrome.kill();
console.log("\n" + seen + " 页，破版 " + bad + " 页" + (bad ? "（底边越过 1080 / 内容落在滚动框外 / SVG 画出 viewBox 被裁）" : "，全部在 1080 视口内"));
process.exit(bad ? 1 : 0);
