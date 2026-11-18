#!/usr/bin/env node
/**
 * OBS 程序化录制（Node >= 22，零依赖；走 OBS 自带的 obs-websocket，端口默认 4455）
 *
 *   node record-obs.mjs --password <OBS 里设的密码> --seconds 880
 *
 * 它做四件事：
 *   1) 用调试端口起一个真实窗口的 Chrome 打开分镜页（?cue=1&auto=1&clean=1&wait=1，时间轴挂起）
 *   2) 通过 obs-websocket 让 OBS 开始录制（NVENC 硬编，画质比 CDP 逐帧截 jpg 好得多、也没有 25GB 帧序列）
 *   3) 录制确认开始后 lead 毫秒（默认 300ms），调用页面的 window.__startCue() 让时间轴从 0 跑
 *   4) 跑满 --seconds 秒后停止录制，打印 OBS 落盘路径、以及归零那一刻的 OBS 时间码
 *
 * OBS 里要先设一次：
 *   - 工具 → WebSocket 服务器设置：启用、端口 4455、设密码
 *   - 场景里加**显示器采集**（Chrome 会被脚本切成全屏，采显示器就等于采页面，没有窗口边框）
 *     输出设 3840x2160 / 60fps / NVENC（CQP 16–18 或 80–100 Mbps）；Windows 显示缩放要是 100%，否则视口不是 3840x2160
 *   - 录制格式建议 mkv（意外中断不废片），后期我这边转 mp4
 *
 * 时间轴对齐：只能保证「先开录、后归零」，两者差几十毫秒。这不影响成片——
 * 后期对时是从**成片里**检出每个翻页点再钉回各自时间窗，常量偏移无所谓，只有累积漂移会被缩放吸收。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const SEC = Number(opt('seconds', 880));
const OPORT = Number(opt('obsPort', 4455));
const PASS = opt('password', '');
const LEAD = Number(opt('lead', 300));
const SETTLE = Number(opt('settle', 4000));   // 全屏提示气泡等要等它自己消失，否则会被录进第一页
const W = Number(opt('w', 3840)), H = Number(opt('h', 2160));
const CDP = Number(opt('port', 9333));
const ROOT = opt('root', process.cwd());
const CHROME = opt('chrome', process.platform === 'win32'
  ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync)
  : '/usr/bin/google-chrome');
const PAGE = opt('url') || ('file:///' + ROOT.replace(/\\/g, '/').replace(/\/$/, '') + '/index.html?cue=1&auto=1&clean=1&wait=1');
const UDD = opt('userDataDir', '');
const WIN_INPUT = opt('winInput', '窗口采集');
const MON_INPUT = opt('monInput', '显示器采集');   // 从 WSL 驱动 Windows Chrome 时要给 Windows 风格路径，如 $TMP/deck-profile
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { console.error('[错误] ' + m); process.exit(1); };
if (!CHROME || !existsSync(CHROME)) die('找不到 Chrome，用 --chrome <路径> 指定');

const b64 = (v) => createHash('sha256').update(v).digest('base64');

if (process.platform !== 'win32') {          // 从 WSL 驱动时先清僵尸窗口
  try {
    const { execFileSync } = await import('node:child_process');
    const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
      "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'AI *' } | " +
      "ForEach-Object { $_.Kill(); 'killed ' + $_.MainWindowTitle }";
    const killed = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 15000 }).toString().trim();
    if (killed) console.log('[清理] ' + killed.split(String.fromCharCode(10)).length + ' 个残留的分镜窗口');
  } catch { /* 清不掉也不致命，下面还有唯一性检查 */ }
}

/* 1) 起 Chrome（真实窗口，交给 OBS 抓） */
const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + CDP,
  '--window-size=' + W + ',' + H, '--window-position=0,0',
  '--kiosk',   // 真全屏：任务栏不占位（--start-fullscreen 实测只剩 3840x2104，vh/vw 会被拉歪）
  '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
  '--no-first-run', '--no-default-browser-check',
  // 从 WSL 驱动 Windows 版 Chrome 时，进程 platform 是 linux，但目标不是 Linux Chrome —— 不加 --no-sandbox，
  // 否则 Chrome 顶部会挂一条「不受支持的命令行标记」提示栏，既占掉视口高度也会被录进去
  ...(/[\\/]mnt[\\/][a-z][\\/]/i.test(CHROME) || /\.exe$/i.test(CHROME) || process.platform === 'win32' ? [] : ['--no-sandbox']),
  // 每次用全新 profile：复用旧目录会被已在跑的 Chrome 接管，kiosk 全屏就不生效了
  '--user-data-dir=' + ((UDD || (ROOT + '/.record-profile')) + '-' + Date.now()), PAGE,
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch { /* 已退出 */ } });

