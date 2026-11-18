#!/usr/bin/env node
/**
 * 分镜整片录制（跨平台：Windows 实机 / WSL 都可用）。
 *
 *   Windows 例：
 *     node record-deck.mjs $TMP/deck-p01-03.mp4 --seconds 139 \
 *       --chrome "C:/Program Files/Google/Chrome/Application/chrome.exe" \
 *       --ffmpeg "$PROJECT_ROOT/bin/ffmpeg.exe" \
 *       --root  "$WORKSPACE/arena-p3r-sample"
 *
 * 页面按 ?cue=1&auto=1&clean=1&wait=1 打开，脚本调 window.__startCue() 时时间轴从 0 开始。
 * 录完在同目录写 <out>-frames/flips.json（页内实测翻页点），用于和成片对账。
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const argv = process.argv.slice(2);
const pos = argv.filter((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const OUT = pos[0];
const SEC = Number(opt('seconds', 60));
const W = Number(opt('w', 2560)), H = Number(opt('h', 1440)), FPS = Number(opt('fps', 30));
const opt2 = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const CHROME = opt2('chrome', '$HOME/deepseek-harness/workplace/.pw-browsers/chromium-1234/chrome-linux64/chrome');
const FFMPEG = opt2('ffmpeg', '$HOME/mamba/envs/ninfer/bin/ffmpeg');
const ROOT = opt2('root', '$HOME/deepseek-harness/workplace/arena-p3r-sample');
const URL = opt2('url', 'file://' + ROOT.replace(/\\/g, '/') + '/index.html?cue=1&auto=1&clean=1&wait=1');
if (!OUT) { console.error('用法: node arena-deck-record.mjs <out.mp4> --seconds N'); process.exit(2); }
const FRAMES = path.join(path.dirname(OUT), path.basename(OUT, '.mp4') + '-frames');
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--font-render-hinting=none', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => document.fonts && document.fonts.ready);
await new Promise((r) => setTimeout(r, 1200));

const client = await page.createCDPSession();
// 页内翻页日志：录完写 <out>-flips.json，用于和成片里检测到的切页点对账
await page.evaluate(() => {
  window.__flips = []; const t0 = performance.now();
  new MutationObserver(() => {
    const a = document.querySelector('.page.active');
    const i = a ? Number(a.dataset.i) : -1;
    const L = window.__flips[window.__flips.length - 1];
    if (!L || L[1] !== i) window.__flips.push([Math.round(performance.now() - t0), i]);
  }).observe(document.getElementById('stage'), { subtree: true, attributes: true, attributeFilter: ['class'] });
});
const shots = [];
let wIdx = 0;
client.on('Page.screencastFrame', async (f) => {
  // 边收边落盘：整片 14 分钟约 2.5 万帧，全留在内存会 OOM
  const name = 'f' + String(wIdx++).padStart(5, '0') + '.jpg';
  try { writeFileSync(path.join(FRAMES, name), Buffer.from(f.data, 'base64')); } catch { /* 磁盘满时丢帧不中断 */ }
  shots.push({ t: f.metadata.timestamp, n: name });
  try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* 会话已关 */ }
});
await client.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
while (shots.length < 3) await new Promise((r) => setTimeout(r, 30));
const tStart = shots[shots.length - 1].t;
await page.evaluate(() => window.__startCue && window.__startCue());
const t0 = Date.now();
while (Date.now() - t0 < SEC * 1000) await new Promise((r) => setTimeout(r, 200));
await new Promise((r) => setTimeout(r, 300));
await client.send('Page.stopScreencast');
const flips = await page.evaluate(() => window.__flips);
await browser.close();
writeFileSync(path.join(FRAMES, 'flips.json'), JSON.stringify(flips));
{ // 实测采集速率：它决定成片能不能真上 60fps（采集跟不上时 fps=60 只是把帧复制一遍）
  const span = shots[shots.length - 1].t - tStart;
  const rate = span > 0 ? (shots.length / span) : 0;
  console.log('[采集] 帧数 ' + shots.length + ' / 时长 ' + span.toFixed(1) + 's → 实测 ' + rate.toFixed(1) + ' fps'
    + (rate < FPS * 0.92 ? '（低于目标 ' + FPS + '，成片会按实际速率编码，想要真 60fps 需要降分辨率或换机器）' : '（达标）'));
}

if (shots.length < 3) { console.error('只采到 ' + shots.length + ' 帧，放弃'); process.exit(1); }
let first = 0;
for (let i = 0; i < shots.length; i++) { if (shots[i].t <= tStart) first = i; else break; }
const kept = shots.slice(first);
for (let i = 0; i < kept.length; i++) if (i === 0) kept[i].t = tStart;
const list = [];
for (let i = 0; i < kept.length; i++) {
  const dt = i + 1 < kept.length ? Math.max(1e-3, kept[i + 1].t - kept[i].t) : 1 / FPS;
  list.push("file '" + kept[i].n + "'", 'duration ' + dt.toFixed(4));
}
list.push("file '" + kept[kept.length - 1].n + "'");
writeFileSync(path.join(FRAMES, 'list.txt'), list.join('\n') + '\n');
const ff = FFMPEG;
execFileSync(ff, ['-y', '-f', 'concat', '-safe', '0', '-i', path.join(FRAMES, 'list.txt'),
  '-vf', 'fps=' + FPS + ',scale=' + W + ':' + H + ':force_original_aspect_ratio=decrease,pad=' + W + ':' + H + ':(ow-iw)/2:(oh-ih)/2',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-an', OUT], { stdio: ['ignore', 'ignore', 'pipe'] });
console.log(OUT + '  帧 ' + shots.length + '  ' + (statSync(OUT).size / 1048576).toFixed(2) + ' MB  ' + W + 'x' + H + '@' + FPS);
