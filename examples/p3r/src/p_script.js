/* arena-video 分镜渲染 + 交互（浅色版 · 25 页）
 * 原则：画面是口播的配图。每页一个主视觉（内联 SVG），屏幕字集中在 .screen 里，
 *      check.mjs 按 .screen 断言每页 ≤80 字符；图表轴标签与 kicker 不计入该预算。
 * 数据一律读 window.__DATA__（build.mjs 从 data/ 注入）。成绩优先读 D.full（大样本复核），
 *      full 未到位时回退 D.legacy（小样本参赛轮），字段同名，页脚标出处。
 * 交互沿用 llm-html2video 约定：F 纯净屏（不走浏览器全屏）、P 内容块假全屏、拉绳落幕。
 */
(function () {
  "use strict";
  var D = window.__DATA__ || {};
  var ST = D.stats || {};
  var SC = D.scores || {};
  var FULL = D.full || null;
  var LG = D.legacy || {};
  var DG = D.diag8 || null;
  var CF = D.ctfFaults || {};

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var fmt = function (n) { return (n == null || isNaN(n)) ? "—" : Number(n).toLocaleString("en-US"); };
  var fmt1 = function (n) { return (n == null || isNaN(n)) ? "—" : Number(n).toFixed(1); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); };
  // "HH:MM[:SS]" → 当日分钟；since(t, 开赛时刻) = 开赛后第几分钟（轴与屏幕字一律用这个，不显示钟表时刻）
  function hhmm2m(s) { var a = String(s).split(":"); return (+a[0]) * 60 + (+a[1]); }
  function since(t, origin) { return Math.round(hhmm2m(t) - hhmm2m(origin)); }
  // 标注宽度估算：CJK 按整宽、ASCII 按 0.56、空格 0.3，用来判断文字会不会画出 viewBox
  function txtW(s, size) {
    var t = String(s == null ? "" : s), w = 0;
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i);
      w += c > 0x2e80 ? size : (c === 32 ? size * 0.3 : size * 0.56);
    }
    return w;
  }
  // 成绩专用格式：最多两位小数、整数不带小数点、负号用「−」不用 hyphen
  var sc = function (n) {
    if (n == null || isNaN(n)) return "—";
    var v = Number(n);
    var s = (Math.abs(v) % 1 < 1e-9) ? String(Math.round(v)) : String(Number(v.toFixed(2)));
    return s.replace("-", "−");
  };
  var EP = {
    land: { key: "land-gui2", name: "圈地", acc: "var(--land)" },
    bomb: { key: "bomberman-gui1", name: "炸弹人", acc: "var(--bomb)" },
    ctf: { key: "ctf-gui1", name: "夺旗", acc: "var(--ctf)" }
  };

  /* ---------- 数据访问 ---------- */
  function sessOf(key) { var s = ST[key] || {}; return (s.sessions || [])[0] || {}; }
  function splitOf(game) { return (D.splits || {})[EP[game].key] || {}; }
  function tcOf(game) { return ((D.timeCost || {}).runs || {})[EP[game].key] || {}; }
  function clockOf(game) { return ((D.clocks || {}).runs || {})[EP[game].key] || {}; }
  // 成绩读数：phase = main / ot / selftest / official，大样本优先、回退小样本
  // 自测记录 / 版本链 / 噪声量级是与样本量无关的事实，大样本表里没有，从小样本表补；
  // 但分数与 peers（同表其他选手的成绩）一律不补——那是另一批对局算出来的，混进同一张图就是错。
  var LG_ONLY = ["selftestGames", "selfRecord", "chain", "noiseSeat", "noisePeer", "versions"];
  // 炸弹人的 main / ot 一律取固定赛程那一对（同一套 1320 局、只差代码），
  // FULL.bomb.ot / otRerun 是未固定赛程的另两次跑批，只用来量赛程本身的噪声。
  var CTL_KEY = { bomb: { main: "ctl_ctlmain", ot: "ctl_ctlot" } };
  function resOf(game, phase) {
    var tbl = (FULL && FULL[game] || {});
    var f = tbl[CTL_KEY[game] && CTL_KEY[game][phase] || phase];
    var l = (LG[game] || {})[phase];
    if (!f) return l || null;
    var o = {}, k;
    for (k in f) o[k] = f[k];
    if (l) LG_ONLY.forEach(function (key) { if (o[key] == null && l[key] != null) o[key] = l[key]; });
    return o;
  }
  // 一版成绩在「本场那张表」里的主分（圈地是 0–100 归一化分，另两场是基准为 0 的实力值）
  function scoreOf(game, r) {
    if (!r) return null;
    var v = game === "land" ? r.score : r.bt;
    return v == null ? null : Number(v);
  }
  // 段错误的分档分布（pipeline/ctf-faults.py 数出来的），成绩表里只有总数
  function faultTxt(tag) {
    var f = CF[tag] || {}, bt = f.byTier || {}, k = Object.keys(bt);
    if (!k.length) return "0 局";
    return f.total + " 局段错误（" + k.map(function (t) { return t + " 方 " + bt[t]; }).join(" / ") + "）";
  }
  function resSrc(game) {
    var f = (FULL || {})[game] || {}, l = LG[game] || {}, g = ((FULL || {}).games || {})[game];
    var has = function (p) { return !!(f[p] || (CTL_KEY[game] && f[CTL_KEY[game][p]])); };
    var a = has("main") ? "大样本 " + fmt(g) + " 局" : "小样本 " + fmt((l.main || {}).games) + " 局";
    var b = has("ot") ? "大样本" : "小样本";
    var tail = has("main") && game === "bomb" ? "（固定同一套赛程，两端逐局同座位同地图）" : "";
    return "正赛 " + a + " · 加时 " + b + tail;
  }

  /* ---------- SVG 图元（viewBox 宽 1000，字号写在元素上而非 CSS）---------- */
  var VW = 1000, VH = 520;
  function svg(inner, h, w) {
    return '<div class="fig"><svg viewBox="0 0 ' + (w || VW) + ' ' + (h || VH) + '" preserveAspectRatio="xMidYMid meet">' + inner + '</svg></div>';
  }
  function T(x, y, s, cls, size, anchor, extra) {
    return '<text x="' + x + '" y="' + y + '" class="' + (cls || "ax") + '" font-size="' + (size || 20) +
      '" text-anchor="' + (anchor || "start") + '"' + (extra ? " " + extra : "") + ">" + esc(s) + "</text>";
  }
  function R(x, y, w, h2, fill, cls, extra) {
    return '<rect x="' + x + '" y="' + y + '" width="' + Math.max(0, w) + '" height="' + h2 + '" fill="' + fill +
      '" class="' + (cls || "") + '"' + (extra || "") + ' rx="3"/>';
  }
  function LN(x1, y1, x2, y2, cls) {
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="' + (cls || "gl") + '"/>';
  }
  // 横向条形：rows=[{label,value,color,note,hot}]，abs=true 时按绝对值画（支持负值向左）
  // o.fs 字号（行数多时要缩）；o.zero 强制画「基准 0」虚线；每行带 --i 供入场动画错峰
  function avaOf(name) { return ((window.__AVAS__ || {})[name]) || ""; }
  var CLIPN = 0;
  function hbars(rows, o) {
    o = o || {};
    var padL = o.labelW || 210, padR = o.padR || 130, top = o.top || 40, rh = o.rh || 62, gap = o.gap || 16;
    var fs = o.fs || 24, fv = (o.fs || 26) + 2;
    // 数值一律写在柱外（跟对手行格式一致）：先量最靠右的一条需要多少右侧留白，不够就加宽重排
    var needOut = 0;
    rows.forEach(function (r) {
      var v0 = Number(r.value) || 0;
      if (v0 < 0) return;
      var nw0 = txtW(r.note == null ? sc(v0) : r.note, fv);
      var tagw0 = r.tag ? txtW(r.tag, fv - 4) + 16 : 0;
      needOut = Math.max(needOut, 12 + (r.ava ? 44 : 0) + nw0 + 10 + tagw0);
    });
    if (needOut > padR) padR = needOut;
    var x0 = padL, x1 = VW - padR;
    var vals = rows.map(function (r) { return Number(r.value) || 0; });
    var mx, mn;
    if (o.abs) { mx = Math.max.apply(null, vals.map(function (v) { return Math.abs(v); })); mn = -mx; }
    else { mx = Math.max.apply(null, vals.concat([0])); mn = Math.min.apply(null, vals.concat([0])); }
    if (o.max != null) mx = o.max;
    if (o.min != null) mn = o.min;
    function X(v) { return x0 + (v - mn) / ((mx - mn) || 1) * (x1 - x0); }
    var zero = X(0), out = "";
    var bottom = top + rows.length * (rh + gap);
    if (mn < 0 || o.zero) {
      var zlab = o.zeroLabel || "0";
      out += LN(zero, top - 16, zero, bottom, "gl zero") + T(zero + 8, Math.max(24, top - 22), zlab, "ax", 18);
    }
    var anyAva = rows.some(function (r) { return r.ava; });
    var cid = "";
    if (anyAva) { CLIPN++; cid = "avac" + CLIPN; out = '<defs><clipPath id="' + cid + '" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs>' + out; }
    rows.forEach(function (r, i) {
      var y = top + i * (rh + gap), v = Number(r.value) || 0;
      var bx = v >= 0 ? zero : X(v), bw = Math.abs(X(v) - zero);
      var d = 'style="--i:' + i + ';transform-origin:' + (v >= 0 ? "left" : "right") + ' center"';
      out += T(x0 - 14, y + rh / 2 + fs / 3, r.label, "ax big ain", fs, "end", 'style="--i:' + i + '"');
      out += R(bx, y, bw, rh, r.color || "var(--acc)", "bar",
        ' opacity="' + (r.hot ? 1 : r.dim ? 0.42 : 0.85) + '" ' + d);
      var note = r.note == null ? sc(v) : r.note;
      var av = r.ava || "", gapA = av ? 44 : 0;
      if (av) out += '<image href="' + av + '" x="' + (v >= 0 ? (bx + bw + 6) : (zero + 6)).toFixed(1) + '" y="' + (y + rh / 2 - 17).toFixed(1) +
        '" width="34" height="34" clip-path="url(#' + cid + ')" class="ain" style="--i:' + i + '"/>';
      // 长条的数值写在条头右侧会画出 viewBox（第 7 页的「基准 606」就被裁成「基准 6」）；放不下就挪进条内
      var nw = txtW(note, fv);
      var outside = (v >= 0 ? bx + bw + 12 + gapA : zero + 12 + gapA) + nw;
      if (v >= 0 && outside > VW - 8) {
        out += T(bx + bw - 12, y + rh / 2 + fv / 3, note, "vlabin ain", fv, "end", 'style="--i:' + i + '"');
      } else {
        out += T(v >= 0 ? bx + bw + 12 + gapA : zero + 12 + gapA, y + rh / 2 + fv / 3, note, "vlab ain" + (r.hot ? " acc" : ""),
          fv, "start", 'style="--i:' + i + '"');
      }
      if (r.tag) {
        var tagx = (v >= 0 ? bx + bw + 12 + gapA : zero + 12 + gapA) + nw + 16;
        out += T(tagx, y + rh / 2 + (fs - 4) / 3, r.tag, "ann ain", fs - 4, "start", 'style="--i:' + i + '"');
      }
    });
    return svg(out, bottom + 24);
  }
  // 同表横比柱：对手读最后一轮那张表，本机可画一到两个版本（加时页用来对比新旧）
  function peerChart(game, vers, o) {
    o = o || {};
    var last = resOf(game, vers[vers.length - 1]) || {};
    var rows = [];
    var both = vers.length > 1;
    vers.forEach(function (v) {
      var r = resOf(game, v) || {}, val = scoreOf(game, r);
      if (val == null) return;
      rows.push({ label: "本地 27B · " + (v === "main" ? "正赛交卷版" : "加时终版"), value: val,
        note: sc(val) + " · 第 " + r.rank + " 名",
        color: v === "main" ? "var(--me-main)" : "var(--me-ot)", ava: avaOf("本地 27B"), hot: true, me: true });
    });
    // 每个对手一个色相，避免十条一模一样的灰；本机两根仍走主题色/墨色并高亮
    var PEER = ["#7fd4ff", "#ffd166", "#c9a7ff", "#6ee7b7", "#ff9f6e", "#8fb8ff",
      "#f78fb3", "#a0e0a0", "#9fd8d0", "#e0c3fc", "#ffb3c1", "#a5d8ff"];
    Object.keys(last.ratings || {}).forEach(function (k, i) {
      if (k === "本地 27B") return;
      rows.push({ label: k, value: last.ratings[k], color: "var(--peer)", ava: avaOf(k),
        tag: (o.tags || {})[k] });
    });
    rows.sort(function (a, b) { return b.value - a.value; });
    return hbars(rows, { labelW: o.labelW || 300, rh: o.rh || 34, gap: o.gap || 9, fs: o.fs || 20,
      abs: o.abs, zero: true, zeroLabel: "基准 0", padR: o.padR || 96 });
  }
  // 多序列折线：series=[{name,color,pts:[[x,y]],hot,dim}]
  function lineChart(series, o) {
    o = o || {};
    var padL = o.padL || 90, padR = o.padR || 170, padT = o.padT || 34, padB = o.padB || 58;
    var h = o.h || VH;
    var xs = [], ys = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
    var x0v = o.x0 != null ? o.x0 : Math.min.apply(null, xs), x1v = o.x1 != null ? o.x1 : Math.max.apply(null, xs);
    var y0v = o.y0 != null ? o.y0 : Math.min.apply(null, ys), y1v = o.y1 != null ? o.y1 : Math.max.apply(null, ys);
    function PX(v) { return padL + (v - x0v) / ((x1v - x0v) || 1) * (VW - padL - padR); }
    function PY(v) { return o.invertY ? padT + (v - y1v) / ((y0v - y1v) || 1) * (h - padT - padB)
      : padT + (v - y0v) / ((y1v - y0v) || 1) * (h - padT - padB); }
    var out = "";
    (o.yTicks || [y0v, y1v]).forEach(function (v) {
      out += LN(padL, PY(v), VW - padR, PY(v), "gl") + T(padL - 12, PY(v) + 7, o.yFmt ? o.yFmt(v) : sc(v), "ax", 18, "end");
    });
    (o.xTicks || [x0v, x1v]).forEach(function (v) {
      out += LN(PX(v), padT, PX(v), h - padB, "gl") + T(PX(v), h - padB + 32, o.xFmt ? o.xFmt(v) : sc(v), "ax", 18, "middle");
    });
    // 阈值标签垫一层纸色底，否则折线会压在字上（第 13 页的线正好穿过它）
    if (o.thr) {
      var tw = txtW(o.thr.label, 19);
      out += LN(padL, PY(o.thr.y), VW - padR, PY(o.thr.y), "gl thr") +
        R(padL + 4, PY(o.thr.y) - 30, tw + 12, 24, "var(--paper)", "thrbg") +
        T(padL + 10, PY(o.thr.y) - 10, o.thr.label, "ann acc", 19);
    }
    series.forEach(function (s, si) {
      var d = s.pts.map(function (p, i) { return (i ? "L" : "M") + PX(p[0]).toFixed(1) + "," + PY(p[1]).toFixed(1); }).join(" ");
      out += '<path d="' + d + '" fill="none" stroke="' + (s.color || "var(--ink2)") + '" stroke-width="' + (s.hot ? 6 : 3) +
        '" stroke-linejoin="round" stroke-linecap="round" opacity="' + (s.dim ? 0.4 : 0.95) +
        '" class="lnpath" pathLength="1" style="--i:' + si + '"/>';
      var last = s.pts[s.pts.length - 1];
      if (last) {
        out += '<circle cx="' + PX(last[0]).toFixed(1) + '" cy="' + PY(last[1]).toFixed(1) + '" r="' + (s.hot ? 9 : 6) +
          '" fill="' + (s.color || "var(--ink2)") + '" class="pt"/>';
        if (s.name) out += T(PX(last[0]) + 14, PY(last[1]) + 8 + (s.labelDy || 0), s.name, s.hot ? "vlab acc ain" : "ax ain", s.hot ? 23 : 19, "start", 'style="--i:9"');
      }
    });
    if (o.xlab) out += T(VW - padR, h - 8, o.xlab, "ax", 18, "end");
    return svg(out, h);
  }
  // 时间轨道：marks=[{t,label,cls}]（t 为 HH:MM），blocks=[{from,to,label,color}]
  function track(marks, o) {
    o = o || {};
    function m2s(x) { var a = String(x).split(":"); return (+a[0]) * 60 + (+a[1]); }
    function m2h(m) { m = Math.round(m); var h = Math.floor(m / 60), q = m % 60; return (h < 10 ? "0" : "") + h + ":" + (q < 10 ? "0" : "") + q; }
    var ts = marks.map(function (m) { return m2s(m.t); });
    var t0 = o.t0 != null ? m2s(o.t0) : Math.min.apply(null, ts), t1 = o.t1 != null ? m2s(o.t1) : Math.max.apply(null, ts);
    var padL = 70, padR = 70, y = o.y || 200, x0 = padL, x1 = VW - padR;
    function X(min) { return x0 + (min - t0) / ((t1 - t0) || 1) * (x1 - x0); }
    var out = R(x0, y - 16, x1 - x0, 32, "var(--paper3)", "trk");
    (o.blocks || []).forEach(function (b) {
      var a = X(m2s(b.from)), c = X(m2s(b.to));
      out += R(a, y - 16, c - a, 32, b.color || "var(--acc)", "bar");
      // 块标签放进轨道内部：原来悬在轨道上方，交错的时间点标签会压住它
      // 块太窄就把标签放到轨道上方（用纸色垫底），别让字压到块外的轨道上
      if (b.label) {
        if (txtW(b.label, 22) <= (c - a) - 18) out += T((a + c) / 2, y + 9, b.label, "vlabin", 22, "middle");
        else out += R(a - 6, y - 56, c - a + 12, 30, "var(--paper3)", "trk") + T((a + c) / 2, y - 33, b.label, "vlab acc", 22, "middle");
      }
    });
    // 轴一律标「开赛后 N 分钟」，不标钟表时刻：观众要的是"过了多久"，不是"几点几分"
    var org = o.origin != null ? m2s(o.origin) : t0;
    var LB = function (min) { return Math.round(min - org) + " 分"; };
    var tks = (o.ticks || []).slice();
    // 两端一律补上，观众要能读出这一段从哪到哪、共多长
    tks.push({ t: o.t0 || m2h(t0), label: "开赛后 " + LB(t0), anchor: "start" });
    tks.push({ t: o.t1 || m2h(t1), label: "开赛后 " + LB(t1), anchor: "end" });
    // 刻度挤在一起就丢掉中间那些：两端必须留，其余的谁先来谁留
    // 两端锚点先占位再放中间刻度；最小间距随 viewBox 宽走（VW=1000，固定 150px 会把两端挤掉）
    tks.sort(function (a, b2) { return (b2.anchor ? 1 : 0) - (a.anchor ? 1 : 0); });
    var MINSEP = Math.max(70, Math.min(150, VW * 0.15));
    var placed = [];
    tks = tks.filter(function (tk) {
      var px = X(m2s(tk.t));
      if (placed.some(function (q) { return Math.abs(q - px) < MINSEP; })) return false;
      placed.push(px);
      return true;
    });
    tks.forEach(function (tk) {
      var px = X(m2s(tk.t));
      var anc = tk.anchor || "middle";
      var lx = anc === "start" ? x0 : anc === "end" ? x1 : px;
      out += LN(px, y + 20, px, y + 34, "gl") +
        T(lx, y + 64, tk.label != null ? tk.label : LB(m2s(tk.t)), "vlab", 20, anc);
    });
    marks.forEach(function (mk, i) {
      var cx = X(m2s(mk.t)), cy = y - (o.stagger ? (i % 2 ? 62 : 108) : 62);
      out += LN(cx, y - 18, cx, cy + 10, "gl") + '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="10" fill="' +
        (mk.cls === "bad" ? "var(--red)" : mk.cls === "hit" ? "var(--good)" : "var(--acc)") +
        '" stroke="rgba(4,10,40,.55)" stroke-width="2" class="pt"/>';
      if (mk.label) out += T(cx, cy - 20, mk.label, "vlab", 22, "middle");
    });
    return svg(out, o.h || 350);
  }
  // 人数档的棋盘面积（边长等比并排）：第 cut 格之后画成红斜纹盲区
  function areaFig(cut) {
    var ns = [2, 3, 4, 5, 8, 10], unit = 7.5, gap = 12, ox = 16, base = 205, x = ox;
    var out = '<defs><pattern id="blind" width="10" height="10" patternUnits="userSpaceOnUse">' +
      '<rect width="10" height="10" fill="rgba(255,59,48,.20)"/><path d="M0,10 L10,0" stroke="rgba(255,59,48,.8)" stroke-width="1.6"/></pattern></defs>';
    ns.forEach(function (n) {
      var s = 2 * Math.ceil(Math.sqrt(14 * n)) + 1, px = s * unit, y = base - px, lost = Math.max(0, s * s - cut);
      out += R(x, y, px, px, "var(--bomb)", "bar", ' opacity=".20"');
      out += '<rect x="' + x + '" y="' + y + '" width="' + px + '" height="' + px + '" fill="none" stroke="var(--bomb)" stroke-width="1.6" opacity=".8"/>';
      if (lost > 0) {
        var rowsLost = Math.floor(lost / s) + (lost % s ? 1 : 0);
        out += '<rect x="' + x + '" y="' + (base - rowsLost * unit) + '" width="' + px + '" height="' + (rowsLost * unit) + '" fill="url(#blind)"/>';
      }
      out += T(x + px / 2, base + 28, n + " 人", "vlab", 20, "middle") +
        T(x + px / 2, base + 52, (s * s) + " 格", lost > 0 ? "vlab acc" : "ax", 19, "middle");
      if (lost > 0) out += T(x + px / 2, base + 72, "盲区 " + lost, "ann acc", 17, "middle");
      x += px + gap;
    });
    out += T(ox, base + 96, "棋盘随人数变大；红斜纹 = 第 " + cut + " 格之后，火焰收不到的那部分", "ax", 20);
    return svg(out, base + 104);
  }
  // 棋盘：n×n 格，第 cut 格之后暗掉（火收不到）
  function board(n, cut) {
    var cell = Math.floor(Math.min(620 / n, 440 / n)), ox = 40, oy = 24, out = "", k = 0;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var lost = k >= cut;
      out += R(ox + c * cell, oy + r * cell, cell - 1.5, cell - 1.5, lost ? "var(--paper3)" : "var(--acc)", "bar",
        ' opacity="' + (lost ? 0.6 : 0.88) + '"');
      k++;
    }
    var cutRow = Math.floor(cut / n), cx = ox + n * cell + 30, cy = oy + cutRow * cell;
    out += LN(ox + n * cell + 14, oy, ox + n * cell + 14, oy + n * cell, "gl thr");
    out += T(cx, cy - 10, "第 " + cut + " 格起", "vlab acc", 26) + T(cx, cy + 22, "火焰收不到", "ax", 22);
    out += T(ox, oy + n * cell + 36, n + "×" + n + " = " + (n * n) + " 格 · 暗掉的是被截断的后 " + (n * n - cut) + " 格", "ax", 21);
    return svg(out, VH);
  }
  // 自测覆盖：左上实心块 = 它自己测过的局（全在两方），右侧一列空心块 = 评分要考的人数档
  function coverGrid(done, sides) {
    var cell = 42, gap = 10, ox = 60, oy = 40, cols = 9, out = "";
    for (var i = 0; i < done; i++) {
      var r = Math.floor(i / cols), c = i % cols;
      out += R(ox + c * (cell + gap), oy + r * (cell + gap), cell, cell, (r % 2) ? "var(--ctf)" : "#e8d9ff", "bar", ' opacity=".95"');
    }
    var rows = Math.ceil(done / cols);
    out += T(ox, oy + rows * (cell + gap) + 34, "自测 " + done + " 局 · 全是 " + sides[0] + " 方局", "vlab acc", 27);
    var bx = ox + cols * (cell + gap) + 50, step = 50, y0 = 46;
    out += T(bx, y0 - 16, "正式评分按档等权", "ax", 22);
    sides.forEach(function (n, i) {
      var y = y0 + i * step, tested = i === 0;
      out += '<rect x="' + bx + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="3"' +
        (tested ? ' class="bar" fill="var(--bomb)"/>' : ' fill="none" stroke="#9db4ff" stroke-width="2" stroke-dasharray="6 5"/>') +
        T(bx + cell + 18, y + 28, tested ? n + " 方 · 测过" : n + " 方 · 0 局", tested ? "vlab acc" : "ax", 24);
    });
    return svg(out, 500);
  }
  // 时间去向色带：rows=[{label,segs:[{label,min,color}]}]
  function ribbon(rows) {
    var RW = 1520, top = 30, rh = 66, gap = 34, x0 = 120, x1 = RW - 10, out = "";
    rows.forEach(function (rw, i) {
      var y = top + i * (rh + gap), total = 0;
      rw.segs.forEach(function (s) { total += s.min; });
      var acc = x0, span = x1 - x0;
      out += T(x0 - 16, y + rh / 2 + 10, rw.label, "vlab", 27, "end");
      rw.segs.forEach(function (s) {
        var w = (s.min / (total || 1)) * span;
        out += R(acc, y, Math.max(2, w - 3), rh, s.color, "bar", ' opacity=".95"');
        // 墨色必须写成 style：class 里的 fill 优先于 SVG 的 fill 属性
        var ik = 'style="fill:' + (s.ink || "#ffffff") + '"';
        var lab = String(s.label), val = Math.round(s.min) + " 分";
        if (w >= txtW(lab, 18) + 26) {
          out += T(acc + 12, y + 28, lab, "riblab", 18, "start", ik) +
            T(acc + 12, y + 58, val, "ribval", 25, "start", ik);
        } else if (w >= txtW(val, 25) + 20) {
          out += T(acc + 10, y + rh / 2 + 9, val, "ribval", 25, "start", ik);
        } else {
          out += T(acc + w / 2, y + rh / 2 + 6, lab.slice(0, 2), "riblab", 15, "middle", ik);
        }
        acc += w;
      });
      out += T(x1, y + rh + 26, "合计 " + Math.round(rw.total || total) + " 分钟", "vlab", 23, "end");
    });
    return svg(out, top + rows.length * (rh + gap) + 4, RW);
  }
  // 排名条：一列选手，本机高亮，基准 0 画虚线
  function rankBar(rows) {
    var top = 30, rh = 30, gap = 7, x0 = 230, x1 = VW - 130;
    var vals = rows.map(function (r) { return r.value; });
    var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals.concat([0]));
    function X(v) { return x0 + (v - mn) / ((mx - mn) || 1) * (x1 - x0); }
    var out = "", bottom = top + rows.length * (rh + gap);
    out += LN(X(0), top - 8, X(0), bottom, "gl zero") + T(X(0), Math.max(24, top - 14), "基准 0", "ax", 17, "middle");
    rows.forEach(function (r, i) {
      var y = top + i * (rh + gap), zx = X(0), vx = X(r.value);
      out += T(x0 - 14, y + rh / 2 + 6, r.label, r.me ? "vlab acc" : "ax", r.me ? 22 : 19, "end");
      out += R(Math.min(zx, vx), y, Math.abs(vx - zx), rh, r.me ? "var(--red)" : "var(--ink2)", "bar",
        ' opacity="' + (r.me ? 1 : 0.32) + '"');
      out += T(vx + (r.value >= 0 ? 10 : -10), y + rh / 2 + 6, sc(r.value), r.me ? "vlab acc" : "ax", r.me ? 22 : 18, r.value >= 0 ? "start" : "end");
    });
    return svg(out, bottom + 20);
  }

  /* ---------- 通用小块 ---------- */
  // 页面详情区：底部一排事实卡，值由各页从 __DATA__ 算出后传进来
  function facts(items) {
    return '<div class="facts">' + items.map(function (it) {
      return '<div class="fact' + (it.hot ? " hot" : "") + '">' +
        '<div class="fk">' + it.k + "</div>" +
        '<div class="fv">' + it.v + "</div>" +
        (it.n ? '<div class="fn">' + it.n + "</div>" : "") + "</div>";
    }).join("") + "</div>";
  }
  function head(kicker, title) {
    var mx = "", i;
    for (i = 0; i < 12; i++) mx += '<i style="--i:' + i + '"></i>';
    return '<div class="hrow"><div class="kicker">' + esc(kicker) + '</div><div class="mx">' + mx + "</div></div>" +
      (title ? '<h1 class="title" style="font-size:7.2vh">' + title + "</h1>" : "");
  }
  // 策略对照块：一版一张卡，讲清「它怎么想 / 好处 / 代价」，正赛版与加时版并排；stack=true 时竖排，给右侧留图
  function strategy(tabs, stack) {
    var card = function (t) {
      return '<div class="card' + (t.hot ? " hot" : "") + '"><div class="tag">' + esc(t.tag) + "</div>" +
        "<h3>" + esc(t.title) + "</h3>" + (t.idea ? '<p class="idea">' + esc(t.idea) + "</p>" : "") +
        (t.up ? '<div class="pm up"><b>好处</b>' + esc(t.up) + "</div>" : "") +
        (t.dn ? '<div class="pm dn"><b>代价</b>' + esc(t.dn) + "</div>" : "") + "</div>";
    };
    return '<div class="grid strat" style="flex:1;align-items:center;grid-template-columns:' + (stack ? "1fr" : "1fr 1fr") + '">' +
      tabs.map(card).join("") + "</div>";
  }
  function screen(chips) {
    return '<div class="tagline screen">' + chips.map(function (t) {
      var mut = /^基准|^正式赛各家仅作参照/.test(t);
      return "<span" + (mut ? ' class="mut"' : "") + ">" + esc(t) + "</span>";
    }).join("") + "</div>";
  }
  function ava(size, label) {
    if (window.__AVA__) {
      return '<span class="ava lg pic" title="27B"><img src="' + window.__AVA__ + '" alt="27B"></span>';
    }
    return '<span class="ava' + (size === "lg" ? " lg" : "") + '" title="27B 角色图位">' + esc(label || "27B") + "</span>";
  }
  function srcNote(game, extra) {
    return '<p class="mini">' + esc(resSrc(game)) + (extra ? " · " + extra : "") + "</p>";
  }
  function vslot(key, label, note, variant) {
    var src = (window.__CLIPS__ || {})[key];
    var face = src
      ? '<video class="vclip" src="' + esc(src) + '" muted loop playsinline preload="auto"></video>'
      : '<span class="rec">REC</span><span class="want">待录屏</span>';
    var side = variant === "side";
    return '<figure class="vwrap' + (side ? " side" : "") + '"' + (side ? "" : ' style="flex:1"') + ' data-clip="' + esc(key) + '">' +
      '<div class="vslot' + (side ? " side" : "") + (src ? " hasclip" : "") + '">' + face + "</div>" +
      '<figcaption class="vcap"><b>' + esc(label) + '</b>' + (note ? "<span>" + esc(note) + "</span>" : "") + "</figcaption></figure>";
  }

  function p13() {
    var mm = resOf("bomb", "main") || {}, o = resOf("bomb", "ot") || {};
    var m10 = (mm.bySize || {})["10"] || {}, o10 = (o.bySize || {})["10"] || {};
    return head("第二场 · 炸弹人 · 交卷对比", sc(mm.bt) + ' 变 <span class="em">' + sc(o.bt) + '</span>') +
      '<div class="grid" style="flex:1;align-items:center;grid-template-columns:1.52fr 1fr;gap:2.2vw">' +
        '<div class="col" style="min-width:0">' + peerChart("bomb", ["main", "ot"], { rh: 30, gap: 7, fs: 19 }) + '</div>' +
        '<div class="col vstack" style="gap:1.8vh;justify-content:center">' +
          vslot("bomb_main_run", "炸弹人 · 正赛交卷版", "十人档 · 同一套赛程、只差代码", "side") +
          vslot("bomb_ot_run", "炸弹人 · 加时终版", "十人档 · 同一套赛程、只差代码", "side") +
        '</div>' +
      '</div>' +
      facts([
        { k: "实力值", v: sc(mm.bt) + " → " + sc(o.bt), n: "涨 " + sc(o.bt - mm.bt) + " · 名次 " + mm.rank + " → " + o.rank, hot: true },
        { k: "十人档", v: sc(m10.mine) + " → " + sc(o10.mine), n: "基准 " + sc(m10.base) + " → " + sc(o10.base) },
        { k: "两人档", v: "一分不差", n: "169 格，够不着截断线" },
        { k: "对照条件", v: "同赛程 · 同并发", n: "两根条只差代码" }
      ]) +
      screen(["BT " + sc(mm.bt) + " → " + sc(o.bt), "名次 " + mm.rank + " → " + o.rank, "十人档 " + sc(m10.mine) + " → " + sc(o10.mine)]) +
      '<p class="mini">同一套 ' + fmt(((FULL || {}).games || {}).bomb || 1320) + " 局、钉住 seed、逐局同座位同地图，两根条只差代码</p>";
  }

  function p19() {
    var ot = splitOf("ctf").ot || {}, w = LG.weights || {};
    var rows = [
      { label: "中心枪", value: w.centerGun || 0, color: "#7fd4ff", note: sc(w.centerGun) },
      { label: "围剿", value: w.encircle || 0, color: "#c9a7ff", note: sc(w.encircle) },
      { label: "抢旗", value: w.captureFlag || 0, color: "var(--red)", note: sc(w.captureFlag), hot: true }
    ];
    return head("第三场 · 夺旗 · 加时", '三个单位<span class="em">钉在家里</span>的原因') +
      '<div class="grid" style="flex:1;align-items:center;grid-template-columns:1fr 1.06fr;gap:2vw">' +
        '<div class="col" style="min-width:0">' + hbars(rows, { labelW: 150, rh: 48, gap: 16, fs: 22, max: 36 }) + '</div>' +
        strategy([
          { tag: "正赛这版 · 打分蹲家", title: "三个单位一直留在家里",
            idea: "中心枪与围剿的分压得极高，抢旗任务只有 0.1，永远压不过前两项",
            up: "基地几乎不失守", dn: "四百回合一次旗也没搬回来" },
          { tag: "加时改成 · 三道门", title: "旗点不超过三个才蹲，多了就出去拦",
            idea: "锚点权重 0.5→0.05、驻点 8→1.5，输过旗的一方抢旗分 ×3",
            up: "场均分抬起来了", dn: "抢得到搬不回：八方那局捡旗 20 次，只搬回 1 次", hot: true }
        ], true) +
      '</div>' +
      facts([
        { k: "正赛权重", v: "枪 " + sc(w.centerGun) + " · 围 " + sc(w.encircle) + " · 旗 " + sc(w.captureFlag), n: "抢旗分永远压不过前两项" },
        { k: "加时三道门", v: "旗点 ≤ 3 才蹲", n: "锚点 0.5→0.05、驻点 8→1.5、抢旗分 ×3" },
        { k: "捡旗 : 回本垒", v: "20 : 1", n: "八方一局里的实测", hot: true }
      ]) +
      screen(["抢旗 " + sc(w.captureFlag), "旗点 >3 就不蹲", "捡旗 20 : 回本垒 1"]);
  }

  /* ---------- 25 页 ---------- */
  function p01() {
    var names = ["GPT-6", "Claude", "Kimi", "GLM", "DeepSeek", "Qwen-Max", "Opus", "Sonnet", "MiMo", "豆包", "Fable"];
    return head("开场 · 选手", '一排云端模型，<span class="em">一台自己的机器</span>') +
      '<div class="fig" style="align-items:flex-start;gap:2.6vh">' +
      '<div class="ava-row" style="gap:1vw">' + names.map(function (n) {
        return '<span class="pill" style="font-size:2.2vh;padding:.4em 1em">' + esc(n) + "</span>";
      }).join("") + "</div>" +
      '<div style="font-size:2.8vh;color:var(--ink2);letter-spacing:.3em">＋ 我们额外请来的</div>' +
      '<div class="ava-row" style="gap:1.4vw">' + ava("lg") +
      '<div><div class="oneliner" style="font-size:6.6vh">Qwen3.8-27B</div>' +
      '<div class="sub">270 亿参数 · 不联网 · 跑在桌面上</div></div></div>' +
      "</div>" +
      screen(["一排云端模型", "1 台本地机器", "Qwen3.8-27B · 270 亿参数"]);
  }
  function p02() {
    return head("开场 · 本地环境", '跑在<span class="em">两张 5060 Ti</span>上') +
      '<div class="grid g4" style="margin:.6vh 0 1.6vh">' +
      '<div class="chip hot"><span class="k">显卡</span><span class="v">双 5060 Ti<span class="u">32G</span></span></div>' +
      '<div class="chip"><span class="k">服务端</span><span class="v">llama.cpp<span class="u">Q5_K_XL</span></span></div>' +
      '<div class="chip"><span class="k">权重</span><span class="v">19.7<span class="u">GB 全进显存</span></span></div>' +
      '<div class="chip"><span class="k">速度</span><span class="v">40<span class="u">tok/s</span></span></div>' +
      "</div>" +
      '<div class="oneliner" style="font-size:4.6vh">时限 <span class="em">60 / 90</span> 分钟 → 放宽到 <span class="em">90 / 120</span> 分钟</div>' +
      '<p class="sub">外壳：dsh 的 PTC 模式魔改本地预设 · 系统 WSL · 全程不联网</p>' +
      '<div class="grid g2" style="margin-top:2.2vh">' +
      '<div class="card"><h3>主动压缩 · 借鉴开源项目</h3><p>照开源项目 <b>billion-context</b> 的思路做个性化修改：折叠历史 → 模型自己写摘要 → 需要时再回读；失效退回云端 DeepSeek 兜底。</p></div>' +
      '<div class="card"><h3>llama.cpp 启动参数</h3><p>采样 <b>temp = 1</b> · KV 缓存 <b>q8</b> 量化 · 最大可用上下文 <b>145k</b> tokens；权重 Q5_K_XL 全压进显存。</p></div>' +
      "</div>" +
      screen(["双 5060 Ti · 32G 显存", "llama.cpp + Q5_K_XL · 19.7GB", "40 tok/s", "时限 60/90 → 90/120 分钟"]);
  }
  function p03() {
    return head("开场 · 规则", '三场比赛<span class="em">一条零分线</span>') +
      '<div class="grid" style="flex:1;min-height:0;grid-template-columns:repeat(3,1fr);gap:1.4vw;align-content:center">' +
      vslot("land", "圈地 · 加时单挑 vs 基准", "600 回合 · 1212 : 264") +
      vslot("bomb", "炸弹人 · 十人档", "十人混战 · 加时终版") +
      vslot("ctf", "夺旗 · 十三方混战", "人越多地图越大 · 400 回合") +
      "</div>" +
      screen(["圈地 600 回合", "炸弹人 2–10 人", "夺旗 2–15 方 · 400 回合", "基准 = 0 分线"]) +
      '<p class="sub">三场各有一个基准 bot，正式赛里它站在零分线上：赢基准只等于刚过线。</p>';
  }
  function p04() {
    var rows = [], tot = { steps: 0, out: 0, min: 0, cache: 0 };
    ["land", "bomb", "ctf"].forEach(function (g) {
      var r = splitOf(g).reg || {};
      tot.steps += r.steps || 0; tot.out += r.out || 0; tot.min += r.minutes || 0; tot.cache += r.cacheRead || 0;
      rows.push({ label: EP[g].name, value: r.out / 10000, color: EP[g].acc, note: (r.out / 10000).toFixed(1) + " 万" });
    });
    rows.push({ label: "云端最高一家", value: 24.1, color: "var(--ink2)", note: "24.1 万" });
    return head("开场 · 正赛的账", '参数最少的这个<span class="em">想得最多</span>') +
      hbars(rows, { labelW: 250, rh: 52, gap: 14 }) +
      facts([
        { k: "正赛步数", v: tot.steps + " 步", n: "加时另计 145 步" },
        { k: "输出 token", v: fmt(tot.out), n: "单场 22–26 万" },
        { k: "缓存读取", v: fmt(tot.cache) + " tok", n: "命中率 94%–96%" },
        { k: "净工作", v: Math.round(tot.min) + " 分钟", n: "同一批步的逐步耗时求和" }
      ]) +
      screen(["正赛 " + tot.steps + " 步 · 输出 " + fmt(tot.out) + " token", "单场 22–26 万", "正式赛参照 5.8–24.1 万"]) +
      '<p class="mini">模型净工作 ' + Math.round(tot.min) + ' 分钟 · 缓存读取 ' + fmt(tot.cache) + ' token · 命中率 94%–96% · 云端一栏取自官方赛后复盘表</p>';
  }
  function p05() {
    var tc = tcOf("land"), top = (tc.topSteps || [])[0] || {}, reg = splitOf("land").reg || {};
    return head("第一场 · 圈地 · 卡点", '一次<span class="em">三十四点九分钟</span>的长考') +
      track([{ t: "13:54", label: "开工" }, { t: "14:29", label: "第 6 步", cls: "bad" }, { t: "15:54", label: "交卷" }],
        { t0: "13:54", t1: "15:54", blocks: [{ from: "13:54", to: "14:29", label: "34.9 分钟 = 正赛近三成", color: "var(--land)" }], ticks: [{ t: "14:30" }, { t: "15:30" }] }) +
      screen(["第 6 步", "34.9 分钟", fmt(top.out || 84894) + " token", "占正赛近三成"]) +
      '<p class="mini">正赛净工作 ' + Math.round(reg.minutes || 120) + ' 分钟 · 长考定下"往角落扩张圈大块地"，走到第 77 步（开赛后 ' + since("15:29", reg.first || "13:54") + ' 分钟）它把这套重写了</p>';
  }
  function p06() {
    var m = resOf("land", "main") || {}, du = (m.duel || {}).score, me = (m.melee || {}).score, melo = (m.melee || {}).elo;
    return head("第一场 · 圈地 · 交卷", '单挑赢了，<span class="em">混战零分</span>') +
      '<div class="grid" style="flex:1;align-items:center;grid-template-columns:1fr 46vw;gap:2.4vw">' +
        '<div class="col" style="min-width:0">' + peerChart("land", ["main"], { rh: 30, gap: 7, fs: 25 }) + "</div>" +
        vslot("land_duel", "圈地 · 单挑 vs Sonnet 5", "1160 : 381 · 相机对准本机那一侧", "side") +
      "</div>" +

      facts([
        { k: "单挑", v: sc(du) + "（Elo " + sc((m.duel || {}).elo) + "）", n: "归一化：greedy = 0、该模式最强 = 100" },
        { k: "混战", v: sc(me) + "（Elo " + sc(melo) + "）", n: "随机乱走的锚点 Elo " + sc(m.randomAnchorElo), hot: true },
        { k: "名次", v: m.rank + " / " + m.field, n: "同表第一 Sonnet 5 满分 100" },
        { k: "95% 区间", v: m.ci95, n: "宽 9.6 分，0.7 分的差仍泡在噪声里" }
      ]) +
      screen(["圈地 " + sc(m.score) + " 分 · 第 " + m.rank + "/" + m.field, "单挑 " + sc(du), "混战 " + sc(me)]) +
      '<p class="mini">该模式最强 = 100 的归一化尺度 · 混战括号里是 Elo 刻度 · 名次按去掉基准的 10 家排 · ' + esc(resSrc("land")) + '</p>';
  }
  function p07() {
    var st = resOf("land", "selftest") || {}, la = (D.landAreas || {}).main || {};
    return head("第一场 · 圈地 · 反转", '它自测 <span class="em">' + sc(st.area) + '</span>，大样本 <span class="em">' + sc(la.mine) + "</span>") +
      hbars([
        { label: "自测 本机", value: st.area, color: "var(--good)", note: sc(st.area) },
        { label: "自测 基准", value: st.baseline, color: "var(--ink2)", note: sc(st.baseline) },
        { label: "大样本 本机", value: la.mine, color: "var(--red)", note: sc(la.mine), hot: true },
        { label: "大样本 基准", value: la.greedy, color: "var(--ink2)", note: sc(la.greedy) }
      ], { labelW: 260, rh: 46, gap: 14 }) +
      facts([
        { k: "自测", v: sc(st.area) + " : " + sc(st.baseline), n: "只打 " + (st.opponent || "greedy") + " 一个对手 · " + (st.games || 10) + " 局" },
        { k: "大样本", v: sc(la.mine) + " : " + sc(la.greedy), n: "全场 " + fmt(((FULL || {}).games || {}).land || 1128) + " 局" },
        { k: "本机单挑", v: fmt(la.games) + " 局", n: "胜率 " + sc(la.winRate) + "%" },
        { k: "同一份代码", v: "自测 vs 复核", n: "两列差的不是代码，是对手数和局数" }
      ]) +
      screen(["自测 " + sc(st.area) + " : " + sc(st.baseline), "大样本 " + sc(la.mine) + " : " + sc(la.greedy), "同一份代码"]) +
      '<p class="mini">自测只打了 ' + esc(st.opponent || "greedy") + " 一个对手（" + (st.games || 10) + " 局）· 大样本全场 " + fmt(((FULL || {}).games || {}).land || 1128) +
        " 局，本机参与的是其中 " + fmt(la.games) + " 局单挑，胜率 " + sc(la.winRate) + "%</p>";
  }
  function p08() {
    var ot = splitOf("land").ot || {}, m = resOf("land", "main") || {}, o = resOf("land", "ot") || {};
    return head("第一场 · 圈地 · 加时", '<span class="em">七版全部净负</span>') +
      '<div class="grid" style="flex:1;align-items:center;grid-template-columns:1.02fr .98fr">' +
      strategy([
        { tag: "正赛这版 · 局部袋子", title: "一次圈一个 60–120 格的大圈",
          idea: "先画圈、再往圈里长，圈一封住整片格子都算自己的",
          up: "单次捕获 +200~300 面积，本地对打八局全胜",
          dn: "走去封口的那条路径长，被对手踩断就整袋进度丢光" },
        { tag: "加时改成 · 七版都在改小", title: "改小只加在混战分支上，单挑那套大圈基本没动",
          idea: "混战里换成 24 次采样挑 gain 最大的小矩形（边长 3–8），入口改近优先、驻守半径从 9 收到 4 —— 全部挂在 N>2 的判断里",
          up: "混战暴露窗口从 60–120 格压到 24–32 格",
          dn: "这套小矩形和官方贪心锚点同构，而锚点就是 0 分线；单挑只多了一行「别从自家格起步」", hot: true }
      ], true) +
      '<div class="col" style="min-width:0">' + peerChart("land", ["main", "ot"], { rh: 32, gap: 8, fs: 19 }) + "</div>" +
      "</div>" +
      facts([
        { k: "加时", v: ot.steps + " 步 · " + fmt(ot.out) + " tok", n: "净工作 " + Math.round(ot.minutes) + " 分钟" },
        { k: "圈地分", v: sc(m.score) + " → " + sc(o.score), n: "加时涨 0.7 分，仍小于区间宽度", hot: true },
        { k: "95% 区间", v: sc(m.ci95), n: "加时版 " + sc(o.ci95) },
        { k: "七版判定", v: "全部净负", n: "1v1 八局 + 混战八局，净胜为正才留" }
      ]) +
      screen(["加时 " + ot.steps + " 步 · 输出 " + fmt(ot.out) + " token · 净工作 " + Math.round(ot.minutes) + " 分钟", "7 版全部净负", sc(m.score) + " → " + sc(o.score)]) ;;
  }
  function p09() {
    var tc = tcOf("bomb"), sp = splitOf("bomb"), reg = sp.reg || {};
    var FROM = "17:08", TO = "17:49", st = reg.first || "16:38";
    // errTimes 是整场（含加时 18 次）；这一页讲正赛，按正赛末步时刻切掉加时段，否则轴上会多出画布外的点
    var ev = (tc.errTimes || []).filter(function (t) { return !reg.last || t <= reg.last; });
    var marks = ev.map(function (t) { return { t: t, cls: "bad" }; });
    var dense = ev.filter(function (t) { return t >= FROM && t <= TO; }).length;
    return head("第二场 · 炸弹人 · 卡点", '四十一分钟里<span class="em">十一次编译报错</span>') +
      '<div class="grid" style="flex:1;align-items:center;grid-template-columns:1.1fr 1fr;gap:2.4vw">' +
        vslot("bomb_term", "炸弹人 · 十人档对局", "十人混战里的本机视角", "side") +
        '<div class="col" style="min-width:0">' + track(marks, { t0: st, t1: reg.last || "18:32", blocks: [{ from: FROM, to: TO, label: dense + " 次挤在这 41 分钟", color: "var(--bomb)" }], ticks: [{ t: "17:00" }, { t: "18:00" }], stagger: true }) + "</div></div>" +
      screen(["开赛后 " + since(FROM, st) + " → " + since(TO, st) + " 分钟", "正赛 " + (sp.errReg || ev.length) + " 次报错", "这 41 分钟占 " + dense + " 次"]) +
      '<p class="mini">转义字符被吞、括号多一个、类型转换过窄 —— 这段时间没有一行新逻辑</p>';
  }
  function p10() {
    // 横比柱必须和标题那个分数出自同一张表：peerChart 读的就是这一轮 --full 的同表选手
    var m = resOf("bomb", "main") || {}, rows = m.ratings || {};
    var names = Object.keys(rows).sort(function (a, b) { return rows[b] - rows[a]; });
    var top = rows[names[0]], mine = m.bt || 0;
    return head("第二场 · 炸弹人 · 交卷", sc(mine) + ' 分，<span class="em">第 ' + m.rank + '</span>') +
      '<div class="grid" style="flex:1;align-items:center;grid-template-columns:1fr 46vw;gap:2.4vw">' +
        '<div class="col" style="min-width:0">' + peerChart("bomb", ["main"], { rh: 30, gap: 7, fs: 25 }) + "</div>" +
        vslot("bomb_solo", "炸弹人 · 两人档 vs Kimi K3", "第 71 回合活到最后", "side") +
      "</div>" +

      facts([
        { k: "实力值", v: sc(mine), n: "400×log10(强度/基准)，上不封顶" },
        { k: "名次", v: m.rank + " / " + m.field, n: "去掉基准的 " + m.field + " 家" },
        { k: "同表第一", v: sc(top), n: "本机差它 " + sc(top - mine) + " 分" },
        { k: "同表局数", v: fmt(m.games || 1320) + " 局", n: "钉住 seed，逐局同座位同地图" }
      ]) +
      screen(["炸弹人 " + sc(mine) + " 分 · 第 " + m.rank + "/" + m.field, "基准 = 0", "本场第一名 " + sc(top)]) +
      '<p class="mini">名次按去掉基准的 ' + m.field + " 家排 · 正式赛那张表是另一批对局，本机不在里面</p>" +
      srcNote("bomb", "实力值 = 400×log10(强度/基准)，上不封顶");
  }
  function p11() {
    var m = resOf("bomb", "main") || {}, bs = (m.bySize || {});
    var tiers = Object.keys(bs).map(Number).sort(function (a, b) { return a - b; });
    var bars = [], won = [];
    tiers.forEach(function (t) {
      var e = bs[t];
      if (e.mine > e.base) won.push(t);
      bars.push({ label: t + " 人档 本机", value: e.mine, color: e.mine > e.base ? "var(--good)" : "var(--red)",
        note: sc(e.mine) + (e.faults ? "（故障 " + e.faults + " 局）" : ""), hot: e.mine <= e.base });
      bars.push({ label: t + " 人档 基准", value: e.base, color: "var(--ink2)", note: sc(e.base) });
    });
    return head("第二场 · 炸弹人 · 反转",
      won.length + ' 档赢，<span class="em">人多的那档输</span>') +
      '<div class="grid" style="flex:1;align-items:center;grid-template-columns:1fr 46vw;gap:2.4vw">' +
        '<div class="col" style="min-width:0">' + hbars(bars, { labelW: 240, rh: 36, gap: 10, fs: 28 }) + "</div>" +
        vslot("bomb_melee", "炸弹人 · 十人档", "第 12 回合死在 #117，十个人里最后一个", "side") +
      "</div>" +

      facts(tiers.map(function (t) {
        var e = bs[t];
        return { k: t + " 人档", v: sc(e.mine) + " : " + sc(e.base),
          n: (e.mine > e.base ? "赢 " : "输 ") + sc(Math.abs(e.mine - e.base)) + (e.faults ? " · 故障 " + e.faults + " 局" : ""),
          hot: e.mine <= e.base };
      })) +
      screen([tiers.map(function (t) { return t + " 人档 " + sc(bs[t].mine) + " 基准 " + sc(bs[t].base); }).join(" · "),
        "故障 " + (bs[tiers[tiers.length - 1]].faults || 0) + " 局"]) +
      '<p class="mini">评分按人数档等权算 · 十人档另外九个选手故障局全是零，只有本机 1 局 · 两端跑的是同一套 ' + fmt(m.games || 1320) + ' 局，逐局同座位同地图</p>';
  }
  function p12() {
    var ot = splitOf("bomb").ot || {};
    var mm = resOf("bomb", "main") || {}, o = resOf("bomb", "ot") || {};
    var m10 = (mm.bySize || {})["10"] || {}, o10 = (o.bySize || {})["10"] || {};
    return head("第二场 · 炸弹人 · 加时", '四版才摸到<span class="em">根因</span>') +
      '<div class="grid" style="flex:1;align-items:center;grid-template-columns:1.04fr .96fr">' +
      strategy([
        { tag: "正赛这版 · 复刻引擎", title: "在 C++ 里把引擎重算一遍，往前模拟几步再决定",
          idea: "它读完成基准就写下「baseline.cpp is actually a pretty decent bot」，判断要赢只能算得比它深",
          up: "算得准，能预判连锁爆炸和对手走位",
          dn: "开局那一回合要 1561–1800 毫秒，预算只有 2000 毫秒，裁判机稍慢就超时" },
        { tag: "加时改成 · 四版", title: "先砍预算提速失败，再只收十人档，最后修 memcpy",
          idea: "v1 全局收紧搜索 → 自测变差回滚；v2 只对十人档收；v3 给叠雷链爆多扣 400 分；v4 修那个只拷一半的 memcpy",
          up: "开局回落到 50–70 毫秒，之后每步 3 毫秒以内",
          dn: "深搜省不得——v1 连两人档一起砍，中局表现立刻掉回去", hot: true }
      ], true) +
      vslot("bomb_ot", "炸弹人 · 十人档", "同一张图同一个座位：1.0 分 → 9.5 分", "side") +
      "</div>" +
      facts([
        { k: "十人档", v: sc(m10.mine) + " → " + sc(o10.mine), n: "基准 " + sc(m10.base) + " → " + sc(o10.base) },
        { k: "十人档故障", v: m10.faults + " → " + o10.faults + " 局", n: "另外九个选手的故障局全是零" },
        { k: "两人档", v: "一分不差", n: "169 格，够不着截断线" },
        { k: "对照条件", v: "同赛程 · 同并发", n: "两根条只差代码" }
      ]) +
      screen(["加时 " + ot.steps + " 步 · 输出 " + fmt(ot.out) + " token · 净工作 " + Math.round(ot.minutes) + " 分钟",
        "BT " + sc(mm.bt) + " → " + sc(o.bt), "名次 " + mm.rank + " → " + o.rank]) +
      '<p class="mini">这一对钉了同一套 ' + fmt(((FULL || {}).games || {}).bomb || 1320) + " 局赛程（--seed 20261004）、并发压到 2，逐局同座位同地图 —— 两根条只差代码</p>";
  }
  function p14() {
    var mf = LG.memcpy || {}, BZ = D.blindZone || {}, bz = BZ.main || {};
    function cells(n) { var s = 2 * Math.ceil(Math.sqrt(14 * n)) + 1; return s * s; }
    var ns = [2, 3, 4, 5, 8, 10], pts = ns.map(function (n) { return [n, cells(n)]; });
    return head("第二场 · 炸弹人 · 追问", '<span class="em">半张棋盘</span>看不见火') +
      '<div class="grid" style="flex:1;align-items:center;grid-template-columns:46vw 1fr;gap:2.4vw">' +
      '<div class="col" style="min-width:0;justify-content:center">' +
        vslot("bomb_blind", "炸弹人 · 十人档", "第 168 回合死在 #563，火焰在它看不见的那半边", "side") + "</div>" +
      '<div class="col vstack" style="min-width:0;gap:2.6vh;justify-content:center">' +
        areaFig(mf.threshold || 312) +
      '<div class="code wrapall" style="margin-top:2.2vh"><span class="ln"><i>472</i>memcpy(R.flame, FL, <span class="flag">625</span>);</span>' +
      '<span class="ln"><i>472</i><span class="cm">// int16_t flame[625] 该写 625*sizeof(int16_t)</span></span></div>' +
      '<div class="oneliner" style="font-size:4.1vh">该拷 <span class="em">1250</span> 字节<br>代码里写了 <span class="em">625</span></div>' +
      "</div>" +
      "</div>" +
      facts([
        { k: "截断位置", v: "第 " + (mf.threshold || 312) + " 格起", n: "25×25 = 625 格，后 313 格收不到火" },
        { k: "十人档被炸死", v: bz.blastDeathsMine + " 次", n: "其中 " + bz.blind + " 次（" + sc(bz.blindShare) + "%）死在盲区 · 逐局回放数出", hot: true },
        { k: "它站在盲区的时间", v: sc(bz.occupancyBlindShare) + "%", n: "同局九家看整张盘，比例 " + sc(bz.peersBlindShare) + "% ≈ 盲区面积比" },
        { k: "修好之后", v: sc((BZ.ot || {}).blindShare) + "%", n: "625 → 625*sizeof(int16_t)" }
      ]) +
      screen(["2 人 169 格", "4 人 289 格", "10 人 625 格 · 漏 313", "十人档炸死 " + bz.blind + " 次在盲区"]);
  }
  function p15() {
    var cl = clockOf("ctf"), reads = cl.reads || [], st = splitOf("ctf").reg.first || "18:40";
    var FROM = "20:12", TO = "20:26";
    var win = reads.filter(function (r) { return r.t >= FROM && r.t <= TO; });
    var marks = win.map(function (r) { return { t: r.t, cls: "bad" }; });
    var solo = win.filter(function (r) { return r.solo || r.standalone; }).length;
    // 读数从窗口首末两条记录里解析，别硬编码（原来手写的 104.2 根本不在这一段的 12 条里）
    var rd = function (r) { var m = /([\d.]+)\s*分钟/.exec((r && r.printed) || ""); return m ? m[1] : "—"; };
    var first = rd(win[0]), last = rd(win[win.length - 1]);
    return head("第三场 · 夺旗 · 卡点", '交卷前<span class="em">看了' + marks.length + "次钟</span>") +
      track(marks, { t0: "20:05", t1: "20:35", origin: st, blocks: [{ from: FROM, to: TO, label: marks.length + " 次挤在这 14 分钟", color: "var(--ctf)" }], ticks: [{ t: "20:10" }, { t: "20:20" }, { t: "20:30" }], stagger: true }) +
      screen(["开赛后 " + since(FROM, st) + " → " + since(TO, st) + " 分钟", marks.length + " 次（" + solo + " 次单独一步）", first + " 分 → " + last + " 分"]) +
      '<p class="mini">这一场它一次服务崩溃都没碰上，是三场里时间最宽裕的</p>';
  }
  function p16() {
    var m = resOf("ctf", "main") || {};
    return head("第三场 · 夺旗 · 交卷", '<span class="em">' + sc(m.bt) + '</span>，' + (m.field || 12) + ' 家垫底') +
      peerChart("ctf", ["main"], { rh: 32, gap: 8, fs: 19 }) +
      facts([
        { k: "实力值", v: sc(m.bt), n: "基准 = 0 分线，上不封顶" },
        { k: "名次", v: m.rank + " / " + m.field, n: "十二家垫底", hot: true },
        { k: "95% 区间", v: m.ci95, n: "精简赛整体向零收缩" },
        { k: "故障局", v: (m.faults || 0) + " 局", n: "全部在十三方档 · 样本 " + fmt(m.games) + " 局" },
      ]) +
      screen(["夺旗 " + sc(m.bt) + " 分 · 第 " + m.rank + "/" + m.field, "基准 = 0", "自记 " + (m.selfRecord ? m.selfRecord.mine + " : " + m.selfRecord.base : "—")]) +
      srcNote("ctf", "README 原话：每局净负 " + sc(m.selfRecord && m.selfRecord.netPerGame) + " 分");
  }
  function p17() {
    var m = resOf("ctf", "main") || {};
    var tiers = Object.keys(m.bySize || {});
    if (!tiers.length) tiers = ["2", "3", "5", "8"];
    var fm = CF.main || {}, bt = fm.byTier || {}, bk = Object.keys(bt);
    var fault = bk.length
      ? "大样本 " + fmt(fm.games) + " 局里本机崩 " + fm.total + " 局：" +
        bk.map(function (t) { return t + " 方档 " + ((fm.gamesByTier || {})[t] || "?") + " 局里崩 " + bt[t] + " 局"; }).join("、") +
        " · 报「" + esc(String(fm.msg || "").replace("-", "−")) + "」· 它这一版单回合最慢 " + fm.maxMs + "ms，时限 50ms，不是超时"
      : "";
    return head("第三场 · 夺旗 · 反转", '<span class="em">五十四局</span>自测全是两方局') +
      coverGrid(m.selftestGames || 54, tiers.map(Number)) +
      screen(["自测 " + (m.selftestGames || 54) + "/" + (m.selftestGames || 54) + " 局是两方", "评分考 " + tiers.join(" / ") + " 方"]) +
      (fault ? '<p class="mini">' + fault + "</p>" : "");
  }
  function p18() {
    var ot = splitOf("ctf").ot || {}, w = LG.weights || {}, series = [];
    if (DG && DG.score && DG.score.length) {
      for (var i = 0; i < DG.score[0].length; i++) {
        series.push({
          name: i === DG.ours ? "本地 27B" : null,
          color: i === DG.ours ? "var(--red)" : "var(--ink2)",
          hot: i === DG.ours, dim: i !== DG.ours,
          pts: DG.turns.map(function (t, k) { return [t, DG.score[k][i]]; })
        });
      }
    }
    return head("第三场 · 夺旗 · 加时", '八支队伍里<span class="em">唯一的零</span>') +
      '<div class="grid" style="flex:1;align-items:center;grid-template-columns:46vw 1fr;gap:2.4vw">' +
        vslot("ctf_zero", "夺旗 · 八方混战 vs 基准 1-7", "镜头锁在中间三个不动的单位", "side") +
        '<div class="col" style="min-width:0">' +
        '<p class="mini">八方局逐回合得分 · 横轴 400 回合 · 八条线里只有本机那条一直是 0</p>' +
      lineChart(series, { x0: 0, x1: 400, y0: 0, y1: 17, invertY: true, xTicks: [0, 100, 200, 300, 400], yTicks: [0, 4, 8, 12, 16], padB: 46, padR: 200, h: 300 }) +
      "</div></div>" +
      facts([
        { k: "八方局", v: "全场唯一 0 分", n: "八条线里只有本机一直是 0", hot: true },
        { k: "捡旗 : 回本垒", v: "20 : 1", n: "八方一局里的实测" }
      ]) +
      screen(["加时 " + ot.steps + " 步 · " + fmt(ot.out) + " token · " + fmt1(ot.minutes) + " 分钟 · 零中断", "抢旗 " + sc(w.captureFlag), "旗点 >3 就不蹲"]) +
      '<p class="mini">v14 试过按角度分区驻守，没有改进被回滚 · 它自己复现出八方 0 分那一局：座位 0 和 7 的基地只隔 9 格，回家最后 8 步被两三个人拦住，死了 35 次</p>';
  }
  function p20() {
    var m = resOf("ctf", "main") || {}, o = resOf("ctf", "ot") || {};
    var chain = o.chain || ["v9", "v13"];
    return head("第三场 · 夺旗 · 结果", sc(m.bt) + ' 变 <span class="em">' + sc(o.bt) + '</span>') +
      '<div class="grid" style="flex:1;align-items:center;grid-template-columns:1fr 46vw;gap:2.4vw">' +
        '<div class="col" style="min-width:0">' + peerChart("ctf", ["main", "ot"], { rh: 26, gap: 5, fs: 21, tags: { "Sonnet 5.5": "本轮抽到好签 · 不可横比" } }) + "</div>" +
        vslot("ctf_duel", "夺旗 · 单挑 vs GLM 5.3", "打赢强模型、BT 从 " + sc(m.bt) + " 抬到 " + sc(o.bt), "side") +
      "</div>" +
      facts([
        { k: "区间", v: "涨 " + sc(o.bt - m.bt), n: sc(m.bt) + " → " + sc(o.bt) + " · 名次 " + m.rank + " → " + o.rank, hot: true },
        { k: "段错误", v: (m.faults || 0) + " → " + (o.faults || 0) + " 局", n: "正赛版全在十三方档 · 加时版集中在 10 / 13 方" },
        { k: "加时这一轮", v: (splitOf("ctf").ot || {}).steps + " 步 · " + fmt1((splitOf("ctf").ot || {}).minutes) + " 分钟", n: "零中断" }
      ]) +
      screen([chain[0] + " → " + chain[chain.length - 1], sc(m.bt) + " → " + sc(o.bt), "第 " + m.rank + " 名 → 第 " + o.rank + " 名"]) +
      '<p class="mini">两轮各抽一套座位与地图：除 Sonnet 5.5 外，其余十一家相对位次都在 ±1–2 名内；它从第 5 跳到第 1 是这轮抽到好签（+52），分数不可与上一轮横比。</p>';
  }
  function p21() {
    // 三场现在两端都是大样本，能连在一张图上；炸弹人那对还额外钉了同一套赛程
    var rows = ["ctf", "land", "bomb"].map(function (g, i) {
      var m = resOf(g, "main") || {}, o = resOf(g, "ot") || {};
      var moved = (o.rank || m.rank) !== m.rank;
      return {
        name: EP[g].name + " " + m.rank + "→" + (o.rank || m.rank), color: EP[g].acc, hot: moved, dim: !moved,
        labelDy: i === 1 ? -20 : 0,
        pts: [[0, m.rank], [1, o.rank || m.rank]]
      };
    });
    var B = ((FULL || {}).bomb || {});
    var pair = function (x, y) { return sc(x) + " → " + sc(y); };
    var movedN = rows.filter(function (r) { return r.hot; }).length;
    return head("收尾 · 名次", "三条线里 <span class=\"em\">" + movedN + " 条动了名次</span>") +
      lineChart(rows, { x0: -0.2, x1: 1.2, y0: 13, y1: 1, invertY: true, xTicks: [0, 1], xFmt: function (v) { return v === 0 ? "正赛" : "加时"; }, yTicks: [1, 4, 8, 12], padL: 100, padR: 240 }) +
      facts([
        { k: "换代码", v: "+" + sc(B.ctl_ctlot.bt - B.ctl_ctlmain.bt), n: "同赛程 · 受控并发 w2" },
        { k: "名次", v: B.ctl_ctlmain.rank + " → " + B.ctl_ctlot.rank, n: "同一套 1320 局赛程" },
        { k: "十人档", v: sc(B.ctl_ctlmain.bySize[10].mine) + " → " + sc(B.ctl_ctlot.bySize[10].mine), n: "该档 200 局 · 基准 " + sc(B.ctl_ctlmain.bySize[10].base) + " → " + sc(B.ctl_ctlot.bySize[10].base) }
      ]) +
      screen(["圈地 " + rows[1].pts[0][1] + " → " + rows[1].pts[1][1], "夺旗 " + rows[0].pts[0][1] + " → " + rows[0].pts[1][1],
        "炸弹人 " + rows[2].pts[0][1] + " → " + rows[2].pts[1][1]]) +
      '<p class="mini">炸弹人两版跑的是同一套 ' + fmt(((FULL || {}).games || {}).bomb || 1320) + " 局赛程（--seed 20261004）、并发压到 2 —— 涨分不等于涨名次</p>";
  }
  function p22() {
    var t = { reg: { steps: 0, out: 0, min: 0, err: 0, comp: 0 }, ot: { steps: 0, out: 0, min: 0, err: 0, comp: 0 } };
    ["land", "bomb", "ctf"].forEach(function (g) {
      var s = splitOf(g);
      ["reg", "ot"].forEach(function (p) {
        var x = s[p] || {};
        t[p].steps += x.steps || 0; t[p].out += x.out || 0; t[p].min += x.minutes || 0;
      });
      t.reg.err += s.errReg || 0; t.ot.err += s.errOT || 0;
      t.reg.comp += s.compReg || 0; t.ot.comp += s.compOT || 0;
    });
    function row(p, name) {
      var x = t[p];
      return '<tr><td>' + name + '</td><td class="num">' + x.steps + '</td><td class="num">' + fmt(x.out) +
        "</td><td class=\"num\">" + Math.round(x.min) + '</td><td class="num">' + x.err + '</td><td class="num">' + x.comp + "</td></tr>";
    }
    return head("收尾 · 两本账", '正赛和加时<span class="em">各花了多少</span>') +
      '<div class="fig tablepanel"><table style="max-width:74vw"><thead><tr><th>阶段</th><th style="text-align:right">步数</th>' +
      '<th style="text-align:right">输出 token</th><th style="text-align:right">净工作(分)</th><th style="text-align:right">工具报错</th><th style="text-align:right">压缩</th></tr></thead>' +
      "<tbody>" + row("reg", "正赛") + row("ot", "加时") +
      '<tr class="me"><td>三场合计</td><td class="num">' + (t.reg.steps + t.ot.steps) + "</td><td class=\"num\">" + fmt(t.reg.out + t.ot.out) +
      "</td><td class=\"num\">" + Math.round(t.reg.min + t.ot.min) + "</td><td class=\"num\">" + (t.reg.err + t.ot.err) +
      "</td><td class=\"num\">" + (t.reg.comp + t.ot.comp) + "</td></tr></tbody></table></div>" +
      facts([
        { k: "正赛", v: t.reg.steps + " 步 · " + fmt(t.reg.out) + " tok", n: Math.round(t.reg.min) + " 分钟 · 报错 " + t.reg.err + " · 压缩 " + t.reg.comp },
        { k: "加时", v: t.ot.steps + " 步 · " + fmt(t.ot.out) + " tok", n: Math.round(t.ot.min) + " 分钟 · 报错 " + t.ot.err + " · 压缩 " + t.ot.comp },
        { k: "合计", v: (t.reg.steps + t.ot.steps) + " 步", n: fmt(t.reg.out + t.ot.out) + " tok · " + Math.round(t.reg.min + t.ot.min) + " 分钟" },
        { k: "压缩", v: (t.reg.comp + t.ot.comp) + " 次", n: "正赛 " + t.reg.comp + " · 加时 " + t.ot.comp }
      ]) +
      screen(["正赛 " + t.reg.steps + "步 " + fmt(t.reg.out) + "tok " + Math.round(t.reg.min) + "分钟",
        "加时 " + t.ot.steps + "步 " + fmt(t.ot.out) + "tok " + Math.round(t.ot.min) + "分钟",
        "报错 " + t.reg.err + "→" + t.ot.err + " 压缩 " + t.reg.comp + "→" + t.ot.comp]);
  }
  function p23() {
    var pal = [{ f: "#58f8f8", k: "#08123c" }, { f: "#7cb0ff", k: "#08123c" }, { f: "#c9a7ff", k: "#08123c" },
      { f: "#ffd166", k: "#08123c" }, { f: "#ff3b30", k: "#ffffff" }];
    var rows = ["land", "bomb", "ctf"].map(function (g) {
      return {
        label: EP[g].name, total: Math.round((tcOf(g).effective || {}).minutes || 0),
        segs: (function () {
          var cats = (tcOf(g).categories || []).slice();
          var top = cats.slice(0, 4), rest = cats.slice(4);
          var segs = top.map(function (c, k) {
            var pc = pal[k % pal.length];
            return { label: String(c.label || c.cat).replace(/（.*?）/, ""), min: c.minutes || 0, color: pc.f, ink: pc.k };
          });
          if (rest.length) {
            var sum = rest.reduce(function (a, c) { return a + (c.minutes || 0); }, 0);
            segs.push({ label: "其他 " + rest.length + " 类", min: sum, color: "#8fa6d8", ink: "#08123c" });
          }
          return segs;
        })()
      };
    });
    var landTop = rows[0].segs[0] || { min: 45 }, bombProto = null;
    (tcOf("bomb").categories || []).forEach(function (c) { if (!bombProto && /协议/.test(String(c.label || ""))) bombProto = c; });
    return head("收尾 · 时间去向", '时间<span class="em">花在哪</span>') +
      ribbon(rows) +
      facts(rows.map(function (rw) {
        var t1 = rw.segs[0] || { label: "—", min: 0 };
        return { k: rw.label, v: Math.round(rw.total || 0) + " 分钟", n: "最大一块 " + t1.label + " " + Math.round(t1.min) + " 分" };
      })) +
      screen(["圈地：设计长考 " + Math.round(landTop.min) + " 分钟", "炸弹人：协议排错 " + Math.round((bombProto || {}).minutes || 30) + " 分钟"]) +
      '<p class="mini">三场没有一场因为时间不够才交白卷，但确实因为时间不够没能迭代够多轮次</p>';
  }
  function p24() {
    var rows = ["land", "bomb", "ctf"].map(function (g, i) {
      var r = splitOf(g).reg || {};
      return { label: EP[g].name + " 本机", value: r.minutes || 0, color: "var(--red)", hot: i === 0, note: Math.round(r.minutes) + " 分钟" };
    });
    rows.push({ label: "正式赛最慢", value: 78, color: "var(--ink2)", note: "78 分钟" });
    rows.push({ label: "正式赛最快", value: 27, color: "var(--ink2)", note: "27 分钟" });
    return head("收尾 · 结论", '缺的<span class="em">不只是时间</span>') +
      hbars(rows, { labelW: 250, rh: 48, gap: 14, max: 130 }) +
      screen(["本机是正式赛用时的 2–4 倍", "瓶颈是 40 tok/s", "正式赛各家仅作参照"]);
  }
  function p25() {
    var C = D.compactionPage || {}, t = C.tax || {}, p1 = C.probe1 || {}, p2 = C.probe2 || {};
    var ms = p2.mistakeAcrossFold || [], rs = p2.rerereadAcrossFold || [];
    var zero = function (v) { return (v == null ? 0 : v); };
    var rows = [
      { label: "搜回被折叠的原文", value: zero(p1.sessionQuery), note: zero(p1.sessionQuery) + " 次",
        color: "var(--ink2)", dim: true },
      { label: "重做同一处编辑", value: zero(p2.redoSameEditStrict), note: zero(p2.redoSameEditStrict) + " 对",
        color: "var(--ink2)", dim: true },
      { label: "同一类错误再踩一次", value: ms.length, note: ms.length + " 例", hot: true },
      { label: "同一份文件重读一遍", value: rs.length, note: rs.length + " 处", hot: true }
    ];
    var a = ms[0] || {}, b = ms[1] || {};
    return head("收尾", '主动<span class="em">压缩</span>的代价') +
      hbars(rows, { labelW: 300, rh: 46, gap: 15, fs: 22, zero: true, zeroLabel: "0", max: 7 }) +
      facts([
        { k: "折叠次数", v: t.events + " 次", n: t.selfInitiated + " 次自己调 · " + t.engineTaken + " 次引擎接管" },
        { k: "写笔记那步", v: t.noteMinSec + "–" + t.noteMaxSec + " 秒", n: "折叠当步的墙钟" },
        { k: "折叠后重放", v: fmt(t.replayMaxTok) + " tok", n: "命中从 " + fmt(t.cacheMaxBefore) + " 掉回 " + fmt(t.afterMin) + "–" + fmt(t.afterMax) },
        { k: "被折叠后回头搜", v: "0 次", n: "工具随时可调，提示与回执都教过用法", hot: true }
      ]) +
      screen(["三场折叠 " + t.events + " 次", "写笔记当步 " + t.noteMinSec + "–" + t.noteMaxSec + " 秒",
        "折叠后重放最多 " + fmt(t.replayMaxTok) + " tok"]) +
      '<p class="mini">' + t.events + " 次摘要里 " + t.selfInitiated + " 次是它自己调 compact_region 折的、" +
        t.engineTaken + " 次是引擎接管。代价两块：写笔记那一步 " + t.noteMinSec + "–" + t.noteMaxSec +
        " 秒；更要紧的是折叠后第一步要重放一遍，缓存命中从折叠当步的 " + fmt(t.cacheMaxBefore) +
        " 一律掉回 " + fmt(t.afterMin) + "–" + fmt(t.afterMax) + "。回读工具是挂了机的，真名 " +
        esc((p1.toolNames || [])[0]) + "，系统提示和每次折叠的回执里都逐字写了怎么用它，它一次都没调 —— " +
        "丢掉的细节改成回源文件重读。重读捞得回规则，捞不回手感：" + esc(a.game) + " " +
        esc((a.from || "").split("@")[1]) + " 把 printf 的换行符写坏、" + esc((a.to || "").split("@")[1]) +
        " 同一处又坏一次，中间 " + a.gapSteps + " 步 " + a.foldsBetween + " 次折叠；" + esc(b.game) + " " +
        esc((b.from || "").split("@")[1]) + " 刚修好，隔 " + b.gapSteps + " 步到 " +
        esc((b.to || "").split("@")[1]) + " 打补丁时再坏一次。口径与逐条原文见 data/compaction-page.json</p>";
  }
  function p27() {
    return '<div class="fig" style="gap:3.4vh"><div class="bignum" style="right:4vw">完</div>' +
      '<h1 class="title" style="transform:none;text-align:center;font-size:14vh">完</h1>' +
      '<p class="subtitle" style="text-align:center">每场只跑了一轮，单次采样，名次里带评测噪声。<br>所有运行日志都留着，可以回溯。</p>' +
      screen(["日志全部留存 · 可回溯"]) +
      '<p class="mini" id="rope-hint" style="color:var(--red)">▼ 点击 / → 沉入水中</p></div>';
  }
  function p26() {
    var cols = ["ctf", "land", "bomb"].map(function (g) {
      var cl = clockOf(g);
      return { name: EP[g].name, n: cl.n || 0, main: cl.main || 0, over: cl.over || 0, solo: cl.solo || 0,
        ride: cl.ride || 0, wrapper: cl.wrapper || 0, direct: cl.direct || 0, reads: cl.reads || [] };
    });
    var tot = cols.reduce(function (a, c) {
      return { n: a.n + c.n, main: a.main + c.main, over: a.over + c.over, solo: a.solo + c.solo, ride: a.ride + c.ride,
        wrap: a.wrap + c.wrapper, dir: a.dir + c.direct };
    }, { n: 0, main: 0, over: 0, solo: 0, ride: 0, wrap: 0, dir: 0 });
    var y = 30, out = "";
    cols.forEach(function (c) {
      var x0 = 60, x1 = 620, n = Math.max(1, c.reads.length - 1), k0 = -1;
      c.reads.forEach(function (r, k) { if (k0 < 0 && (r.phase === "overtime" || r.phase === "over")) k0 = k; });
      var hasOver = k0 >= 0;
      var xs = function (k) { return x0 + (k / n) * (x1 - x0); };
      var dx = hasOver ? xs(Math.max(0, k0 - 0.5)) : x1;
      out += T(x0, y + 20, c.name + " · " + c.n + " 次", "ax big", 25);
      // 轨道分两段：正赛（冷）+ 加时（暖），一眼能看出分界
      out += R(x0, y + 34, Math.max(2, dx - x0), 20, "var(--paper3)", "trk");
      if (hasOver) out += R(dx, y + 34, Math.max(2, x1 - dx), 20, "rgba(255,194,31,.45)", "trk");
      if (hasOver) out += LN(dx, y + 24, dx, y + 64, "gl split");
      c.reads.forEach(function (r, k) {
        out += '<circle cx="' + xs(k).toFixed(1) + '" cy="' + (y + 44) + '" r="8" fill="' + ((r.standalone || r.solo) ? "var(--good)" : "var(--red)") + '" class="pt"/>';
      });
      out += T((x0 + dx) / 2, y + 74, "正赛 " + c.main + " 次", "ax", 19, "middle");
      if (hasOver) out += T((dx + x1) / 2, y + 74, "加时 " + c.over + " 次", "vlab acc", 19, "middle");
      out += T(x1 + 24, y + 34, "脚本 " + c.wrapper + " · 自己算 " + c.direct, "ax", 20);
      out += T(x1 + 24, y + 58, "单独一步 " + c.solo + " · 夹在命令里 " + c.ride, "ax", 20);
      y += 118;
    });
    // 一行 40 个字会画出 viewBox（1000 宽 × 25 号字只放得下约 38 字），拆两行
    out += T(60, y + 24, "合计 " + tot.n + " 次 · 其中 " + tot.solo + " 次单独一步，只为核实时间", "vlab acc", 25);
    out += T(60, y + 56, "另外 " + tot.ride + " 次夹在别的命令后面顺手看一眼", "vlab acc", 25);
    // 图例：上面那一排点分红绿两色，不给说明观众不知道差在哪
    var ly = y + 96;
    out += '<circle cx="70" cy="' + ly + '" r="9" fill="var(--good)" class="pt"/>' +
      T(88, ly + 8, "单独一步看时间 " + tot.solo + " 次", "vlab", 21, "start") +
      '<circle cx="420" cy="' + ly + '" r="9" fill="var(--red)" class="pt"/>' +
      T(438, ly + 8, "夹在别的命令里 " + tot.ride + " 次", "vlab", 21, "start") +
      T(760, ly + 8, "虚线段 = 正赛 / 加时 分界", "ax", 19, "start");
    return head("附录 · 执行层面", '它一共<span class="em">看了 30 次钟</span>') +
      '<div class="fig"><svg viewBox="0 0 ' + VW + " " + (y + 124) + '" preserveAspectRatio="xMidYMid meet">' + out + "</svg></div>" +
      screen([tot.n + " 次：夺旗 " + cols[0].n + " · 圈地 " + cols[1].n + " · 炸弹人 " + cols[2].n,
        "正赛 " + tot.main + " / 加时 " + tot.over,
        "脚本 " + tot.wrap + " 次，自己读日志 " + tot.dir + " 次"]);
  }

  /* ---------- 页面表（与 script/口播稿.md 的 25 页一一对应）---------- */
  var PAGES = [
    { cap: "开场 · 选手登场", acc: "var(--red)", build: p01 },
    { cap: "开场 · 本地环境", acc: "var(--red)", build: p02 },
    { cap: "开场 · 三场规则", acc: "var(--red)", build: p03 },
    { cap: "开场 · 正赛的 token 账", acc: "var(--red)", cls: "dense", build: p04 },
    { cap: "圈地 · 34.9 分钟长考", acc: "var(--land)", cls: "ep-land", build: p05 },
    { cap: "圈地 · 交卷成绩", acc: "var(--land)", cls: "ep-land", build: p06 },
    { cap: "圈地 · 自测 851 对评测 427", acc: "var(--land)", cls: "ep-land", build: p07 },
    { cap: "圈地 · 加时七版全负", acc: "var(--land)", cls: "ep-land dense", build: p08 },
    { cap: "炸弹人 · 41 分钟 11 次报错", acc: "var(--bomb)", cls: "ep-bomb", build: p09 },
    { cap: "炸弹人 · 交卷成绩", acc: "var(--bomb)", cls: "ep-bomb dense", build: p10 },
    { cap: "炸弹人 · 按人数档拆开", acc: "var(--bomb)", cls: "ep-bomb", build: p11 },
    { cap: "炸弹人 · 四版才摸到根因", acc: "var(--bomb)", cls: "ep-bomb dense", build: p12 },
    { cap: "炸弹人 · 换代码涨了多少", acc: "var(--bomb)", cls: "ep-bomb dense", build: p13 },
    { cap: "炸弹人 · 半张棋盘看不见火", acc: "var(--bomb)", cls: "ep-bomb dense", build: p14 },
    { cap: "夺旗 · 十四分钟十一次看表", acc: "var(--ctf)", cls: "ep-ctf", build: p15 },
    { cap: "夺旗 · 交卷成绩", acc: "var(--ctf)", cls: "ep-ctf", build: p16 },
    { cap: "夺旗 · 54 局全是两方局", acc: "var(--ctf)", cls: "ep-ctf", build: p17 },
    { cap: "夺旗 · 八方局回放", acc: "var(--ctf)", cls: "ep-ctf", build: p18 },
    { cap: "夺旗 · 三个单位钉在家里的原因", acc: "var(--ctf)", cls: "ep-ctf dense", build: p19 },
    { cap: "夺旗 · 加时后分数与名次", acc: "var(--ctf)", cls: "ep-ctf", build: p20 },
    { cap: "收尾 · 名次折线", acc: "var(--red)", build: p21 },
    { cap: "收尾 · 正赛与加时两本账", acc: "var(--red)", cls: "dense", build: p22 },
    { cap: "收尾 · 时间去向", acc: "var(--red)", build: p23 },
    { cap: "收尾 · 缺的不是时间", acc: "var(--red)", build: p24 },
    { cap: "收尾 · 主动压缩的代价", acc: "var(--red)", cls: "dense", build: p25 },
    { cap: "附录 · 靠谱的执行模型", acc: "var(--red)", cls: "dense", build: p26 },
    { cap: "完 · 沉海落幕", acc: "var(--red)", last: true, build: p27 }
  ];

  /* ---------- 装配页面 ---------- */
  var stage = $("#stage");
  var wipe = $("#wipe");
  PAGES.forEach(function (p, i) {
    var el = document.createElement("section");
    el.className = "page" + (p.cls ? " " + p.cls : "");
    el.style.setProperty("--acc", p.acc);
    el.dataset.i = i;
    el.innerHTML = p.build();
    stage.appendChild(el);
  });
  var secs = Array.prototype.slice.call(stage.querySelectorAll(".page"));


  /* ---------- 按配音时间轴逐个点亮（?cue=1，加 &auto=1 按每页时长自动翻页） ---------- */
  var CUES = window.__CUES__ || null;
  var cueOn = /[?&]cue=1/.test(location.search), cueAuto = /[?&]auto=1/.test(location.search), cueTimers = [];
  var cueWait = /[?&]wait=1/.test(location.search), cueStarted = !cueWait, cuePending = null;
  var CUE_SEL = ".subtitle, .tagline.screen span, .oneliner, .facts .fact, .mini, .card";
  function cueClear() { for (var i = 0; i < cueTimers.length; i++) clearTimeout(cueTimers[i]); cueTimers = []; }
  function cuePlay(pageEl, idx) {
    cueClear();
    if (!cueOn || !pageEl) return;
    if (!cueStarted) { cuePending = [pageEl, idx]; return; }
    var els = Array.prototype.slice.call(pageEl.querySelectorAll(CUE_SEL));
    for (var i = 0; i < els.length; i++) els[i].classList.remove("on");
    var c = CUES && CUES.pages ? CUES.pages[idx] : null;
    var dur = c ? c.dur : 30;
    /* 元素浮现不再按「页时长的百分比」均摊，而是挂到本页的句子节拍上：
       第 k 个元素跟着第 k 句开口走（多出来的元素在同一句内 0.45s 依次错开），
       这样画面浮现和口播的段落大体同步，但不需要逐句手工标注。*/
    var S = [], all = (CUES && CUES.sentences) || [], q2;
    for (q2 = 0; q2 < all.length; q2++) if (all[q2].page === idx + 1) S.push(all[q2].start - (c ? c.start : 0));
    S.sort(function (a, b) { return a - b; });
    var used = {}, cnt = {}, j0, s0;
    for (j0 = 0; j0 < els.length; j0++) { s0 = Math.min(j0, S.length - 1); cnt[s0] = (cnt[s0] || 0) + 1; }
    for (var j = 0; j < els.length; j++) {
      var si = Math.min(j, S.length - 1);
      var base = S.length ? S[si] : 0.4 + j * (dur * 0.55) / Math.max(1, els.length - 1);
      var k = used[si] || 0; used[si] = k + 1;
      /* 同一句里的第 k 个元素 0.45s 依次错开；若会挤出本页（句子少的页元素更密），
         把错开量压进本页剩余时间，保证翻页前都露过面 */
      var room = Math.max(0, dur - 0.8 - base);
      var stag = (S.length && cnt[si] > 1) ? Math.min(0.45, room / (cnt[si] - 1)) : 0;
      var tt = Math.max(0.25, base + 0.18 + k * stag);
      (function (el, sec) { cueTimers.push(setTimeout(function () { el.classList.add("on"); }, sec * 1000)); })(els[j], tt);
    }
    /* 翻页由 __startCue 的绝对时间表驱动 */
  }
  if (cueOn) document.body.classList.add("cue");
  /* 自动翻页改成「绝对时间表 + 轮询」：每页该在 CUES.pages[i].start - LEAD 秒切到，
     不再用上一页 setTimeout(dur+0.3) 串起来 —— 后者在渲染卡顿时会逐页累积延迟（实测 3 页差出 25s）。*/
  var CUE_LEAD = 0.55, cueT0 = 0, cueTick = null;
  window.__startCue = function () {
    cueStarted = true; if (window.__startBgm) window.__startBgm();
    cueT0 = performance.now();
    if (cuePending) { var q = cuePending; cuePending = null; cuePlay(q[0], q[1]); }
    if (!cueAuto || !CUES || !CUES.pages) return;
    var P = CUES.pages, last = P[P.length - 1];
    cueTick = setInterval(function () {
      var t = (performance.now() - cueT0) / 1000, k = 0, i;
      for (i = 0; i < P.length; i++) if (t >= P[i].start - CUE_LEAD) k = i;
      if (k !== cur) go(k);
      if (t >= last.start + last.dur - 3.2) { clearInterval(cueTick); cueTick = null; if (cur === PAGES.length - 1) pullCurtain(); }   // 提前 3.2s 落幕：沉海要 2.6s，不能等排程走完才拉绳
    }, 80);
  };

  /* ---------- 导航 ---------- */
  var cur = 0, zoomFig = null;
  function paint() {
    secs.forEach(function (s, i) { s.classList.toggle("active", i === cur); });
    var p = PAGES[cur];
    $("#idx").textContent = String(cur + 1).padStart(2, "0") + " / " + String(PAGES.length).padStart(2, "0");
    $("#cap").textContent = p.cap;
    $("#prog").firstElementChild.style.width = ((cur + 1) / PAGES.length * 100) + "%";
    document.documentElement.style.setProperty("--acc", p.acc);
    document.documentElement.style.setProperty("--slash", SLASH_RED ? "var(--red)" : p.acc);
    mountVideos(secs[cur]);
    cuePlay(secs[cur], cur);
  }
  function go(n) {
    n = Math.max(0, Math.min(PAGES.length - 1, n));
    if (n === cur) return;
    doWipe();
    cur = n; paint();
  }
  function next() { if (cur === PAGES.length - 1) { pullCurtain(); return; } go(cur + 1); }
  function prev() { go(cur - 1); }
  function doWipe() { wipe.classList.remove("go"); void wipe.offsetWidth; wipe.classList.add("go"); }

  /* ---------- 视频槽：<video> 由 vslot() 渲染，这里只管当前页播放、离开页暂停 ---------- */
  function mountVideos(pageEl) {
    Array.prototype.forEach.call(document.querySelectorAll("#stage [data-clip] video"), function (v) {
      if (v.closest(".page") === pageEl) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
      else v.pause();
    });
  }

  function toggleClean() { document.body.classList.toggle("clean"); }
  function toggleZoom() {
    if (zoomFig) { zoomFig.remove(); document.body.classList.remove("zoomlock"); zoomFig = null; return; }
    var page = secs[cur];
    zoomFig = document.createElement("figure");
    zoomFig.className = "zoom";
    zoomFig.style.setProperty("--acc", PAGES[cur].acc);
    zoomFig.innerHTML = page.innerHTML;
    stage.appendChild(zoomFig);
    document.body.classList.add("zoomlock");
  }

  /* ---------- 落幕（末页）：先上浮一下 → 加速坠入 → 黑潮自下而上吞没 → 全黑 ---------- */
  var curtainOn = false, seaTimers = [];
  function seaLater(fn, ms) { seaTimers.push(setTimeout(fn, ms)); }
  function pullCurtain() {
    if (curtainOn) return;
    curtainOn = true;
    var s = $("#sea"); if (s) s.classList.add("on");
    var st = $("#stage");
    var h = $("#seaHint");
    if (h) { h.textContent = "Esc / ← 复位可重录"; h.style.opacity = ".6"; }
    if (st) st.classList.add("sinking");
    seaLater(function () { if (s) s.classList.add("deep"); }, 80);
    seaLater(function () { if (s) s.classList.add("black"); }, 750);
  }
  function resetCurtain() {
    curtainOn = false;
    for (var i = 0; i < seaTimers.length; i++) clearTimeout(seaTimers[i]);
    seaTimers = [];
    var s = $("#sea");
    if (s) s.className = "";
    var st = $("#stage"); if (st) st.classList.remove("sinking");
    var h = $("#seaHint");
    if (h) { h.textContent = "CLICK / → · 沉入水中"; h.style.opacity = ".8"; }
  }

  /* ---------- 键位 ---------- */
  /* ---------- 配乐（assets/bgm.m4a）：M 键或 ♪ 按钮开关；?auto=1 时自动起播 ---------- */
  var bgm = document.getElementById("bgm"), bgmOn = false;
  function bgmToggle() {
    if (!bgm) return;
    if (bgm.paused) { bgm.volume = 0.35; bgm.play().catch(function () {}); bgmOn = true; }
    else { bgm.pause(); bgmOn = false; }
    var b = document.getElementById("mbtn");
    if (b) { b.title = bgmOn ? "配乐：开（M 关闭）" : "配乐：关（M 开启）"; b.style.color = bgmOn ? "var(--acc)" : ""; }
  }
  var mbtnEl = document.getElementById("mbtn");
  if (mbtnEl) mbtnEl.addEventListener("click", function (e) { e.stopPropagation(); bgmToggle(); });
  window.__startBgm = function () { if (!bgm) return; bgm.volume = 0.35; bgm.currentTime = 0; bgm.play().catch(function () {}); };
  if (/[?&]auto=1/.test(location.search) && !/[?&]wait=1/.test(location.search) && bgm) window.__startBgm();

  document.addEventListener("keydown", function (e) {
    if (curtainOn) { if (e.key === "Escape" || e.key === "ArrowLeft") { resetCurtain(); } return; }
    var k = e.key;
    if (k === "ArrowRight" || k === " " || k === "PageDown") { e.preventDefault(); next(); }
    else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); prev(); }
    else if (k === "Home") { go(0); }
    else if (k === "End") { go(PAGES.length - 1); }
    else if (k === "f" || k === "F") { toggleClean(); }
    else if (k === "p" || k === "P") { toggleZoom(); }
    else if (k === "m" || k === "M") { bgmToggle(); }
    else if (k === "Escape") { if (zoomFig) toggleZoom(); }
    else if (/^[0-9]$/.test(k)) {
      var idx = k === "0" ? null : (parseInt(k, 10) - 1);
      if (idx != null && PAGES[idx]) go(idx);
    }
  });
  document.addEventListener("click", function (e) {
    if (curtainOn) { if (document.body.classList.contains("clean")) resetCurtain(); return; }
    if (e.target.closest("#hud") || e.target.closest(".code")) return;
    if (zoomFig) { toggleZoom(); return; }
    next();
  });

  var SLASH_RED = /[?&]slash=red/.test(location.search);
  if (/[?&]clean=1/.test(location.search)) document.body.classList.add("clean");
  if (/[?&]end=1/.test(location.search)) { setTimeout(function () { go(NPAGE - 1); setTimeout(pullCurtain, 1500); }, 600); }
  // ?anim=0 关掉全部入场动效：layout.mjs 量的是终态，动画中途量会把底边量小
  if (/[?&]anim=0/.test(location.search)) document.body.classList.add("noanim");

  paint();
  console.log("[arena-video] pages=" + PAGES.length + " full=" + (FULL ? "yes" : "no") + " legacy=" + (LG.land ? "yes" : "no") + " diag8=" + (DG ? DG.turns.length + "点" : "no"));
})();
