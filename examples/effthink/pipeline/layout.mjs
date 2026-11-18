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
// VP=宽x高 换一档视口再量。录像位这类「高度跟列宽（vw）走、其余跟 vh 走」的盒子，在 1920×1080 下刚好躲过压行，
// 浏览器可视高不足 1080（任务栏 + 标签栏吃掉 80–130px）才露出来——所以成片档位和预览档位要各跑一遍。
const _vp = (process.env.VP || "1920x1080").split("x");
const VW = Number(_vp[0]) || 1920, VH = Number(_vp[1]) || 1080;
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
await cdp("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
// ?anim=0 关掉入场动效：量的必须是终态，动画中途的 translateY / scaleX 会把底边量小
await cdp("Page.navigate", { url: "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/") + "?anim=0&" + (process.env.PAGE_QS || "") });
await sleep(2500);

const countR = await cdp("Runtime.evaluate", { expression: "document.querySelectorAll('.page').length", returnByValue: true });
const TOTAL = Number((countR.result && countR.result.result && countR.result.result.value) || 0);
if (!TOTAL) { ws.close(); chrome.kill(); console.error("没找到 .page，先跑 node build.mjs"); process.exit(2); }
const a = Number(process.argv[2] || 1), b = Math.min(Number(process.argv[3] || TOTAL), TOTAL);
console.log("视口 " + VW + "×" + VH + "，共 " + TOTAL + " 页，检查第 " + a + "–" + b + " 页\n");
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
    // 成片要在画面下方压一行中文字幕：底部这条线以下不许有内容（11vh，与 .page 的 padding-bottom 同口径）
    var SUB=Math.round(innerHeight*0.11), sublim=innerHeight-SUB;
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
    // 块内超出块外：表格/图长出自己的盒子，会盖到下面的事实卡上（第 4 页 12 行成绩表就是这么漏过去的）
    var box = 0, boxAt = '';
    p.querySelectorAll('.fig,.swap,.cols,.facts,.gstage').forEach(function (f) {
      var fr = f.getBoundingClientRect(); if (!fr.width || !fr.height) return;
      f.querySelectorAll('td,th,text,p,li,.fact,figcaption').forEach(function (e) {
        var r = e.getBoundingClientRect(); if (!r.width && !r.height) return;
        var d = Math.max(r.bottom - fr.bottom, fr.top - r.top);
        if (d > box) { box = d; boxAt = (typeof f.className === 'string' ? f.className : f.tagName).slice(0, 18) + '>' + e.tagName + ':' + (e.textContent || '').trim().slice(0, 10); }
      });
    });
    // 表格相邻两列互压：格子里的内容（名字后面挂的名次徽标最容易）超出本格文字区，会贴到下一列的字上
    var col = 0, colAt = '';
    p.querySelectorAll('table tr').forEach(function (tr) {
      var tds = [].slice.call(tr.children).filter(function (e) { return /^(TD|TH)$/.test(e.tagName); });
      for (var ci = 0; ci + 1 < tds.length; ci++) {
        var b0 = tds[ci + 1], cs, bb;
        try { var ra = document.createRange(); ra.selectNodeContents(tds[ci]); bb = ra.getBoundingClientRect(); } catch (e) { continue; }
        if (!bb.width) continue;
        cs = getComputedStyle(b0);
        var inLeft = b0.getBoundingClientRect().left + (parseFloat(cs.paddingLeft) || 0);
        var d = Math.round(bb.right - inLeft);
        if (d > col) { col = d; colAt = tds[ci].textContent.trim().slice(0, 14) + '‖' + b0.textContent.trim().slice(0, 8); }
      }
    });
    // 内容太高时 .fig 会向上溢出压住标题（第 7 页的台账表就盖在 h1 上，底边量不到这件事）。
    // 判据必须按标题的「文字底线」算：h1 的框比字高一截（line-height 留白），按框底算会页页误报 6px。
    var hd = p.querySelector('h1.title') || p.querySelector('.hrow');
    var clash = 0, clashAt = '';
    if (hd) {
      var hb = hd.getBoundingClientRect();
      // computed line-height 常是 normal，parseFloat 得 NaN；文字底线改用 Range 量，量不到才退回按 1.2 估
      var lineBottom = hb.bottom;
      try {
        var rng = document.createRange(); rng.selectNodeContents(hd);
        var rb = rng.getBoundingClientRect();
        if (rb && rb.bottom > 0 && rb.bottom <= hb.bottom + 1) lineBottom = rb.bottom;
        else lineBottom = hb.bottom - Math.max(0, (parseFloat(hb.height) - parseFloat(hd.offsetHeight)) / 2) - 6;
      } catch (e) { lineBottom = hb.bottom - 6; }
      p.querySelectorAll('*').forEach(function (e) {
        if (hd === e || hd.contains(e) || e.contains(hd)) return;
        var r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
        if (r.height > (hb.bottom - hb.top) * 3) return;   // 整页容器不算压标题
        if (r.top < lineBottom + 10 && r.bottom > lineBottom + 16 && r.left < hb.right && r.right > hb.left) {
          clash++;
          if (!clashAt) clashAt = (typeof e.className === 'string' ? e.className : e.tagName).slice(0, 22) + ':' + (e.textContent || '').trim().slice(0, 12);
        }
      });
    }
    // 主视觉被挤扁：SVG 走 meet 等比缩放，容器一矮整张图连字一起缩，底边 / 出框 / 出盒全都量不出来。
    // 第 27 页八根柱曾渲染成 469×105、最小字折算 7.2px，而当时闸门全绿——只能按 viewBox 缩放比算。
    var sqz = 0, sqzAt = '';
    p.querySelectorAll('svg').forEach(function (s2) {
      var vb2 = s2.viewBox && s2.viewBox.baseVal; if (!vb2 || !vb2.width) return;
      var r2 = s2.getBoundingClientRect(); if (!r2.width || !r2.height) return;
      var k = Math.min(r2.width / vb2.width, r2.height / vb2.height);
      var mf = 0;
      s2.querySelectorAll('text').forEach(function (t) {
        var f = parseFloat(t.getAttribute('font-size') || 0); if (f && (!mf || f < mf)) mf = f;
      });
      if (!mf) return;
      var px = mf * k;
      if (!sqz || px < sqz) { sqz = px; sqzAt = '最小字 ' + mf + 'u × ' + k.toFixed(2) + ' = ' + Math.round(px) + 'px @ ' + Math.round(r2.width * k) + '×' + Math.round(r2.height * k); }
    });
    sqz = Math.round(sqz);
    // 块级互压：图注 / 数字条 / 事实卡 / 口径注两两矩形相交。
    // 第 8、13、17 页的录像图注曾压进数字条 34–50px 而闸门全绿——「底边」量的是整页最深元素，
    // 两个块横向错开时最深元素没变；只有把视口降到浏览器档位，或者按块两两比，才量得出来。
    var crash = 0, crashAt = '';
    var ce = [].slice.call(p.querySelectorAll('.vcap,.nstrip>.ns,.facts>.fact,.mini,.card,.tagline>span,h3'))
      .map(function (e) { var r = e.getBoundingClientRect(); return { e: e, r: r }; })
      .filter(function (o) { return o.r.width > 6 && o.r.height > 6 && !(o.e.closest && o.e.closest('.pane.bb')); });
    for (var q1 = 0; q1 < ce.length; q1++) for (var q2 = q1 + 1; q2 < ce.length; q2++) {
      var eA = ce[q1].e, eB = ce[q2].e, rA = ce[q1].r, rB = ce[q2].r;
      if (eA.contains(eB) || eB.contains(eA)) continue;
      var oW = Math.min(rA.right, rB.right) - Math.max(rA.left, rB.left);
      var oH = Math.min(rA.bottom, rB.bottom) - Math.max(rA.top, rB.top);
      if (oW > 4 && oH > 4 && oH > crash) {
        crash = Math.round(oH);
        crashAt = '压块 ' + crash + 'px ' + (eA.className || eA.tagName).toString().split(' ')[0] + ':' + (eA.textContent || '').trim().slice(0, 10)
          + ' ‖ ' + (eB.className || eB.tagName).toString().split(' ')[0] + ':' + (eB.textContent || '').trim().slice(0, 10);
      }
    }
    return {bot:Math.round(mb),over:Math.round(mb-lim),past:Math.round(mb-innerHeight),sub:Math.round(mb-sublim),hidden:Math.round(hidden),svg:svgOut,clash:clash,box:Math.round(box),col:col,sqz:sqz,crash:crash,at:at+' '+svgAt+' '+clashAt+' '+boxAt+' '+colAt+' '+crashAt+' '+sqzAt};
  })()`;
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  const v = r.result && r.result.result ? r.result.result.value : null;
  if (!v || v.skip) break;
  seen++;
  const fail = v.past > 0 || v.sub > 0 || v.hidden > 4 || v.svg > 2 || v.clash > 0 || v.box > 8 || v.col > 2 || v.crash > 4 || (v.sqz > 0 && v.sqz < 15);
  if (fail) bad++;
  console.log(String(n).padStart(2), fail ? "FAIL" : "ok  ", "底边", String(v.bot).padStart(5),
    "超视口", String(v.past).padStart(4), "压字幕区", String(v.sub).padStart(4), "超内容线", String(v.over).padStart(4),
    "被藏", String(v.hidden).padStart(4),
    "出框", String(v.svg).padStart(4), "压标题", String(v.clash).padStart(3), "出盒", String(v.box).padStart(4),
    "压列", String(v.col).padStart(4), "压块", String(v.crash || 0).padStart(4), "最小字", String(v.sqz || 0).padStart(4), v.at);
}
ws.close(); chrome.kill();
console.log("\n" + seen + " 页，破版 " + bad + " 页" + (bad ? "（底边越过 1080 / 内容压进字幕安全区 / 内容落在滚动框外 / SVG 画出 viewBox 被裁 / 内容压住标题 / 表格相邻列互压 / 块级互压 / 主视觉被挤扁到最小字 <15px）" : "，全部在 1080 视口与字幕安全区之上，主视觉也没被挤扁"));
process.exit(bad ? 1 : 0);