async function cdpTarget() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json();
      const p = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (p && p.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  die('等不到 Chrome 调试端口（' + CDP + '）');
}
let cseq = 0; const cpend = new Map();
const csend = (method, params) => new Promise((res, rej) => {
  const id = ++cseq; cpend.set(id, { res, rej }); cdp.send(JSON.stringify({ id, method, params }));
});
const cdp = new WebSocket(await cdpTarget());
cdp.onmessage = (e) => {                     // 必须在 open 之前挂上：Hello/早到的事件不能漏
  try {
    const m = JSON.parse(e.data);
    if (m.id && cpend.has(m.id)) { const p = cpend.get(m.id); cpend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  } catch (err) { console.error('[cdp 消息异常] ' + err.message); }
};
await new Promise((res, rej) => { cdp.onopen = res; cdp.onerror = () => rej(new Error('CDP 连接失败')); });
const evaluate = async (expr, awaitP) => (await csend('Runtime.evaluate', { expression: expr, awaitPromise: !!awaitP, returnByValue: true })).result?.value;
await csend('Page.enable');
await csend('Runtime.enable');
await evaluate('document.fonts ? document.fonts.ready.then(() => 1) : 1', true);
console.log('[页面] 已就绪，等 ' + SETTLE + 'ms 让全屏提示/首帧动效稳定…');
await sleep(SETTLE);
const vp = await evaluate('innerWidth + "x" + innerHeight');
console.log('[页面] 视口 ' + vp + '（应为 3840x2160）');

/* 2) 连 obs-websocket */
let oseq = 0; const opend = new Map(); const events = [];
const osend = (requestType, requestData) => new Promise((res, rej) => {
  const id = 'r' + (++oseq); opend.set(id, { res, rej, requestType });
  obs.send(JSON.stringify({ op: 6, d: { requestType, requestId: id, requestData: requestData || {} } }));
});
const obs = new WebSocket('ws://127.0.0.1:' + OPORT);
obs.onmessage = (e) => {
 try {
  const m = JSON.parse(e.data);
  if (m.op === 0) {
    const a = m.d.authentication;
    const auth = a ? b64(b64(PASS + a.salt) + a.challenge) : undefined;
    obs.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, ...(auth ? { authentication: auth } : {}) } }));
  } else if (m.op === 2) {
    obs.send(JSON.stringify({ op: 3, d: { eventSubscriptions: 64 } }));
  } else if (m.op === 5) {
    events.push(m.d);
  } else if (m.op === 7) {
    const p = opend.get(m.d.requestId); if (!p) return; opend.delete(m.d.requestId);
    (m.d.requestStatus && m.d.requestStatus.result) ? p.res(m.d.responseData) : p.rej(new Error(p.requestType + '：' + ((m.d.requestStatus && m.d.requestStatus.comment) || '失败')));
  }
 } catch (err) { console.error('[obs 消息异常] ' + err.message); }
};
await new Promise((res, rej) => {
  obs.onopen = res;
  obs.onerror = () => rej(new Error('连不上 obs-websocket：OBS 开了吗？WebSocket 服务器启用了吗？端口 ' + OPORT + '？'));
}).catch((e) => die(e.message));
await sleep(600);

/* 3) 开录 → 归零 → 跑满 → 停录 */
const version = await osend('GetVersion').catch(() => ({}));
console.log('[OBS] ' + (version.obsVersion || '?') + ' / websocket ' + (version.obsWebSocketVersion || '?'));
/* 改成「窗口采集」而不是「显示器采集」：窗口采集与前后遮挡无关，
   这才是可靠的做法——Windows 不允许后台进程抢焦点，显示器采集一旦被别的窗口盖住就录错东西。 */
