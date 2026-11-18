// 过渡动画探针：不设 ?anim=0（那会连 transition 一起关掉），进第 4 页后把 data-stage 推到 "2"，
// 每 60ms 采一次两态的 computed opacity，确认表格是「淡出」而不是瞬间消失，柱图是「淡入」。
// 反向对照：全程不设 data-stage 时必须一直停在表格态，否则这条断言等于没测。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = "$PROJECT_ROOT/arena-effthink";
const PORT = 9391;
const BIN = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const chrome = spawn(BIN, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(os.tmpdir(), "arena-pane-probe")}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(300);
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = l.find((t) => t.type === "page"); } catch { }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const waiting = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
const cdp = (method, params) => new Promise((res) => { const i = ++seq; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const ev = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: expr, returnByValue: true }); return r.result.result.value; };

await cdp("Page.enable"); await cdp("Runtime.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await cdp("Page.navigate", { url: "file:///" + ROOT + "/index.html" });
await sleep(3000);
await ev("(function(){for(var i=0;i<3;i++)document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));return 1;})()");
await sleep(1600);

const probe = "(function(){var p=document.querySelector('.page.active');var t=p.querySelector('.pane.tb'),b=p.querySelector('.pane.bb');" +
  "var cs=function(e){return +getComputedStyle(e).opacity.slice(0,4);};return [p.dataset.stage||'-',cs(t),cs(b)].join('|');})()";
console.log("切换前 " + await ev(probe));
const ctl = [];
for (let i = 0; i < 6; i++) { ctl.push(await ev(probe)); await sleep(60); }
console.log("反向对照（不动 data-stage）" + [...new Set(ctl)].join("  "));
await ev("document.querySelector('.page.active').dataset.stage='2';1");
const rows = [];
for (let i = 0; i < 16; i++) { rows.push(await ev(probe)); await sleep(60); }
console.log("切换后逐帧：");
rows.forEach((r, i) => console.log("  t+" + (i * 60) + "ms  stage=" + r));
await sleep(700);
console.log("收尾   " + await ev(probe));
ws.close(); chrome.kill();
