#!/usr/bin/env node
/**
 * 零依赖 4K 实录器（Windows / WSL 通用，Node >= 22 —— 它自带 WebSocket 与 fetch，不需要 npm install）
 *
 *   Windows（Git Bash / PowerShell / cmd 都可以）：
 *     node record-4k.mjs --out $TMP/deck-4k.mp4 --seconds 860 --w 3840 --h 2160 --fps 60
 *
 * 它做四件事：起一个真实窗口的 Chrome（走独显渲染）→ 打开分镜页并等字体就绪 →
 * 调 window.__startCue() 那一刻起按帧截图（边收边写盘，不会 OOM）→ 用 ffmpeg 合成 mp4 并打印实测采集速率。
 * 页面必须带 ?cue=1&auto=1&clean=1&wait=1（脚本已内置），时间轴由 __startCue() 归零。
 */
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const OUT = path.resolve(opt('out', 'deck-4k.mp4'));
const SEC = Number(opt('seconds', 860));
const W = Number(opt('w', 3840)), H = Number(opt('h', 2160));
const FPS = Number(opt('fps', 60));
const QUAL = Number(opt('quality', 90));
const PORT = Number(opt('port', 9333));
const ROOT = opt('root', process.cwd());
const FFMPEG = opt('ffmpeg', process.platform === 'win32' ? '$PROJECT_ROOT/bin/ffmpeg.exe' : 'ffmpeg');
const CHROME = opt('chrome', process.platform === 'win32'
  ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync)
  : '/usr/bin/google-chrome');
const PAGE = 'file:///' + ROOT.replace(/\\/g, '/').replace(/\/$/, '') + '/index.html?cue=1&auto=1&clean=1&wait=1';
const FRAMES = OUT.replace(/\.mp4$/i, '') + '-frames';

if (!CHROME || !existsSync(CHROME)) { console.error('找不到 Chrome，用 --chrome <路径> 指定'); process.exit(1); }
if (existsSync(FRAMES)) rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + PORT,
  '--window-size=' + W + ',' + H, '--window-position=0,0',
  '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
  '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(FRAMES, 'profile'),
  PAGE,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (p && p.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  throw new Error('等不到调试端口，Chrome 可能没起来');
}
const ws = new WebSocket(await target());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pend = new Map();
const send = (method, params) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((res) => { ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } }; res(); });
const evaluate = async (expr, awaitP = false) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: awaitP, returnByValue: true })).result?.value;

await send('Page.enable');
await send('Runtime.enable');
await evaluate('document.fonts ? document.fonts.ready.then(() => 1) : 1', true);
await sleep(1200);

const shots = []; let idx = 0;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
  if (m.method === 'Page.screencastFrame') {
    const f = m.params;
    const name = 'f' + String(idx++).padStart(5, '0') + '.jpg';
    try { writeFileSync(path.join(FRAMES, name), Buffer.from(f.data, 'base64')); } catch { /* 磁盘满则丢帧不中断 */ }
    shots.push({ t: f.metadata.timestamp, n: name });
    send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  }
};
await send('Page.startScreencast', { format: 'jpeg', quality: QUAL, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
while (shots.length < 3) await sleep(50);
const tStart = shots[shots.length - 1].t;
await evaluate('window.__startCue && window.__startCue()');
const t0 = Date.now();
while (Date.now() - t0 < SEC * 1000) await sleep(200);
await sleep(400);
await send('Page.stopScreencast');
const flips = await evaluate('window.__flips || []');
writeFileSync(path.join(FRAMES, 'flips.json'), JSON.stringify(flips));
chrome.kill();

let first = 0;
for (let i = 0; i < shots.length; i++) { if (shots[i].t <= tStart) first = i; else break; }
const kept = shots.slice(first);
if (kept.length < 3) { console.error('只采到 ' + kept.length + ' 帧，放弃'); process.exit(1); }
kept[0].t = tStart;
const span = kept[kept.length - 1].t - tStart;
const rate = span > 0 ? (kept.length / span) : 0;
const list = [];
for (let i = 0; i < kept.length; i++) {
  const dt = i + 1 < kept.length ? Math.max(1e-3, kept[i + 1].t - kept[i].t) : 1 / FPS;
  list.push("file '" + kept[i].n + "'", 'duration ' + dt.toFixed(4));
}
list.push("file '" + kept[kept.length - 1].n + "'");
writeFileSync(path.join(FRAMES, 'list.txt'), list.join('\n') + '\n');
console.log('[采集] 帧数 ' + kept.length + ' / 时长 ' + span.toFixed(1) + 's → 实测 ' + rate.toFixed(1) + ' fps'
  + (rate < FPS * 0.92 ? '（低于 --fps ' + FPS + '，成片按实际速率编码即可，别硬拉 60）' : '（达标）'));
const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
  '-vf', 'fps=' + FPS + ',scale=' + W + ':' + H + ':force_original_aspect_ratio=decrease,pad=' + W + ':' + H + ':(ow-iw)/2:(oh-ih)/2',
  '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT],
  { cwd: FRAMES, stdio: 'inherit' });
if (r.status !== 0) { console.error('ffmpeg 合成失败，帧序列留在 ' + FRAMES); process.exit(1); }
console.log('[合成] ' + OUT + '（flips.json 在同名 -frames 目录里，回传我）');