const TITLE = await evaluate('document.title');
async function items() { return (await osend('GetSceneItemList', { sceneName: SCENE })).sceneItems; }
const SCENE = (await osend('GetSceneList')).currentProgramSceneName;
await osend('CreateInput', { sceneName: SCENE, inputName: WIN_INPUT, inputKind: 'window_capture', inputSettings: {}, sceneItemEnabled: false }).catch(() => {});
const winList = (await osend('GetInputPropertiesListPropertyItems', { inputName: WIN_INPUT, propertyName: 'window' })).propertyItems || [];
const matches = winList.filter((it) => String(it.itemName).includes(TITLE));
if (matches.length !== 1) {
  console.error('[中止] 标题含「' + TITLE + '」的窗口有 ' + matches.length + " 个，无法确定该采哪一个（残留窗口会让录制停在第 1 页）");
  try { chrome.kill(); } catch { /* 已退出 */ }
  process.exit(1);
}
const target = matches[0];
if (!target) { console.error('[中止] 窗口列表里找不到标题为「' + TITLE + '」的窗口'); try { chrome.kill(); } catch { /* 已退出 */ } process.exit(1); }
await osend('SetInputSettings', { inputName: WIN_INPUT, inputSettings: { window: target.itemValue, method: 2, cursor: false, client_area: true }, overlay: true });
for (const it of await items()) {
  if (it.sourceName === WIN_INPUT) await osend('SetSceneItemEnabled', { sceneName: SCENE, sceneItemId: it.sceneItemId, sceneItemEnabled: true });
  if (it.sourceName === MON_INPUT) await osend('SetSceneItemEnabled', { sceneName: SCENE, sceneItemId: it.sceneItemId, sceneItemEnabled: false });
}
console.log('[采集] 已切到窗口采集 → ' + String(target.itemName).slice(0, 40));
await csend('Page.bringToFront').catch(() => {});   // 顺手提到最前，录起来更好看（不再是必需）
await sleep(600);
// Windows 不允许后台进程抢焦点（实测 SetForegroundWindow / AppActivate / Page.bringToFront 都可能无效），
// 所以这里等用户点一下——页面 document.hasFocus() 为真才开录，否则第一页会录成别的窗口。
let focused = false;
for (let i = 0; i < 90; i++) {
  focused = !!(await evaluate('document.hasFocus()'));
  if (focused) break;
  if (i === 0) console.log('[等待焦点] 请点一下页面窗口（或 Alt+Tab 切过去），我检测到就自动开始…');
  await sleep(1000);
}
if (!focused) { console.error('[中止] 90 秒内页面没拿到焦点，不录（否则第一页会录成别的窗口）'); try { chrome.kill(); } catch { /* 已退出 */ } process.exit(1); }
console.log('[焦点] 页面已在前台，开录');
await csend('Page.bringToFront').catch(() => {});
if (process.platform !== 'win32') {                       // 从 WSL 驱动时再补一记 Windows 侧的置前
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "$w=New-Object -ComObject WScript.Shell; $w.AppActivate('AI') | Out-Null"], { timeout: 4000, stdio: 'ignore' });
  } catch { /* 置前失败不致命，下面还有视口/画面自检 */ }
}
await sleep(400);
await osend('StartRecord');
const tRec = Date.now();
console.log('[OBS] 录制已开始，' + LEAD + 'ms 后归零时间轴…');
await sleep(LEAD);
await evaluate('window.__startCue && window.__startCue()');
const st = await osend('GetRecordStatus').catch(() => ({}));
console.log('[归零] 页面 __startCue() 已调用；此刻 OBS 时间码 ' + (st.outputTimecode || '?') + (st.outputActive ? '（录制中）' : '（⚠️ 录制未在跑）'));
await sleep(SEC * 1000);
const stop = await osend('StopRecord');
const path = (stop && stop.outputPath) || '';
console.log('[完成] 共录 ' + ((Date.now() - tRec) / 1000).toFixed(1) + 's；文件：' + (path || '（OBS 未回报路径，去设置的录制目录找）'));
console.log('[下一步] 把这个文件给我，我做对时 + 拼人声 + 混 BGM + 烧字幕。mp4/mkv 都行。');
try {   // 还原：窗口采集关掉、显示器采集打开
  for (const it of (await osend('GetSceneItemList', { sceneName: SCENE })).sceneItems) {
    if (it.sourceName === WIN_INPUT) await osend('SetSceneItemEnabled', { sceneName: SCENE, sceneItemId: it.sceneItemId, sceneItemEnabled: false });
    if (it.sourceName === MON_INPUT) await osend('SetSceneItemEnabled', { sceneName: SCENE, sceneItemId: it.sceneItemId, sceneItemEnabled: true });
  }
 } catch { /* 还原失败无所谓 */ }
try { chrome.kill(); } catch { /* 已退出 */ }
process.exit(0);
