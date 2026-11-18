/* arena-effthink 分镜渲染 + 交互（浅色版 · 17 页）
 * 原则：画面是口播的配图。每页一个主视觉，屏幕字集中在 .screen 里，check.mjs 按它断言字符预算。
 * 数据只读三件：__DATA__.compare（唯一读数源）、.iters（加时台账 CSV）、.itersStats（台账复算计数）。
 *   分数三场比赛尺度不同，永不横向相加；合计只允许同单位的量（token / 请求数 / 分钟）。
 * 交互沿用 llm-html2video 约定：F 纯净屏（不走浏览器全屏）、P 内容块假全屏、拉绳落幕。
 */
(function () {
  "use strict";
  var D = window.__DATA__ || {};
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
  /* ---------- 新片读数层：只读 D.compare / D.iters / D.itersStats ---------- */
  // 画面与逐字稿允许出现的数字都出自这三件；data/prev-round-q5kxl/ 是上一轮的表，禁止拿来补数
  var C = D.compare || {};
  var IT = D.iters || [];
  var IS = D.itersStats || {};
  var MD = C.models || {}, SK = C.scores || {}, BH = C.behavior || {}, OT = C.overtime || {};
  var PR = C.peers || {}, RC = C.reproducibility || {}, MV = C.media || {}, RD = C._rounds || {};
  var WS = ((C.behavior || {}).windowSplit || {}).perEp || {}, SC = C.scaleNotes || {}, CW = C.contextWindow || {};
  var PREV = MD["prev-q5kxl"] || {}, CUR = MD["cur-q4"] || {}, Q3 = MD["cur-q3-not-entered"] || {};

  function brow(ep, round) {
    var rows = BH.rows || [];
    for (var i = 0; i < rows.length; i++) { if (rows[i].ep === ep && rows[i].round === round) return rows[i]; }
    return {};
  }
  // 时间占比那一栏每项是 {prev:[分钟, 占比], cur:[分钟, 占比]}
  function catOf(ep, name) { return ((BH.categoryShiftMinutesPct || {})[ep] || {})[name] || { prev: [], cur: [] }; }
  function catv(ep, name, round, i) { var o = catOf(ep, name); return (o[round] || [])[i]; }
  function ls5(ep) { return (BH.longStepsOver5min || {})[ep] || {}; }
  // 「最长一步」光给分钟数观众读不懂，必须写清那一步在干什么（数据件 longestSteps 两边各一条）
  function longStepNote(ep) {
    var o = (BH.longestSteps || {})[ep] || {}, a = o.prev || {}, b = o.cur || {};
    if (!b.act || !a.act) return "";
    return "最长那一步在干什么：" + CR + " 是「" + b.act + "」，" + fmt1(b.min) + " 分钟、一次输出 " + fmt(b.out) +
      " tok；" + Q5 + " 是「" + a.act + "」，" + fmt1(a.min) + " 分钟、一次输出 " + fmt(a.out) + " tok。";
  }
  // 净工作时间：六场取的都是同一个字段，两次同口径，必须注明含加时段
  function minBasisNote(ep) {
    var a = brow(ep, "prev") || {}, b = brow(ep, "cur") || {}, mb = BH.minBasis || {};
    if (b.effectiveMin == null) return "";
    return "净工作时间两次同口径：各步耗时求和、不含等待与停机" + (mb.includesOvertime ? "，两边都含 40 分钟加时段里的模型步" : "") +
      " —— 这里比的是 " + fmt1(b.effectiveMin) + " 对 " + fmt1(a.effectiveMin) + " 分钟。";
  }
  // 两轮之差：正值读「涨」，负值读「省」，方向由页面文字说明
  function chg(a, b) { return (!a || b == null) ? null : (b / a - 1) * 100; }
  function pcx(v) { return (v == null || isNaN(v)) ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + "%"; }
  function signed(d, unit) {
    var v = Math.round(Number(d) * 100) / 100;
    if (!isFinite(v)) return "—";
    return v === 0 ? "0" : (v > 0 ? "+" : "−") + Math.abs(v) + (unit || "");
  }
  function iterOf(ep) { return IT.filter(function (r) { return r.ep === ep; }); }
  function iterRound(ep, round, win) {
    var a = iterOf(ep).filter(function (r) { return r.round === round && (!win || r.window.indexOf(win) === 0); });
    return a[0] || {};
  }
  // 三场比赛合计只加同单位的东西（token / 请求数 / 分钟）；分数尺度不同，永不加总
  function bsum(round, field) {
    var s = 0;
    (BH.rows || []).forEach(function (r) { if (r.round === round && typeof r[field] === "number") s += r[field]; });
    return s;
  }
  // 长文本进表格前先掐长度：宁可标省略号，也不让一行字画出 viewBox
  function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; }
  // reproducibility 那几段是 markdown 文本，星号进画面就是噪声（本文件按约定不出现反引号字符）
  function md(s) { return String(s == null ? "" : s).replace(/\*+/g, ""); }
  // 数据件里「本轮 / 上一轮」是审计措辞；观众没看过前一次，画面上只认得两个模型名
  function rnd(t) {
    return String(t == null ? "" : t).replace(/本轮唯一一次/g, "这场比赛唯一一次").replace(/本轮/g, CR + " 这次")
      .replace(/上一轮/g, Q5 + " 那次").replace(/这一轮/g, "这两次");
  }

  // 本机画两根（正赛交卷版 / 加时终版），对手画榜上那一次并把两次之差写在条尾。
  // 排序键统一用正赛那一次，否则本机两根会被对手插开。

  /* ---------- 台账表：列一律来自 iterations.csv ---------- */
  function ledger(ep, o) {
    o = o || {};
    var rows = o.rows || iterOf(ep);
    var body = rows.map(function (r) {
      var vd = String(r.verdict || "");
      var vdCell = vd === "KEEP" ? '<td style="color:var(--good);font-weight:700">留下</td>'
        : (vd === "ROLL BACK" ? '<td style="color:var(--red);font-weight:700">撤回</td>'
          : "<td>" + esc(vd === "N/A" ? "—" : vd) + "</td>");
      return "<tr><td>" + esc(r.round) + "</td><td>" + esc(r.change) +
        (r.params && r.params !== "-" ? '<span class="note"> · ' + esc(clip(r.params, 40)) + "</span>" : "") +
        '</td><td class="num">' + esc(r.reading_short) + "</td>" + vdCell + "</tr>";
    }).join("");
    return '<div class="fig tablepanel"><table style="max-width:' + (o.w || 78) + 'vw' + (o.grow ? ";height:100%" : "") + '">' +
      "<thead><tr><th>轮次</th><th>改动 · 参数</th>" +
      '<th style="text-align:right">自战读数</th><th>判定</th></tr></thead><tbody>' + body + "</tbody></table></div>";
  }
  // 同单位对照表：不同量纲的数从不画进同一根坐标轴
  function statTable(o) {
    var th = "<th>" + esc(o.head || "指标") + "</th>" + (o.cols || []).map(function (c) {
      return '<th style="text-align:right">' + esc(c) + "</th>";
    }).join("");
    var rowHtml = function (r) {
      return "<tr><td>" + esc(r.k) + "</td>" + r.cells.map(function (v) {
        var txt = (v && v.v != null) ? v.v : v;
        var st = (v && v.style) ? ' style="' + v.style + '"' : "";
        return '<td class="num"' + st + ">" + esc(txt) + "</td>";
      }).join("") + "</tr>";
    };
    var body = o.rows.map(rowHtml).join("");
    var one = function (b) {
      var st = o.split ? "width:100%;height:100%" : 'max-width:' + (o.w || 62) + 'vw' + (o.grow ? ";height:100%" : "");
      return '<table style="' + st + '">' +
        "<thead><tr>" + th + "</tr></thead><tbody>" + b + "</tbody></table>";
    };
    // 八档 + 总分 + 故障局 + 每请求输出 = 11 行，单栏的自然高会撑破 .fig（表格的 height:100% 只是下限）
    if (o.split) {
      var h = Math.ceil(o.rows.length / 2);
      return '<div class="fig tablepanel stattab two">' + one(o.rows.slice(0, h).map(rowHtml).join("")) +
        one(o.rows.slice(h).map(rowHtml).join("")) + "</div>";
    }
    return '<div class="fig tablepanel stattab">' + one(body) + "</div>";
  }
  // 加时收尾章：写在页面右下，不再单开一页重复数字
  function stamp(from, to, unit, note) {
    var same = Math.abs(to - from) < 1e-9;
    var d = to - from;
    return '<div class="card hot"><div class="tag">加 时 收 尾</div>' +
      '<div class="big" style="font-size:5vh">' + sc(from) + " → " + sc(to) +
      (unit ? '<span class="u">' + esc(unit) + "</span>" : "") + "</div>" +
      "<p>" + (same ? "代码未改动，同一份不必重跑" : (d > 0 ? "涨 " : "跌 ") + sc(Math.abs(d)) + " 分") +
      (note ? " · " + esc(note) : "") + "</p></div>";
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
      needOut = Math.max(needOut, 12 + (r.ava ? 44 : 0) + nw0 + 10 + tagw0 + 10);
    });
    if (needOut > padR) padR = needOut;
    var W = o.w || VW, x0 = padL, x1 = W - padR;
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
      out += LN(zero, top - 16, zero, bottom, "gl zero") + T(zero + 8, Math.max(26, top - 22), zlab, "ax", 21);
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
        ' opacity="' + (r.hot || r.strong ? 1 : r.dim ? 0.42 : 0.85) + '" ' + d);
      var note = r.note == null ? sc(v) : r.note;
      var av = r.ava || "", gapA = av ? 44 : 0;
      if (av) {
        var ix = v >= 0 ? bx + bw + 6 : zero + 6;
        out += '<image href="' + av + '" x="' + ix.toFixed(1) + '" y="' + (y + rh / 2 - 17).toFixed(1) +
          '" width="34" height="34" clip-path="url(#' + cid + ')" class="ain" style="--i:' + i + '"/>';
        // 描边框只对两个本机模型画：实线 = Coder390，虚线 = Q5_K_XL
        if (r.frame) out += '<circle cx="' + (ix + 17).toFixed(1) + '" cy="' + (y + rh / 2).toFixed(1) + '" r="19" fill="none" stroke="' + r.frame +
          '" stroke-width="3"' + (r.dash ? ' stroke-dasharray="7 5"' : "") + ' class="ain" style="--i:' + i + '"/>';
      }
      // 长条的数值写在条头右侧会画出 viewBox（第 7 页的「基准 606」就被裁成「基准 6」）；放不下就挪进条内
      var nw = txtW(note, fv);
      var outside = (v >= 0 ? bx + bw + 12 + gapA : zero + 12 + gapA) + nw;
      if (v >= 0 && outside > W - 16) {
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
    // 参考线画在柱之上：柱压过它 = 高于基准，柱停在它左边 = 低于基准；标签放线下方，放顶部会压住标题
    if (o.ref != null) {
      var rx = X(o.ref);
      out += LN(rx, top - 16, rx, bottom, "gl thr") + T(rx + 8, bottom + 16, o.refLabel || "基准", "ax acc", 25);
    }
    return svg(out, bottom + 24 + (o.ref != null ? 14 : 0), W);
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
  /* 图页专用数字条：内容同事实卡，但压成一行，把竖向空间让给柱子 */
  function strip(items) {
    return '<div class="nstrip">' + items.map(function (it) {
      return '<span class="ns"><b>' + esc(it.k) + "</b><i>" + it.v + "</i>" + (it.n ? "<u>" + esc(it.n) + "</u>" : "") + "</span>";
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
  function vslot(key, label, note, variant) {
    var src = (window.__CLIPS__ || {})[key];
    var face = src
      ? '<video class="vclip" src="' + esc(src) + '" muted loop playsinline preload="auto"></video>'
      : '<span class="rec">REC</span><span class="want">待录屏</span>';
    var side = variant === "side", fill = variant === "fill";
    return '<figure class="vwrap' + (side ? " side" : "") + (fill ? " fill" : "") + '"' + (side || fill ? "" : ' style="flex:1"') + ' data-clip="' + esc(key) + '">' +
      '<div class="vslot' + (side ? " side" : "") + (fill ? " fill" : "") + (src ? " hasclip" : "") + '">' + face + "</div>" +
      '<figcaption class="vcap"><b>' + esc(label) + '</b>' + (note ? "<span>" + esc(note) + "</span>" : "") + "</figcaption></figure>";
  }
  /* ---------- 显示名 · 外壳 · 成绩表 · 哑铃图 ---------- */
  // 全片不用「上一轮 / 这一轮」指代：观众没看过前一次，一律用两个模型的名字
  var Q5 = "Q5_K_XL", CR = "Coder390";
  var EPNM = { land: "圈地", bomberman: "炸弹人", ctf: "夺旗" };
  var LANDN = {
    "sonnet-5@claude-code": "Sonnet 5.5", "opus-5.5@claude-code": "Opus 5.5",
    "gpt-6-astra@codex": "GPT-6 Astra", "gpt-6-sol@codex": "GPT-6 Sol",
    "mimo-2.6-pro@zcode": "MiMo V2.6 Pro", "kimi-k3@workbuddy": "Kimi K3",
    "glm-5.3@workbuddy": "GLM 5.3", "deepseek-4.1f@workbuddy": "DeepSeek V4.1 Flash",
    "mystery-model@zcode": "神秘模型",
  };
  function isMe(n) { return /your-bot|你的 bot/.test(n); }
  function dispOf(ep, n) { return isMe(n) ? CR : (ep === "land" ? (LANDN[n] || n) : n); }
  // CONDITIONS.md 里的工具列带版本与渠道，进表格前先削成短名
  function toolShort(t) {
    if (!t) return "—";
    var s = String(t).split("·")[0].replace(/（[^）]*）/g, "");
    s = s.replace(/\s*(桌面版|命令行|标准模式|极简模式|通行证|官方接口)[\s\d.-]*$/, "");
    s = s.replace(/\s*\d[\w.]*(-[\w.]+)*\s*$/, "");
    return s.trim() || String(t);
  }
  // 思考档只有一格宽，长措辞上屏会折行；数据件保留原文，画面这里给短形式
  // 成绩柱必须说清尺度：炸弹人/夺旗是对数构造，圈地是线性归一，不能让观众按「分差」读实力差
  function scaleNote(ep, who) {
    var o = SC[ep] || {};
    if (!o.kind) return "";
    var s = o.log
      ? ("这场比赛是对数尺度：" + o.perK + "，每 100 分 ≈ " + fmt2(o.per100) + " 倍")
      : "这场比赛是线性 0–100（不是对数）：每模式 greedy = 0、该模式最强 = 100";
    /* 横比页三场比赛尺度写在同一行，「这场比赛」指代不清，那里要点名 */
    return who ? s.replace("这场比赛是", who + "是") : s;
  }
  // 净工作那根柱拆两段：正赛窗口 + 加时窗口，两段相加 = 该场 effectiveMin
  function stk(ep) {
    var o = WS[ep] || {}, a = o.prev || {}, b = o.cur || {};
    return { k: "净工作 分", unit: " 分", stack: { a: [a.main, a.overtime], b: [b.main, b.overtime] } };
  }
  function kw(n) { return (n == null || isNaN(n)) ? "—" : Math.round(Number(n) / 1000) + "k"; }
  function effShort(t) { return String(t == null ? "" : t).replace("各家官方推荐档", "平台默认档"); }
  function avImg(name) {
    var u = avaOf(name);
    return u ? '<img class="av" src="' + u + '" alt="">' : '<span class="av ph"></span>';
  }
  /* 成绩表（10-10 口径）：云端对手只有一列 = 它两次评测成绩的算术平均，当「对手池」看；
     Coder390 与 Q5_K_XL 各占一行，取各自那一次的原值，不参与平均。 */
  function peerTable(ep, o) {
    o = o || {};
    var rows = (PR[ep] || {}).table || [];
    var body = rows.map(function (r) {
      var who = r.who, cls = who === "me" ? " class=\"me\"" : (who === "q5" ? ' class="q5r"' : (who === "anchor" ? ' class="dimr"' : ""));
      var nm = who === "me" ? CR : (who === "q5" ? Q5 : dispOf(ep, r.name).replace("anchor-", "锚点 · "));
      return "<tr" + cls + "><td>" + avImg(who === "me" ? CR : (who === "q5" ? Q5 : nm)) + esc(nm) +
        (r.rank ? '<span class="rk">' + esc(r.rank) + "</span>" : "") + "</td>" +
        "<td>" + esc(toolShort(r.tool)) + "</td><td>" + esc(effShort(r.effort)) + "</td>" +
        '<td class="num">' + sc(r.score) + "</td></tr>";
    }).join("");
    return '<div class="fig tablepanel scoretab onecol' + (rows.length > 11 ? " tall" : "") + '"><table style="width:100%;height:100%">' +
      "<thead><tr><th>选手</th><th>外壳</th><th>思考档</th>" +
      '<th style="text-align:right">' + esc(o.head || "总分（两次平均）") + "</th></tr></thead><tbody>" + body + "</tbody></table>" +
      (o.foot ? '<p class="note">' + esc(o.foot) + "</p>" : "") + "</div>";
  }
  /* 同一份数据的柱版：对手池一列平均 + 本机四根（两次各自的交卷版与加时终版），全部带头像 */
  function chartBars(ep, o) {
    o = o || {};
    // 交卷成绩柱只放正赛那一次：加时终版是后面几页的事，混进来等于提前剧透另一阶段的成绩
    var src = ((PR[ep] || {}).chart || []);
    if (o.noOt) src = src.filter(function (r) { return !/加时/.test(String(r.name)); });
    var rows = src.map(function (r, i) {
      var me = r.who === "me", q5 = r.who === "q5", anch = r.who === "anchor";
      var ot = /加时/.test(String(r.name));
      var nm = me || q5 ? r.name : dispOf(ep, r.name).replace("anchor-", "锚点 · ");
      return {
        label: nm, value: r.score, ava: avaOf(me ? CR : (q5 ? Q5 : nm)),
        frame: me ? "var(--acc)" : (q5 ? "var(--q5)" : null), dash: q5,
        sortV: r.score, grp: me || q5 ? i : 0,
        // 四根本机柱四种填色：主题色/红 = Coder390 的交卷与加时，白/水青 = Q5_K_XL 的交卷与加时
        color: me ? (ot ? "var(--me-ot)" : (o.meColor || "var(--acc)")) : (q5 ? (ot ? "var(--q5ot)" : "var(--q5)") : "var(--peer)"),
        hot: me, strong: q5, dim: anch,
        tag: r.rank ? "当时 " + r.rank : null
      };
    });
    // 柱长必须单调：同一模型的两根可能被打散，靠「框色认模型、冷暖认窗口」而不是靠相邻
    rows.sort(function (a, b) {
      var d = (Number(b.sortV) || 0) - (Number(a.sortV) || 0);
      return d !== 0 ? d : (a.grp || 0) - (b.grp || 0);
    });
    return hbars(rows, { labelW: o.labelW || 250, rh: o.rh || 24, gap: o.gap || 6, fs: o.fs || 18,
      zero: o.zero, zeroLabel: o.zeroLabel || "基准 0", padR: o.padR || 190, w: o.w }) +
      (o.foot ? '<p class="note">' + esc(o.foot) + "</p>" : "");
  }
  /* 双柱对照：一行一个指标、行内同一刻度，上柱 Q5_K_XL、下柱 Coder390。
     不做「每行各自 min→max」的哑铃图 —— 那样两点永远钉在轨道两端，
     谁左谁右会随数值互换，模型归属反而要观众自己猜（第一版就是这么错的）。 */
  function pairBars(rows, o) {
    o = o || {};
    var padL = o.labelW || 250, padR = o.padR || 130, top = o.top || 64;
    var rh = o.rh || 15, gap = o.gap || 5, bgap = o.blockGap || 24, fs = o.fs || 20;
    var needOut = 0;
    rows.forEach(function (r) {
      var sa = r.stack ? r.stack.a : [r.a, 0], sb = r.stack ? r.stack.b : [r.b, 0];
      var u = r.unit || "", n = r.note != null ? String(r.note) : pcx(chg(sa[0] + sa[1], sb[0] + sb[1]));
      var nw = (!n || n === "—") ? 0 : txtW(n, 20) + 30;
      [sa, sb].forEach(function (seg) {
        var t = seg[0] + seg[1];
        var lab = r.stack ? (sc(seg[0]) + "+" + sc(seg[1]) + " = " + sc(t) + u) : (sc(t) + u);
        needOut = Math.max(needOut, 11 + txtW(lab, 18) + nw + 12);
      });
    });
    if (needOut > padR) padR = needOut;
    var W = o.w || VW, x0 = padL, x1 = W - padR, out = "", y = top;
    // 图例直接放两张头像：虚线框 = Q5_K_XL，实线框 = Coder390
    CLIPN++; var lc = "avac" + CLIPN, hc = "hatch" + CLIPN;
    var avP = avaOf(Q5), avC = avaOf(CR);
    var hasStack = rows.some(function (r) { return !!r.stack; });
    out = '<defs><clipPath id="' + lc + '" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath>' +
      (hasStack ? '<pattern id="' + hc + '" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
        '<line x1="0" y1="0" x2="0" y2="8" stroke="rgba(10,16,48,.62)" stroke-width="3.4"/></pattern>' : "") + "</defs>";
    out += avP ? '<image href="' + avP + '" x="' + x0 + '" y="' + (top - 46) + '" width="26" height="26" clip-path="url(#' + lc + ')"/>' +
      '<circle cx="' + (x0 + 13) + '" cy="' + (top - 33) + '" r="15" fill="none" stroke="var(--q5)" stroke-width="2.5" stroke-dasharray="6 4"/>' : '<circle cx="' + (x0 + 9) + '" cy="' + (top - 32) + '" r="9" fill="var(--q5)"/>';
    out += T(x0 + 36, top - 24, Q5, "ax", 23);
    out += avC ? '<image href="' + avC + '" x="' + (x0 + 210) + '" y="' + (top - 46) + '" width="26" height="26" clip-path="url(#' + lc + ')"/>' +
      '<circle cx="' + (x0 + 223) + '" cy="' + (top - 33) + '" r="15" fill="none" stroke="var(--acc)" stroke-width="2.5"/>' : '<circle cx="' + (x0 + 219) + '" cy="' + (top - 32) + '" r="9" fill="var(--acc)"/>';
    out += T(x0 + 250, top - 24, CR, "ax", 23);
    if (o.segNote) {
      out += R(W - 300, top - 44, 13, 13, "var(--warn)", "") +
        (hasStack ? R(VW - 300, top - 44, 13, 13, "url(#" + hc + ")", "") : "") +
        T(W - 281, top - 29, o.segNote, "ann", 21);
    }
    rows.forEach(function (r, i) {
      // r.stack = {a:[正赛,加时], b:[正赛,加时]}：一根柱拆两段接起来，暖色那段是 40 分钟加时窗口
      var sa = r.stack ? r.stack.a : [r.a, 0], sb = r.stack ? r.stack.b : [r.b, 0];
      var ta = sa[0] + sa[1], tb = sb[0] + sb[1];
      var lo = Math.min(0, ta, tb), hi = Math.max(0, ta, tb);
      if (hi - lo < 1e-9) hi = lo + 1e-9;
      var X = function (v) { return x0 + ((Number(v) || 0) - lo) / (hi - lo) * (x1 - x0); };
      var zx = X(0), u = r.unit || "";
      // 从各自的零线起画：负值往左，柱长仍是绝对值，但不会把负分读成高分
      var segs = function (arr, y0, base) {
        var acc = 0;
        arr.forEach(function (v, j) {
          v = Number(v) || 0; if (!v) return;
          var a = X(acc), b = X(acc + v);
          var bx = Math.min(a, b), bw = Math.abs(b - a);
          out += R(bx, y0, bw, rh, j ? "var(--warn)" : base, "bar",
            ' opacity="' + (j ? 0.95 : base === "var(--q5)" ? 0.92 : 1) + '" style="--i:' + i + ';transform-origin:left center"');
          // 炸弹人那页的主题色本身就是琥珀，暖色段会和正赛段撞色，再叠一层斜纹
          if (j && hasStack) out += R(bx, y0, bw, rh, "url(#" + hc + ")", "bar", ' style="--i:' + i + ';transform-origin:left center"');
          acc += v;
        });
      };
      if (lo < 0) out += LN(zx, y - 4, zx, y + 2 * rh + gap + 4, "gl zero");
      out += T(x0 - 14, y + rh + 7, r.k, "ax big ain", fs, "end", 'style="--i:' + i + '"');
      segs(sa, y, "var(--q5)");
      out += T((ta >= 0 ? X(ta) : zx) + 11, y + rh - 1, r.stack ? (sc(sa[0]) + "+" + sc(sa[1]) + " = " + sc(ta) + u) : (sc(ta) + u), "ax ain", 21, "start", 'style="--i:' + i + '"');
      segs(sb, y + rh + gap, "var(--acc)");
      out += T((tb >= 0 ? X(tb) : zx) + 11, y + 2 * rh + gap - 1, r.stack ? (sc(sb[0]) + "+" + sc(sb[1]) + " = " + sc(tb) + u) : (sc(tb) + u), "vlab ain acc", 21, "start", 'style="--i:' + i + '"');
      if (ta) out += T(W - 8, y + rh + 7, r.note != null ? r.note : pcx(chg(ta, tb)), "ann ain", 23, "end", 'style="--i:' + i + '"');
      y += 2 * rh + gap + bgap;
    });
    var foot = y - (bgap - rh) + 6;
    // 每行按本行最大值满格：这句话得写在图上，否则观众会拿第二行的柱长去比第一行
    if (o.rowNote) { out += T(padL, foot + 19, o.rowNote, "ann", 19); foot += 30; }
    return svg(out, foot, W);
  }

  /* ---------- 第 1—3 页 · 封面 / 规格 / 三场比赛 ---------- */
  function p01() {
    var card = function (m, tag, isCur) {
      var sv = m.service || {};
      return '<div class="card' + (isCur ? " hot" : "") + '"><div class="tag">' + esc(tag) + "</div><h3>" + esc(m.short) + (isCur && m.quantTag ? " · " + esc(m.quantTag) : "") + "</h3>" +
        "<p>" + esc(String(isCur ? RD.cur : RD.prev).replace(/^[^·]*·\s*/, "")) + "</p>" +
        '<div class="pm' + (isCur ? " up" : "") + '"><b>规格</b>· ' + fmt1(m.paramsB) + " B · " + fmt1(m.sizeGB) + " GB · " +
        fmt1(m.bitsPerParam) + " bit/参数 · -c " + fmt(sv.ctx) + "</div></div>";
    };
    return head("本地 27B 模型测评 · arena 开源赛事", "Qwen3.8-27B <span class=\"em\">Coder390</span> 性能测评") +
      '<div class="grid g2" style="flex:1;align-content:center;align-items:stretch;gap:3.2vh">' +
      card(CUR, "被测 · 重做后训练", true) + card(PREV, "对照 · unsloth 官方原版基座量化", false) +
      "</div>" +
      '<div class="oneliner" style="margin-top:4vh">核心指标：是否在<span class="em">大幅减少思考</span>的同时，<span class="em">不损害能力</span></div>' +
      facts([
        { k: "测试项目", v: "arena 开源赛事 · 三场", n: "圈地 · 炸弹人 · 夺旗，同一份提示词" },
        { k: "同一台机器", v: "2 × 5060 Ti", n: "同一套 agent 外壳与预设", hot: true },
        { k: "对局量", v: fmt(((SK.land || {}).games || 0) + ((SK.bomberman || {}).games || 0) + ((SK.ctf || {}).games || 0)) + " 局", n: "两个模型各跑一遍三场比赛" }
      ]) +
      screen(["核心指标：减少思考，不损害能力", "Q5_K_XL ↔ Q4LynnStyle"]);
  }
  function p02() {
    var hc = C.harness || {}, AS = C.avgSpeed || {}, cb = AS.combined || {}, pe = AS.perEp || {};
    var th = hc.three || [];
    var trio = function (k) { return ["land", "bomberman", "ctf"].map(function (e) { return fmt1((pe[e] || {})[k]); }).join(" · "); };
    return head("两件武器 · 规格", "参数量<span class=\"em\">一模一样</span>，差的是量化档") +
      hbars([
        { label: Q5, value: PREV.sizeGB, note: fmt1(PREV.sizeGB) + " GB", color: "var(--peer)", ava: avaOf(Q5), frame: "var(--peer)", dash: true },
        { label: CR + " · " + CUR.quantTag, value: CUR.sizeGB, note: fmt1(CUR.sizeGB) + " GB", color: "var(--acc)", hot: true, ava: avaOf(CR), frame: "var(--acc)" }
      ], { labelW: 340, rh: 52, gap: 20, fs: 23, padR: 200 }) +
      '<p class="mini">这两根柱是线性刻度：柱长 = 文件大小本身（GB）。成绩柱的尺度写在每场页的脚注里。</p>' +
      facts([
        { k: "平均比特数", v: fmt1(CUR.bitsPerParam) + " / " + fmt1(PREV.bitsPerParam), n: CR + " / " + Q5 + " · bit 每参数，标称差 1 档实差 " + fmt2(PREV.bitsPerParam - CUR.bitsPerParam) },
        { k: "平均生成速度", v: CR + " " + fmt1(cb.cur) + " · " + Q5 + " " + fmt1(cb.prev), n: "tok/s；三场各自 " + trio("cur") + " 与 " + trio("prev") + " · 同一台机器，总体差不多", hot: true },
        { k: "agent 外壳", v: th.map(function (t) { return '<span class="hi3"><b>' + esc(t.k) + "</b> " + esc(t.v) + "</span>"; }).join(""), n: "同一份提示词，换的只有权重文件" },
        { k: "上下文", v: kw(CW.serviceMax) + " 最大 · " + kw(CW.usable) + " 可用", n: "外壳压缩阈值 " + kw(CW.compactionWindow) + " − 预留 " + kw(CW.reserve) + " = 可用 " + kw(CW.usable) + " · 两个模型同一档" }
      ]) +
      screen(["27.321B · 866 张量 · 65 层", "体积差 = 量化档差"]);
  }
  function fmt2(n) { return (n == null || isNaN(n)) ? "—" : Number(n).toFixed(2); }
  function p03() {
    var L = SK.land || {}, B = SK.bomberman || {}, F = SK.ctf || {}, V = C.volume || {}, vl = V.land || {}, vb = V.bomberman || {}, vf = V.ctf || {};
    var det = function (n, key, rule, games, txt) {
      return '<div class="epcard detail" data-seq="' + n + '" data-beat="' + BT[n - 1] + '"><div class="tag">' + esc(rule) + "</div>" +
        "<h3>" + esc(EPNM[key]) + " · " + fmt(games) + " 局</h3><p>" + txt + "</p></div>";
    };
    // 拍号 = 触发句在本页的句序（由 script/口播稿.md 的「拍」行换算，check.mjs 会复核）
    var BT = [1, 5, 8];
    return head("三场比赛 · 同一份提示词", "先介绍<span class=\"em\">比的是什么</span>") +
      '<div class="gallery">' +
      '<div class="gstage">' +
      vslot("g-land", "圈地 · 一人一块，把别人挤出圈", "", "fill") +
      vslot("g-bomberman", "炸弹人 · 放弹、炸人、别被炸", "", "fill") +
      vslot("g-ctf", "夺旗 · 抢旗搬回本垒", "", "fill") +
      "</div>" +
      '<div class="glist">' +
      det(1, "land", "第 1 场比赛 · 圈地", L.games, "90 分钟写一个 bot：格子里从自己那一块往外扩，把别人的地盘挤出圈就算赢。" +
        "单挑 " + fmt(vl.duelGames) + " 局（每对换边两局）+ 混战 " + fmt(vl.meleeGames) + " 局；评分把不思考的贪心锚点钉在 0、该模式最强钉在 100，低于锚点记 0。") +
      det(2, "bomberman", "第 2 场比赛 · 炸弹人", B.games, "同一份提示词换一个战场：放炸弹、炸对手、别被炸死。" +
        "2 / 3 / 10 人三档各算一次实力值再等权平均，共 " + fmt(vb.games) + " 局；基准钉 0，强 10 倍记 +400。") +
      det(3, "ctf", "第 3 场比赛 · 夺旗", F.games, "抢对面的旗搬回本垒，路上会被打死、旗掉在原地可以重捡。" +
        "2 到 13 人八档等权，同一张图把座位轮一圈，共 " + fmt(vf.games) + " 局；基准同样钉 0。") +
      "</div></div>" +
      screen(["每场 90 分钟写一个 bot", "交卷后追加 40 分钟自己改代码"]);
  }


  /* ---------- 第 5—8 页 · 圈地 ---------- */
  /* 交卷成绩一页两态：口播说到「换成柱子看」时表格淡出、柱图带生长动画浮现。
     两态各带自己的 screen 条；bb 上的 data-beat 是触发句在本页的句序，cues.mjs 会复核。 */
  function p04() {
    var L = SK.land || {}, c = L.cur || {}, p = L.prev || {}, V = C.volume || {};
    return head("第 1 场比赛 · 圈地 · 交卷成绩", "同一批对手，<span class=\"em\">两个模型各占一名</span>") +
      '<div class="panes">' +
      '<div class="pane tb">' +
      '<div class="cols">' +
      '<div class="col wide">' + peerTable("land", {
        head: "总分（两次平均）",
        foot: "云端那一列 = 同一家人两次成绩的算术平均，本机两行各取自己那一次；「平台默认」= 这家在 WorkBuddy 上没手动调档。"
      }) + "</div>" +
      '<div class="col vid side31">' + vslot("land-main", "圈地 · 单挑 2 人 40×40", "1013 : 14 胜 deepseek-4.1f，11 杀 / 被切 9 次", "side") + "</div>" +
      "</div>" +
      facts([
        { k: "对局量", v: fmt(V.land.duelGames + V.land.meleeGames) + " 局", n: "单挑 " + fmt(V.land.duelGames) + " + 混战 " + fmt(V.land.meleeGames) },
        { k: "每家打多少", v: V.land.perBotDuel + " 局单挑", n: "混战 " + V.land.perBotMelee + " 局 · 每对换边两局" },
        { k: "对手池", v: "9 云端 + 3 锚点", n: "两个模型跑的是同一批 bot.cpp 源码", hot: true },
        { k: "区间", v: "bootstrap " + V.land.boot + " 次", n: "本机 " + sc(c.mainCi[0]) + " ~ " + sc(c.mainCi[1]) + " 对 " + sc((L.prev || {}).mainCi[0]) + " ~ " + sc((L.prev || {}).mainCi[1]) }
      ]) +
      screen(["0 分 = 低于 greedy 锚点，不是没得分", "两个模型跑的是同一批源码"]) +
      "</div>" +
      '<div class="pane bb" data-stage="2" data-beat="4">' +
      chartBars("land", { labelW: 305, rh: 28, gap: 8, fs: 27, meColor: "var(--land)", w: 1560, noOt: true }) +
      strip([
        { k: "交卷", v: sc(c.main), n: "95% 区间 " + sc(c.mainCi[0]) + "~" + sc(c.mainCi[1]), hot: true },
        { k: "单挑", v: sc(c.duel), n: "Elo " + c.duelElo + " · " + Q5 + " " + sc(p.duel) },
        { k: "混战", v: sc(c.melee), n: "Elo " + c.meleeElo + " · " + Q5 + " " + sc(p.melee) },
        { k: "榜上位置", v: c.rank, n: Q5 + " 那次 " + p.rank }
      ]) +
      '<p class="mini">实线框 ' + CR + '、虚线框 ' + Q5 + '，对手那一列取两次平均。' + esc(scaleNote("land")) + "</p>" +
      screen(["柱子按分数从高到低排", "认模型看头像框"]) +
      "</div>" +
      "</div>";
  }
  function p05() {
    var L = SK.land || {}, c = L.cur || {}, p = L.prev || {};
    var cs = c.duelStats || {}, ps = p.duelStats || {}, cm = c.meleeStats || {}, pm = p.meleeStats || {};
    var cb = c.baseMeleeStats || {}, pb = p.baseMeleeStats || {};
    var r = function (k, cur, prev, g, dec) {
      var d = Number((cur - prev).toFixed(dec == null ? 2 : dec));
      return { k: k, cells: [sc(cur), sc(prev), { v: signed(d), style: "color:" + ((d > 0) === !!g ? "var(--good)" : "var(--red)") }] };
    };
    return head("第 1 场比赛 · 圈地 · 两个模型同表 · 正式赛交卷成绩", "省下的思考<span class=\"em\">换来了圈地面积</span>") +
      statTable({
        head: "圈地 1128 局", cols: [CR + " · " + CUR.quantTag, Q5, "差"], w: 68, grow: true, rows: [
          { k: "总分", cells: [sc(c.main), sc(p.main), { v: signed(c.main - p.main), style: "color:var(--good)" }] },
          r("单挑分", c.duel, p.duel, true, 1), r("单挑 Elo", c.duelElo, p.duelElo, true, 0),
          r("单挑得分率 %", cs.scoreRate, ps.scoreRate, true, 1), r("单挑平均面积", cs.avgArea, ps.avgArea, true, 0),
          r("混战分", c.melee, p.melee, true, 1), r("混战 Elo", c.meleeElo, p.meleeElo, true, 0),
          r("混战平均面积", cm.avgArea, pm.avgArea, true, 0),
          r("混战第一名 %", cm.top1, pm.top1, true, 1), { k: "混战平均名次", cells: [sc(cm.avgRank), sc(pm.avgRank), { v: signed(pm.avgRank - cm.avgRank) + " 位", style: "color:var(--good)" }] }
        ]
      }) +
      facts([
        { k: "混战面积", v: fmt(cm.avgArea) + " 对锚点 " + fmt(cb.avgArea), n: Q5 + " 是 " + fmt(pm.avgArea) + " 对 " + fmt(pb.avgArea), hot: true },
        { k: "总分区间", v: sc(c.mainCi[0]) + " ~ " + sc(c.mainCi[1]), n: Q5 + " 那次 " + sc(p.mainCi[0]) + " ~ " + sc(p.mainCi[1]) + " · bootstrap 同口径" },
        { k: "同一批对手", v: "9 云端 + 3 锚点", n: "两个模型跑的是同一份 bot.cpp 源码，各取其中一次" }
      ]) +
      screen(["单挑 " + sc(p.duel) + " → " + sc(c.duel) + "，混战 " + sc(p.melee) + " → " + sc(c.melee), "本表只列正式赛交卷那一次"]);
  }
  /* 思考量与时间单独占一页：原先这张柱挤在同表页右栏，屏幕上只有 13px */
  function p05b() {
    var bc = brow("land", "cur"), bp = brow("land", "prev");
    return head("第 1 场比赛 · 圈地 · 思考量与时间", "省下来的思考时间<span class=\"em\">做了什么</span>") +
      pairBars([
        { k: "每请求输出 tok", a: bp.tokPerReq, b: bc.tokPerReq },
        { k: "最长一步 分", a: bp.maxStepMin, b: bc.maxStepMin },
        stk("land"),
        { k: "每分钟请求", a: bp.reqPerMin, b: bc.reqPerMin }
      ], { labelW: 300, rh: 32, gap: 9, blockGap: 24, fs: 27, padR: 220, top: 78, w: 1560, segNote: "暖色斜纹段 = 加时窗口",
        rowNote: "每行各自满格，柱长只在本行内可比；行尾是原值，右侧是变化；这里都是线性量，不是对数分数" }) +
      strip([
        { k: "设计与长考", v: catv("land", "设计与长考", "cur", 0) + " 分", n: Q5 + " 那次 " + catv("land", "设计与长考", "prev", 0) + " 分 · 占比 " + catv("land", "设计与长考", "prev", 1) + "%" },
        { k: "超 5 分钟长步", v: ls5("land").cur + " 次", n: Q5 + " 那次 " + ls5("land").prev + " 次 · 合计 " + ls5("land").prevMinutes + " 分" }
      ]) +
      '<p class="mini">' + esc(longStepNote("land")) + "　" + esc(minBasisNote("land")) + "</p>" +
      screen(["每请求输出 " + pcx(chg(bp.tokPerReq, bc.tokPerReq)), "最长一步 " + sc(bp.maxStepMin) + " → " + sc(bc.maxStepMin) + " 分"]);
  }

  function p06() {
    return head("第 1 场比赛 · 圈地 · 加时 40 分钟", "六次尝试：<span class=\"em\">两次留下</span>，四次撤回") +
      ledger("land", { w: 92, grow: true, rows: iterOf("land").filter(function (r) { return r.kind === "改动"; }) }) +
      '<div class="grid g2" style="align-items:stretch">' +
      '<div class="card"><div class="tag">留下那条的判据</div><p>它自战三遍都是平局（面积 716:716 / 739:739 / 785:785），' +
      "判据要的「净胜为正」没满足；它换成「打不思考的贪心锚点从 7:1 升到 11:1」作为采纳理由。</p></div>" +
      '<div class="card"><div class="tag">时间都花在哪</div><p>六次尝试里只有那条追击被写进终版，一次只换了参数，其余四次试完自己撤回。' +
      "总分只加 0.7，还落在区间里 —— 这场比赛<span class=\"em\">不算真正做到性能提升</span>。</p></div>" +
      "</div>" +
      screen(["追击 PUR=3 自战 NET = 0", "KEEP 换了判据"]);
  }
  function p07() {
    var E = "land", L = SK.land || {}, c = L.cur || {}, co = L.curOvertime || {};
    return head("第 1 场比赛 · 圈地 · 加时终版成绩", "同一张榜上，<span class=\"em\">动了 " + fmt1(co.value - c.main) + " 分</span>") +
      '<div class="cols">' +
      '<div class="col">' + chartBars("land", { labelW: 290, rh: 28, gap: 7, fs: 26, meColor: "var(--land)", w: 1180 }) + "</div>" +
      '<div class="col vid side37">' + vslot("land-ot", "圈地 · 混战 4 人 48×48", "708 格第一，只领先 27 · 对手 sonnet-5、opus-5.5、kimi-k3", "side") + "</div>" +
      "</div>" +
      strip([
        { k: "交卷 → 加时", v: sc(c.main) + " → " + sc(co.value), n: "区间 " + sc(co.ci[0]) + "~" + sc(co.ci[1]) },
        { k: "单挑", v: sc(c.duel) + " → " + sc(co.duel), n: "Elo " + c.duelElo + " → " + co.duelElo },
        { k: "混战", v: sc(c.melee) + " → " + sc(co.melee), n: "Elo " + c.meleeElo + " → " + co.meleeElo },
        { k: "同代码重跑", v: fmt((PR.land || {}).games) + " 局", n: "榜位 " + c.rank + " → " + co.rank }
      ]) +
      '<p class="mini">实线框 ' + CR + '、虚线框 ' + Q5 + '；本机两根 = 交卷版与加时终版，对手取两次平均。' + esc(scaleNote(E)) + "</p>" +
      screen(["加时只改了追击一条", "对手池两次同一批源码"]);
  }

  /* ---------- 第 8—11 页 · 炸弹人 ---------- */
  function p08() {
    var B = SK.bomberman || {}, c = B.cur || {}, p = B.prev || {}, V = C.volume || {};
    return head("第 2 场比赛 · 炸弹人 · 交卷成绩", "三个人数档等权，<span class=\"em\">第一次进前一半</span>") +
      '<div class="panes">' +
      '<div class="pane tb">' +
      '<div class="cols">' +
      '<div class="col wide">' + peerTable("bomberman", {
        head: "BT（两次平均）",
        foot: "BT：基准 0，强 10 倍 +400，不按第一名重缩放；云端那一列取两次平均。"
      }) + "</div>" +
      '<div class="col vid side31">' + vslot("bomb-main", "炸弹人 · 10 人 25×25 局 01299", "41/4 分夺冠，终场只剩自己 · 对手含 Opus 5.5、Kimi K3 等 9 家", "side") + "</div>" +
      "</div>" +
      facts([
        { k: "对局量", v: fmt(V.bomberman.games) + " 局", n: "2 人 " + V.bomberman.bySize[2] + " · 3 人 " + fmt(V.bomberman.bySize[3]) + " · 10 人 " + V.bomberman.bySize[10] },
        { k: "每家打多少", v: "490 局", n: "20 + 270 + 200 · 三档总权重相等" },
        { k: "故障局", v: String(c.faults), n: Q5 + " 那次 10 人档出过 " + (B.prev.faults || 1) + " 局", hot: true },
        { k: "赛程", v: "钉死同一份", n: "两次用的是同一张赛程表与同一批座位顺序" }
      ]) +
      screen(["BT：基准 0，强 10 倍 +400", CR + " " + sc(c.main) + " · " + Q5 + " " + sc(B.prev.main)]) +
      "</div>" +
      '<div class="pane bb" data-stage="2" data-beat="5">' +
      chartBars("bomberman", { labelW: 305, rh: 28, gap: 8, fs: 27, meColor: "var(--bomb)", w: 1560, noOt: true }) +
      strip([
        { k: "交卷 BT", v: sc(c.main), n: "11 家第 " + c.rank, hot: true },
        { k: "2 人档", v: fmt1(c.bySize[2]), n: Q5 + " 那次 " + fmt1(p.bySize[2]) },
        { k: "3 人档", v: fmt1(c.bySize[3]), n: Q5 + " 那次 " + fmt1(p.bySize[3]) },
        { k: "10 人档", v: fmt1(c.bySize[10]), n: Q5 + " 那次 " + fmt1(p.bySize[10]) }
      ]) +
      '<p class="mini">实线框 ' + CR + '、虚线框 ' + Q5 + '，对手那一列取两次平均。' + esc(scaleNote("bomberman")) + "</p>" +
      screen(["柱子按分数从高到低排", "认模型看头像框"]) +
      "</div>" +
      "</div>";
  }
  function p09() {
    var B = SK.bomberman || {}, c = B.cur || {}, p = B.prev || {};
    var bc = brow("bomberman", "cur"), bp = brow("bomberman", "prev");
    var r = function (k, cur, prev, g, dec) {
      var d = Number((cur - prev).toFixed(dec == null ? 2 : dec));
      return { k: k, cells: [sc(cur), sc(prev), { v: signed(d), style: "color:" + ((d > 0) === !!g ? "var(--good)" : "var(--red)") }] };
    };
    return head("第 2 场比赛 · 炸弹人 · 两个模型同表 · 正式赛交卷成绩", "三个人数档等权，<span class=\"em\">三档全过基准</span>") +
      statTable({
        head: "分档场均合计分", cols: [CR + " · " + CUR.quantTag, Q5, "差"], w: 68, grow: true, rows: [
          { k: "总分 BT", cells: [sc(c.main), sc(p.main), { v: signed(c.main - p.main), style: "color:var(--good)" }] },
          r("2 人档", c.bySize[2], p.bySize[2], true), r("  同档 Base", c.bySizeBase[2], p.bySizeBase[2], true),
          r("3 人档", c.bySize[3], p.bySize[3], true), r("  同档 Base", c.bySizeBase[3], p.bySizeBase[3], true),
          r("10 人档", c.bySize[10], p.bySize[10], true), r("  同档 Base", c.bySizeBase[10], p.bySizeBase[10], true),
          { k: "故障局", cells: [String(c.faults), String(p.faults || 1), { v: "0 对 1", style: "color:var(--good)" }] },
          { k: "每请求输出 tok", cells: [fmt(bc.tokPerReq), fmt(bp.tokPerReq), { v: pcx(chg(bp.tokPerReq, bc.tokPerReq)), style: "color:var(--warn)" }] }
        ]
      }) +
      facts([
        { k: "总分 BT", v: sc(c.main) + " 对 " + sc(p.main), n: "差 " + signed(c.main - p.main) + " 分 · 同一张钉死赛程", hot: true },
        { k: "10 人档", v: fmt1(c.bySize[10]), n: Q5 + " 那次 " + fmt1(p.bySize[10]) + " · 三档权重相等" },
        { k: "故障局", v: c.faults + " 对 " + (p.faults || 1), n: "那一局是 10 人档的进程退出，计分已剔除" }
      ]) +
      screen(["三档全过基准", "10 人档 " + fmt1(p.bySize[10]) + " → " + fmt1(c.bySize[10])]);
  }
  function p09b() {
    var bc = brow("bomberman", "cur"), bp = brow("bomberman", "prev");
    var rv = catv("bomberman", "复盘与逐帧分析", "prev", 0), rc = catv("bomberman", "复盘与逐帧分析", "cur", 0);
    return head("第 2 场比赛 · 炸弹人 · 思考量与时间", "省下的时间<span class=\"em\">挪去看回放</span>了") +
      pairBars([
        { k: "每请求输出 tok", a: bp.tokPerReq, b: bc.tokPerReq },
        stk("bomberman"),
        { k: "最长一步 分", a: bp.maxStepMin, b: bc.maxStepMin },
        { k: "复盘逐帧 分", a: rv, b: rc, note: pcx(chg(rv, rc)) }
      ], { labelW: 300, rh: 32, gap: 9, blockGap: 24, fs: 27, padR: 220, top: 78, w: 1560, segNote: "暖色斜纹段 = 加时窗口",
        rowNote: "每行各自满格，柱长只在本行内可比；行尾是原值，右侧是变化；这里都是线性量，不是对数分数" }) +
      strip([
        { k: "写代码", v: catv("bomberman", "写代码", "cur", 0) + " 分", n: Q5 + " 那次 " + catv("bomberman", "写代码", "prev", 0) + " 分" },
        { k: "进程协议排错", v: catv("bomberman", "进程协议排错", "cur", 0) + " 分", n: Q5 + " 那次 " + catv("bomberman", "进程协议排错", "prev", 0) + " 分" },
        { k: "复盘与逐帧", v: catv("bomberman", "复盘与逐帧分析", "cur", 1) + "%", n: "占比从 " + catv("bomberman", "复盘与逐帧分析", "prev", 1) + "% 涨上来" }
      ]) +
      '<p class="mini">' + esc(longStepNote("bomberman")) + "　" + esc(minBasisNote("bomberman")) + "</p>" +
      screen(["复盘逐帧 " + rv + " → " + rc + " 分", "每请求输出 " + pcx(chg(bp.tokPerReq, bc.tokPerReq))]);
  }

  function p10() {
    var r2 = iterOf("bomberman").filter(function (r) { return r.window.indexOf("r2") === 0 && /^R[0-4]$/.test(r.round); });
    return head("第 2 场比赛 · 炸弹人 · 加时 40 分钟", "第二次机会：<span class=\"em\">四轮全撤回</span>") +
      ledger("bomberman", { rows: r2, w: 92 }) +
      screen(["R0 自检：脚手架有效", "R1 那条改动分支从未被执行路径覆盖"]);
  }
  function p11() {
    var E = "bomberman", B = SK.bomberman || {}, c = B.cur || {}, p = B.prev || {};
    return head("第 2 场比赛 · 炸弹人 · 加时终版成绩", "未改一行，<span class=\"em\">这张榜与交卷那张同分</span>") +
      '<div class="cols">' +
      '<div class="col">' + chartBars("bomberman", { labelW: 290, rh: 28, gap: 7, fs: 26, meColor: "var(--bomb)", w: 1180 }) + "</div>" +
      '<div class="col vid side37">' + vslot("bomb-ot", "炸弹人 · 局 01150 · 交卷第 10 → 改完第一", "同图同座位，0 分 → 9.75 分 · 对手含 GPT-6 Astra、Opus 5.5 等 9 家", "side") + "</div>" +
      "</div>" +
      strip([
        { k: CR + " 加时", v: sc(c.overtime), n: "与交卷版同一份代码" },
        { k: Q5 + " 加时", v: sc(p.overtime), n: "那场 4 轮里改了 3 处" },
        { k: "两次加时差", v: signed(c.overtime - p.overtime), n: "同一份钉死赛程、同一批对手" },
        { k: "榜上位置", v: c.rank, n: Q5 + " 那次是 " + ((PR.bomberman || {}).q5Us || {}).rank }
      ]) +
      '<p class="mini">实线框 ' + CR + '、虚线框 ' + Q5 + '；本机两根 = 交卷版与加时终版，对手取两次平均。' + esc(scaleNote(E)) + "</p>" +
      screen(["本机两根与对手同榜", "交卷版与加时终版各一根"]);
  }

  /* ---------- 第 12—15 页 · 夺旗 ---------- */
  function p12() {
    var F = SK.ctf || {}, c = F.cur || {}, p = F.prev || {}, V = C.volume || {};
    var ks = Object.keys(c.bySizeMain || {});
    var up = ks.filter(function (k) { return Number(c.bySizeMain[k]) > Number((p.bySizeMain || {})[k]); }).length;
    return head("第 3 场比赛 · 夺旗 · 交卷成绩", "八个人数档，<span class=\"em\">这场比赛是负的</span>") +
      '<div class="panes">' +
      '<div class="pane tb">' +
      '<div class="cols">' +
      '<div class="col wide">' + peerTable("ctf", {
        head: "实力值（两次平均）",
        foot: "实力值与炸弹人同一构造；11 家思考档全开最高。"
      }) + "</div>" +
      '<div class="col vid side28">' + vslot("ctf-main", "夺旗 · 4 方 31×31 局 04-007", "13 分独占第一 · 对手 GLM 5.3、豆包 Seed 2.1 Turbo、基准", "side") + "</div>" +
      "</div>" +
      facts([
        { k: "对局量", v: fmt(V.ctf.games) + " 局", n: V.ctf.tiers + " 个人数档 × 每档 " + V.ctf.mapsPerTier + " 张图 · 同一张图把座位轮一圈" },
        { k: "故障局", v: String(c.faults), n: Q5 + " 那次正赛 " + V.ctf.faultsQ5.main + " 局、加时 " + V.ctf.faultsQ5.ot + " 局", hot: true },
        { k: "旗点", v: "每局现取", n: "同一份代码两次跑出的场面不会完全一样" }
      ]) +
      screen(["" + CR + " " + sc(c.main) + " · " + Q5 + " " + sc(F.prev.main), "基准 = 0，负分是低于锚点"]) +
      "</div>" +
      '<div class="pane bb" data-stage="2" data-beat="4">' +
      chartBars("ctf", { labelW: 305, rh: 25, gap: 7, fs: 26, meColor: "var(--ctf)", zero: true, w: 1560, noOt: true }) +
      strip([
        { k: "交卷 BT", v: sc(c.main), n: "95% 区间 " + sc(c.mainCi[0]) + "~" + sc(c.mainCi[1]), hot: true },
        { k: "八档", v: "全在基准下", n: "其中 " + up + " 档高于 " + Q5 },
        { k: "故障局", v: c.faults + " 对 " + ((PR.ctf || {}).q5Us || {}).faultsMain, n: "同一次评测口径" },
        { k: "榜上位置", v: c.rankMain, n: Q5 + " 那次 " + ((PR.ctf || {}).q5Us || {}).rank }
      ]) +
      '<p class="mini">实线框 ' + CR + '、虚线框 ' + Q5 + '，对手那一列取两次平均。' + esc(scaleNote("ctf")) + "</p>" +
      screen(["柱子按分数从高到低排", "认模型看头像框"]) +
      "</div>" +
      "</div>";
  }
  function p13() {
    var F = SK.ctf || {}, c = F.cur || {}, p = F.prev || {};
    var bc = brow("ctf", "cur"), bp = brow("ctf", "prev");
    var ks = Object.keys(c.bySizeMain || {});
    var up = ks.filter(function (k) { return Number(c.bySizeMain[k]) > Number((p.bySizeMain || {})[k]); }).length;
    var r = function (k, cur, prev, g, dec) {
      var d = Number((cur - prev).toFixed(dec == null ? 0 : dec));
      return { k: k, cells: [sc(cur), sc(prev), { v: signed(d), style: "color:" + ((d > 0) === !!g ? "var(--good)" : "var(--red)") }] };
    };
    return head("第 3 场比赛 · 夺旗 · 两个模型同表 · 正式赛交卷成绩", "八档里<span class=\"em\">三档</span>比 " + Q5 + " 高") +
      statTable({
        head: "分档实力", cols: [CR + " · " + CUR.quantTag, Q5, "差"], w: 68, grow: true, split: true, rows: [
          { k: "总分", cells: [sc(c.main), sc(p.main), { v: signed(c.main - p.main), style: "color:var(--red)" }] },
        ].concat(ks.map(function (k) { return r(k + " 人档", c.bySizeMain[k], (p.bySizeMain || {})[k], true); }))
          .concat([
            { k: "故障局", cells: [String(c.faults), String(p.faultsMain), { v: "0 对 " + p.faultsMain, style: "color:var(--good)" }] },
            { k: "每请求输出 tok", cells: [fmt(bc.tokPerReq), fmt(bp.tokPerReq), { v: pcx(chg(bp.tokPerReq, bc.tokPerReq)), style: "color:var(--warn)" }] }
          ])
      }) +
      facts([
        { k: "总分", v: sc(c.main) + " 对 " + sc(p.main), n: "95% 区间 " + sc(c.mainCi[0]) + "~" + sc(c.mainCi[1]) + " 对 " + sc(p.mainCi[0]) + "~" + sc(p.mainCi[1]), hot: true },
        { k: "涨了几档", v: up + " / " + ks.length, n: "同一批座位轮换，逐档各算一次实力值" },
        { k: "故障局", v: c.faults + " 对 " + p.faultsMain, n: "夺旗这场比赛两边都跑满了档" }
      ]) +
      screen(["分档实力值逐档列", "基准 = 0，负分是低于锚点"]);
  }
  function p13b() {
    var bc = brow("ctf", "cur"), bp = brow("ctf", "prev");
    return head("第 3 场比赛 · 夺旗 · 思考量与时间", "三场比赛里最难的一场，<span class=\"em\">思考没压下来</span>") +
      pairBars([
        { k: "每请求输出 tok", a: bp.tokPerReq, b: bc.tokPerReq },
        { k: "中位步长 秒", a: bp.medianStepS, b: bc.medianStepS },
        { k: "p95 步长 秒", a: bp.p95StepS, b: bc.p95StepS },
        stk("ctf")
      ], { labelW: 300, rh: 32, gap: 9, blockGap: 24, fs: 27, padR: 220, top: 78, w: 1560, segNote: "暖色斜纹段 = 加时窗口",
        rowNote: "每行各自满格，柱长只在本行内可比；行尾是原值，右侧是变化；这里都是线性量，不是对数分数" }) +
      strip([
        { k: "超 5 分钟长步", v: ls5("ctf").cur + " 次 · " + ls5("ctf").curMinutes + " 分", n: Q5 + " 那次 " + ls5("ctf").prev + " 次 · " + ls5("ctf").prevMinutes + " 分" },
        { k: "工具链排错", v: catv("ctf", "工具链/自身调用排错", "cur", 0) + " 分", n: "从 " + catv("ctf", "工具链/自身调用排错", "prev", 0) + " 分涨上来；对局测试只剩 " + catv("ctf", "对局测试", "cur", 0) + " 分" }
      ]) +
      '<p class="mini">' + esc(longStepNote("ctf")) + "　" + esc(minBasisNote("ctf")) + "</p>" +
      screen(["每请求输出 " + bp.tokPerReq + " → " + bc.tokPerReq, "复杂问题要更深的那一层思考"]);
  }

  function p14() {
    var c = (SK.ctf || {}).cur || {};
    return head("第 3 场比赛 · 夺旗 · 加时", "每档跑两遍交换座位，<span class=\"em\">只留站得住的那条</span>") +
      ledger("ctf", { w: 92, rows: iterOf("ctf").filter(function (r) { return /^R/.test(r.round); }) }) +
      '<div class="grid g2" style="align-items:stretch">' +
      '<div class="card"><div class="tag">为什么每档跑两遍</div><p>夺旗的旗点每局现取，同一份代码两遍跑出的场面不一样。' +
      "所以每个档位交换座位跑两遍，两遍都往同一方向走才算数。</p>" +
      '<p style="margin-top:.8vh">第三遍它自战读数 +150，但分到人数量档有涨有跌，它判定这不算优于前一条，自己撤回了。</p></div>' +
      '<div class="card hot"><div class="tag">最后加的 129 分是不是跑动带来的</div><p>把 11 家对手的两次波动排开看，中位只有 +5 分；' +
      "本机一次加 " + sc(c.overtime - c.main) + " 分，超出这个范围两倍以上，而且与豆包的相对位置整个翻转。</p></div>" +
      "</div>" +
      screen(["八档全涨、无一档退", "四轮里自己撤回一次"]);
  }
  function p15() {
    var E = "ctf", F = SK.ctf || {}, c = F.cur || {}, p = F.prev || {};
    var td = (PR.ctf || {}).tierDiff || {};
    return head("第 3 场比赛 · 夺旗 · 加时终版成绩", "八档全涨，<span class=\"em\">名次动了一位</span>") +
      '<div class="cols">' +
      '<div class="col">' + chartBars("ctf", { labelW: 276, rh: 25, gap: 5, fs: 25, meColor: "var(--ctf)", zero: true, w: 1180 }) + "</div>" +
      '<div class="col vid side37">' + vslot("ctf-ot", "夺旗 · 3 方 31×31 局 03-007", "15 分独占第一 · 对手 GLM 5.3、DeepSeek V4.1 Flash", "side") + "</div>" +
      "</div>" +
      strip([
        { k: "交卷 → 加时", v: sc(c.main) + " → " + sc(c.overtime), n: "两个 95% 区间不重叠" },
        { k: "涨最多的档", v: "6 人档 +" + td[6], n: "八档 " + Object.keys(td).map(function (k) { return "+" + td[k]; }).join(" / ") },
        { k: "榜上位置", v: c.rankMain + " → " + c.rankOvertime, n: Q5 + " 那次 " + ((PR.ctf || {}).q5Us || {}).rank },
        { k: Q5 + " 那次加时", v: sc(p.overtime), n: "涨了 " + signed(p.overtime - p.main) + " 分" }
      ]) +
      '<p class="mini">实线框 ' + CR + '、虚线框 ' + Q5 + '；本机两根 = 交卷版与加时终版，对手取两次平均。' + esc(scaleNote(E)) + "</p>" +
      screen(["八档全涨、无一档退", "两个 95% 区间不重叠"]);
  }

  /* ---------- 第 16—21 页 · 横比 / 三条轴 / 概括 / 收束 ---------- */
  function p16() {
    var DF = C.difficulty || {}, dims = DF.dims || [];
    var eps = ["land", "bomberman", "ctf"];
    var body = dims.map(function (d) {
      return '<tr><td class="dk"><b>' + esc(d.k) + "</b></td>" + eps.map(function (e) {
        return "<td" + (e === "ctf" ? ' class="hard"' : (e === "land" ? ' class="easy"' : "")) + ">" + esc(d[e]) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return head("三场比赛放在一起 · 难在哪（组织方评估）", "难度：<span class=\"em\">夺旗 &gt; 炸弹人 &gt; 圈地</span>") +
      '<div class="fig tablepanel difftab" style="max-width:92vw;height:100%"><table style="width:100%;height:100%">' +
      '<thead><tr><th class="dk">难在哪</th><th class="easy">圈地</th><th>炸弹人</th><th class="hard">夺旗</th></tr></thead>' +
      "<tbody>" + body + "</tbody></table></div>" +
      '<p class="verdict">一步要管的单位、同时挂着的目标、专门机制：<span class="em">夺旗在三场比赛里都最多</span>，圈地最简</p>' +
      '<p class="mini">规则最多不是算得更深，是<span class="em">考验模型对复杂场景的理解能力</span>——弱模型连规则都不一定读得懂</p>' +
      screen(["夺旗考验对复杂场景的理解", "弱模型连规则都不一定读得懂"]);
  }
  function p16b() {
    var eps = ["land", "bomberman", "ctf"];
    // 这一页只比「两个模型各自的加时终版」：圈地的加时读数挂在 curOvertime，另两场在 cur.overtime
    var rows = eps.map(function (e) {
      var g = SK[e] || {}, a = Number((g.prev || {}).overtime);
      var b = e === "land" ? Number((g.curOvertime || {}).value) : Number((g.cur || {}).overtime);
      return { k: EPNM[e], a: a, b: b, note: signed(b - a) + " 分" };
    });
    return head("三场比赛放在一起 · 最终加时成绩", "加时终版对加时终版：<span class=\"em\">两场高、一场低</span>") +
      pairBars(rows, { labelW: 240, rh: 40, gap: 11, blockGap: 40, fs: 28, padR: 220, top: 78, w: 1560,
        rowNote: "每行同一刻度：上柱 " + Q5 + " 的加时终版、下柱 " + CR + " 的加时终版，行尾数字就是原分" }) +
      strip([
        { k: "同一批对手", v: "三场比赛都是", n: "云端 bot.cpp 两轮逐字节相同" },
        { k: "分数从不横比", v: "只看每场方向", n: "三场比赛尺度不同，也从不相加" }
      ]) +
      '<p class="mini">' + esc(scaleNote("land", "圈地")) + "；" + esc(scaleNote("bomberman", "炸弹人")) + "，夺旗与它同一构造。圈地跌到 0 是钳位、不是没打。</p>" +
      screen(["最终加时：" + rows.map(function (r) { return r.k + " " + r.note; }).join(" · "), "两个模型都取加时终版，对手池不变"]);
  }

  function p17() {
    var outP = bsum("prev", "outputTok"), outC = bsum("cur", "outputTok");
    var reqP = bsum("prev", "requests"), reqC = bsum("cur", "requests");
    var eps = ["land", "bomberman", "ctf"];
    return head("轴一 · 思考用量", "三场合计输出<span class=\"em\">少了 " + fmt1(Math.abs(chg(outP, outC))) + "%</span>，逐场一降两升") +
      '<div class="cols">' +
      '<div class="col"><div class="gcap">三场比赛合计输出 token</div>' + hbars([
        { label: Q5, value: outP, note: fmt(outP) + " tok", color: "var(--q5)", ava: avaOf(Q5), frame: "var(--q5)", dash: true, strong: true },
        { label: CR, value: outC, note: fmt(outC) + " tok", color: "var(--acc)", hot: true, ava: avaOf(CR), frame: "var(--acc)" }
      ], { labelW: 210, rh: 66, gap: 24, fs: 30, padR: 175, top: 34, w: 780 }) + "</div>" +
      '<div class="col"><div class="gcap">三场比赛合计请求数</div>' + hbars([
        { label: Q5, value: reqP, note: fmt(reqP) + " 次", color: "var(--q5)", ava: avaOf(Q5), frame: "var(--q5)", dash: true, strong: true },
        { label: CR, value: reqC, note: fmt(reqC) + " 次", color: "var(--acc)", hot: true, ava: avaOf(CR), frame: "var(--acc)" }
      ], { labelW: 210, rh: 66, gap: 24, fs: 30, padR: 175, top: 34, w: 780 }) + "</div>" +
      "</div>" +
      '<p class="mini">两组柱各一套刻度：token 那组满格 ' + fmt(outP) + "，请求数那组满格 " + fmt(reqP) +
      "。都是线性量（柱长 = 数值本身），不是对数分数；分数尺度不同，从不与它们同轴。</p>" +
      '<div class="grid g3" style="align-items:stretch">' +
      eps.map(function (e) {
        var a = brow(e, "prev"), b = brow(e, "cur");
        return '<div class="card ev ev-' + e + '"><div class="tag">' + EPNM[e] + "</div><p>每请求输出 " + fmt(a.tokPerReq) + " → " + fmt(b.tokPerReq) +
          " tok（" + pcx(chg(a.tokPerReq, b.tokPerReq)) + "）；请求 " + a.requests + " → " + b.requests + " 次。</p></div>";
      }).join("") +
      "</div>" +
      strip([
        { k: "圈地 · 唯一降的", v: pcx(chg(brow("land", "prev").tokPerReq, brow("land", "cur").tokPerReq)), n: "每请求输出 " + fmt(brow("land", "prev").tokPerReq) + " → " + fmt(brow("land", "cur").tokPerReq) + " tok" },
        { k: "炸弹人 · 涨最多", v: pcx(chg(brow("bomberman", "prev").tokPerReq, brow("bomberman", "cur").tokPerReq)), n: "请求少了 " + fmt1(Math.abs(chg(brow("bomberman", "prev").requests, brow("bomberman", "cur").requests))) + "%，总输出仍 " + pcx(chg(brow("bomberman", "prev").outputTok, brow("bomberman", "cur").outputTok)) },
        { k: "夺旗 · 涨最少", v: pcx(chg(brow("ctf", "prev").tokPerReq, brow("ctf", "cur").tokPerReq)), n: "但单步中位 " + sc(brow("ctf", "prev").medianStepS) + " → " + sc(brow("ctf", "cur").medianStepS) + " 秒，三场里唯一变长" }
      ]) +
      screen(["合计只加 token 与请求数", "逐场看是一降两升，只有圈地省下来"]);
  }
  function p18() {
    var minP = bsum("prev", "effectiveMin"), minC = bsum("cur", "effectiveMin");
    var stepP = bsum("prev", "maxStepMin"), stepC = bsum("cur", "maxStepMin");
    var l5 = ["land", "bomberman", "ctf"].map(function (e) { return ls5(e); });
    var l5p = 0, l5c = 0, l5pm = 0, l5cm = 0;
    l5.forEach(function (o) { l5p += o.prev; l5c += o.cur; l5pm += o.prevMinutes; l5cm += o.curMinutes; });
    var wsum = function (round, key) {
      return ["land", "bomberman", "ctf"].reduce(function (s, e) { return s + (((WS[e] || {})[round] || {})[key] || 0); }, 0);
    };
    return head("轴二 · 时间利用", "最长一步<span class=\"em\">从 " + sc(stepP) + " 分钟塌到 " + sc(stepC) + " 分钟</span>") +
      pairBars([
        { k: "三场比赛最长一步之和 分", a: stepP, b: stepC },
        { k: "三场比赛净工作 分", unit: " 分", stack: { a: [wsum("prev", "main"), wsum("prev", "overtime")], b: [wsum("cur", "main"), wsum("cur", "overtime")] } },
        { k: "超 5 分钟长步 次", a: l5p, b: l5c, note: l5p + " → " + l5c },
        { k: "长步合计 分", a: l5pm, b: l5cm }
      ], { labelW: 340, rh: 26, gap: 8, blockGap: 18, fs: 26, padR: 220, top: 74, w: 1560, segNote: "暖色斜纹段 = 加时窗口",
        rowNote: "每行各自满格，柱长只在本行内可比；行尾是原值，右侧是变化；这里都是线性量，不是对数分数" }) +
      strip(["land", "bomberman", "ctf"].map(function (e) {
        var a = brow(e, "prev"), b = brow(e, "cur"), o = ls5(e);
        return { k: EPNM[e], v: "最长一步 " + sc(a.maxStepMin) + " → " + sc(b.maxStepMin) + " 分",
          n: "净工作 " + sc(a.effectiveMin) + " → " + sc(b.effectiveMin) + " 分 · 超 5 分钟长步 " + o.prev + " → " + o.cur + " 次" };
      })) +
      '<p class="mini">最长一步 = 单条回复最长的那一次（思考加输出），三场比赛各取最大再相加；净工作 = 各步耗时求和，两次都含 40 分钟加时段里的模型步，都不含等待与停机。</p>' +
      strip([
        { k: "省下的时间去向", v: "换成了对局", n: "同一份 90 分钟预算里，交卷更早、跑分更多" },
        { k: "没省下的", v: "夺旗 " + sc(brow("ctf", "cur").maxStepMin) + " 分", n: "那场最长一步仍然卡了 " + sc(brow("ctf", "cur").maxStepMin) + " 分钟" }
      ]) +
      screen(["三场比赛最长一步之和 " + sc(stepP) + " 分钟 → " + sc(stepC) + " 分钟", "三场比赛净工作合计 " + sc(minP) + " → " + sc(minC) + " 分"]);
  }
  function p19() {
    var S = D.ctfStrategy || {}, c = S.cur || {}, q = S.prev || {};
    var rg = function (a) { var v = (a || []).map(Number); if (!v.length) return "—"; return sc(Math.min.apply(null, v)) + "–" + sc(Math.max.apply(null, v)); };
    return head("夺旗 · 两代最终 bot", "差在一道门上：<span class=\"em\">抢旗要先赢过全场</span>") +
      '<div class="grid g2" style="flex:1;align-content:center;align-items:stretch;gap:3.2vh">' +
      '<div class="card"><div class="tag">' + CR + ' 那版 · 抢旗要先赢过全场</div><p>' +
      "判据是「我方往返 ≤ 场上全部存活敌人往返的最小值 + 1」（bot.cpp L221–L224）。过不去就把这面旗记 0 分，" +
      "而 0 分不参与指派（L262）—— 13 人档场上 36 个敌人，这个 min 几乎必然比我方的小。" +
      "移动排序里猎杀目标优先级压过旗（L272），猎杀单位先把格子占住，旗单位绕开。</p></div>" +
      '<div class="card hot"><div class="tag">' + Q5 + ' 那版 · 只比这一面旗的最近对手</div><p>' +
      "比的是单面旗的最近竞争者、只算单程（L462–L478），抢不过的旗反过来加权 ×3（L473）；围剿与驻扎的分要乘一个开关（L380），开关关掉时压成负分（L411、L438）。" +
      "同一格既有旗又有可打的目标时，" + Q5 + " 先捡旗（L696）、出刀排在后面（L697）；" + CR + " 那份反过来：先出刀（L381）、捡旗在后（L382）。</p></div>" +
      "</div>" +
      facts([
        { k: "加时改了什么", v: "只降了打架", n: "那 40 分钟 " + CR + " 动的是猎杀与换血的权重（L230、L254），抢旗这道门原封没动", hot: true },
        { k: "载旗接力", v: CR + " 那份没有", n: "它的载旗动作写死、全文没有丢旗指令（L373）；" + Q5 + " 在被追近时丢给两步内的队友（L609–L624）" },
        { k: "每回合时间", v: "用了 " + rg(c.budgetPct) + "%", n: "限时 " + S.turnBudgetMs + " ms，最慢一回合均值 " + rg(c.slowestTurnMs) + " ms；另有一段算完没人读的搜索（L169–L185）" }
      ]) +
      screen(["抢旗要赢过全场所有敌人", "同一格有旗又能打人：" + CR + " 出刀、" + Q5 + " 捡旗"]);
  }
  function p19b() {
    var S = D.ctfStrategy || {}, c = S.cur || {}, q = S.prev || {}, sz = S.sizes || [];
    var rg = function (a) { var v = (a || []).map(Number); if (!v.length) return "—"; return sc(Math.min.apply(null, v)) + "–" + sc(Math.max.apply(null, v)); };
    var rows = [];
    var pk = function (arr, ra, i) { return sc(ra[i]) + " 倍（" + sc(arr[i]) + " 次）"; };
    sz.forEach(function (n, i) { rows.push({ label: CR + " · " + n + " 人档", value: (c.pickupsRatio || [])[i], note: pk(c.pickups, c.pickupsRatio, i), color: "var(--me-ot)" }); });
    sz.forEach(function (n, i) { rows.push({ label: Q5 + " · " + n + " 人档", value: (q.pickupsRatio || [])[i], note: pk(q.pickups, q.pickupsRatio, i), color: "var(--q5ot)" }); });
    return head("夺旗 · 两代捡旗读数", "加时改完，捡旗只到基准的<span class=\"em\">七到九折</span>") +
      hbars(rows, { labelW: 320, rh: 44, gap: 12, top: 28, fs: 25, max: 1.2, padR: 170, w: 1560, ref: 1, refLabel: "基准 = 1.00" }) +
      '<p class="mini">柱长就是这个比值：满格 1.2 倍，红色虚线是 1.00 那条持平线，柱压过它表示高于基准、停在它左边就是不及。' +
      "两场评测不是同一批对局，各除自己那场的基准，两根模型的柱不互比长短。</p>" +
      facts([
        { k: "搬回本垒", v: rg(c.capturesRatio) + " 倍", n: "同样对基准的比值，" + Q5 + " 那版是 " + rg(q.capturesRatio) + " 倍", hot: true },
        { k: "13 人档打架", v: sc(c.kills13) + " 杀", n: "同档基准 " + sc(c.killsBase13) + " 杀，降权生效了；杀掉的是扛旗的只有 " + sc(c.carrierKills13) + " 次" }
      ]) +
      screen(["搬回本垒只到基准的 " + sc(Math.min.apply(null, (c.capturesRatio || [1]).map(Number))) + " 倍"]);
  }
  function p20() {
    var L = SK.land || {}, B = SK.bomberman || {}, F = SK.ctf || {};
    var outP = bsum("prev", "outputTok"), outC = bsum("cur", "outputTok");
    var lp = brow("land", "prev"), lc = brow("land", "cur"), cp = brow("ctf", "prev"), cc = brow("ctf", "cur");
    var mp = brow("bomberman", "prev"), mc = brow("bomberman", "cur");
    return head("总结 · 比原版舍弃了什么", "换走的是<span class=\"em\">思考长度</span>，不是长考的能力") +
      '<div class="grid g2" style="flex:1;align-content:center;align-items:stretch;gap:3.2vh">' +
      '<div class="card"><div class="tag">简单的问题</div><h3>想得短，同样的时间做得更多</h3><p>三场比赛合计输出 ' +
      fmt(outP) + " → " + fmt(outC) + " tok（" + pcx(chg(outP, outC)) + "），但逐场是一降两升，省下来的几乎全是圈地这一场：每请求 " + fmt(lp.tokPerReq) + " → " + fmt(lc.tokPerReq) +
      " tok，最长那一步 " + sc(lp.maxStepMin) + " → " + sc(lc.maxStepMin) + " 分，每分钟发的请求 " + sc(lp.reqPerMin) + " → " + sc(lc.reqPerMin) +
      " 次。同一份预算里它更早交卷、跑得更多：圈地单挑 " + sc(L.prev.duel) + " → " + sc(L.cur.duel) + " 分，炸弹人 BT " + sc(B.prev.main) + " → " + sc(B.cur.main) + "。</p></div>" +
      '<div class="card hot"><div class="tag">复杂的问题</div><h3>该长考的那场没有变短</h3><p>炸弹人每请求 ' + fmt(mp.tokPerReq) + " → " + fmt(mc.tokPerReq) +
      " tok 是涨得最多的那场；夺旗 " + fmt(cp.tokPerReq) + " → " + fmt(cc.tokPerReq) + " tok 涨得最少，单步中位却从 " + sc(cp.medianStepS) + " → " + sc(cc.medianStepS) +
      " 秒，是三场里唯一变长的 —— 需要把推理铺开的地方，它铺得跟原版一样长。这场分数 " + sc(F.prev.main) + " → " + sc(F.cur.main) + "，输的是抢旗的决策，不是想不透规则。</p></div>" +
      "</div>" +
      facts([
        { k: "三场成绩", v: "两涨一跌", n: "跌的那场加时涨回 " + signed(F.cur.overtime - F.cur.main) + " 分", hot: true },
        { k: "没换掉的", v: "两个变量", n: "量化档与后训练同时变了，这一对给不出各自的贡献" }
      ]) +
      screen(["舍弃的是思考长度，不是长考的能力", "所有测试均为 one-shot，成绩有偶然性"]);
  }
  function p21() {
    return '<div class="fig" style="gap:3.2vh"><div class="bignum" style="right:4vw">完</div>' +
      '<h1 class="title" style="transform:none;text-align:center;font-size:13vh">完</h1>' +
      screen(["Coder390 ↔ Q5_K_XL · 三场比赛各一遍"]) +
      '<p class="mini" id="rope-hint" style="color:var(--red)">▼ 点击 / → 沉入水中</p></div>';
  }

  /* ---------- 页面表（21 页，与 script/口播稿.md 一一对应） ---------- */
  var PAGES = [
    { cap: "封面 · Coder390 性能测评", acc: "var(--red)", build: p01 },
    { cap: "规格 · 同参数量差量化档", acc: "var(--red)", build: p02 },
    { cap: "三集 · 回放与赛制", acc: "var(--red)", cls: "gal", build: p03 },
    { cap: "圈地 · 交卷成绩", acc: "var(--land)", cls: "ep-land dense viz", build: p04 },
    { cap: "圈地 · 思考量与时间", acc: "var(--land)", cls: "ep-land dense viz", build: p05b },
    { cap: "圈地 · 两个模型同表", acc: "var(--land)", cls: "ep-land dense", build: p05 },
    { cap: "圈地 · 加时六轮", acc: "var(--land)", cls: "ep-land dense", build: p06 },
    { cap: "圈地 · 加时终版成绩", acc: "var(--land)", cls: "ep-land dense viz", build: p07 },
    { cap: "炸弹人 · 交卷成绩", acc: "var(--bomb)", cls: "ep-bomb dense viz", build: p08 },
    { cap: "炸弹人 · 两个模型同表", acc: "var(--bomb)", cls: "ep-bomb dense", build: p09 },
    { cap: "炸弹人 · 思考量与时间", acc: "var(--bomb)", cls: "ep-bomb dense viz", build: p09b },
    { cap: "炸弹人 · 加时台账", acc: "var(--bomb)", cls: "ep-bomb dense", build: p10 },
    { cap: "炸弹人 · 加时终版成绩", acc: "var(--bomb)", cls: "ep-bomb dense viz", build: p11 },
    { cap: "夺旗 · 交卷成绩", acc: "var(--ctf)", cls: "ep-ctf dense viz", build: p12 },
    { cap: "夺旗 · 两个模型同表", acc: "var(--ctf)", cls: "ep-ctf dense", build: p13 },
    { cap: "夺旗 · 加时四轮", acc: "var(--ctf)", cls: "ep-ctf dense", build: p14 },
    { cap: "夺旗 · 加时终版成绩", acc: "var(--ctf)", cls: "ep-ctf dense viz", build: p15 },
    { cap: "夺旗 · 思考量与时间", acc: "var(--ctf)", cls: "ep-ctf dense viz", build: p13b },
    { cap: "横比 · 三集难在哪", acc: "var(--red)", cls: "dense", build: p16 },
    { cap: "横比 · 两涨一跌", acc: "var(--red)", cls: "dense viz", build: p16b },
    { cap: "轴一 · 思考用量", acc: "var(--red)", cls: "dense viz", build: p17 },
    { cap: "轴二 · 时间利用", acc: "var(--red)", cls: "dense viz", build: p18 },
    { cap: "夺旗 · 两代最终 bot", acc: "var(--ctf)", cls: "ep-ctf dense", build: p19 },
    { cap: "夺旗 · 两代捡旗读数", acc: "var(--ctf)", cls: "ep-ctf dense viz", build: p19b },
    { cap: "总结 · 比原版舍弃了什么", acc: "var(--red)", build: p20 },
    { cap: "完 · 收束", acc: "var(--red)", last: true, build: p21 }
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
  /* 静态出图核对：?stage=2 把换图页直接推到柱图态，?beat=N 把画廊推到第 N 拍 */
  var qSt = (location.search.match(/[?&]stage=([12])/) || [])[1];
  var qBt = (location.search.match(/[?&]beat=(\d)/) || [])[1];
  if (qSt) secs.forEach(function (p) { p.dataset.stage = qSt; });
  if (qBt) secs.forEach(function (p) { p.dataset.seq = qBt; });


  /* ---------- 按配音时间轴逐个点亮（?cue=1，加 &auto=1 按每页时长自动翻页） ---------- */
  var CUES = window.__CUES__ || null;
  var cueOn = /[?&]cue=1/.test(location.search), cueAuto = /[?&]auto=1/.test(location.search), cueTimers = [];
  var cueWait = /[?&]wait=1/.test(location.search), cueStarted = !cueWait, cuePending = null;
  var CUE_SEL = ".subtitle, .tagline.screen span, .oneliner, .facts .fact, .mini, .card, .epcard:not(.brief), .gsum, .stageMark, .pane[data-stage]";
  function cueClear() { for (var i = 0; i < cueTimers.length; i++) clearTimeout(cueTimers[i]); cueTimers = []; }
  function cuePlay(pageEl, idx) {
    cueClear();
    if (!cueOn || !pageEl) return;
    if (!cueStarted) { cuePending = [pageEl, idx]; return; }
    var all = Array.prototype.slice.call(pageEl.querySelectorAll(CUE_SEL));
    for (var i = 0; i < all.length; i++) all[i].classList.remove("on");
    // 带 data-beat / data-stage 的是「按拍触发」的标记，不参与「第 j 个元素跟第 j 句」的自动排布
    var els = all.filter(function (e) { return !e.dataset.beat && !e.dataset.stage && !e.closest(".pane.bb"); });
    var c = CUES && CUES.pages ? CUES.pages[idx] : null;
    var dur = c ? c.dur : 30;
    /* 元素浮现不再按「页时长的百分比」均摊，而是挂到本页的句子节拍上：
       第 k 个元素跟着第 k 句开口走（多出来的元素在同一句内 0.45s 依次错开），
       这样画面浮现和口播的段落大体同步，但不需要逐句手工标注。*/
    var S = [], sents = (CUES && CUES.sentences) || [], q2;
    for (q2 = 0; q2 < sents.length; q2++) if (sents[q2].page === idx + 1) S.push(sents[q2].start - (c ? c.start : 0));
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
      (function (el, sec) {
        cueTimers.push(setTimeout(function () {
          if (el.dataset && el.dataset.seq) {
            var sib = el.parentNode.querySelectorAll("[data-seq]");
            for (var z = 0; z < sib.length; z++) if (sib[z] !== el) sib[z].classList.remove("on");
            el.parentNode.parentNode.dataset.seq = el.dataset.seq;
          }
          el.classList.add("on");
        }, sec * 1000));
      })(els[j], tt);
    }
    /* 按拍触发的标记：data-beat=k 挂到本页第 k 句，同拍的一起出现（画廊换片必须同帧） */
    for (var q3 = 0; q3 < all.length; q3++) (function (el) {
      var bt = Number(el.dataset.beat) || 0, stg = el.dataset.stage;
      if (!bt && !stg) return;
      var base = S.length ? S[Math.max(0, Math.min(S.length - 1, bt - 1))] : 0.4;
      cueTimers.push(setTimeout(function () {
        var pg = el.closest(".page");
        if (el.dataset.seq && pg) {
          var s2 = el.parentNode.querySelectorAll("[data-seq]");
          for (var z = 0; z < s2.length; z++) if (s2[z] !== el) s2[z].classList.remove("on");
          pg.dataset.seq = el.dataset.seq;
        }
        if (stg && pg) pg.dataset.stage = stg;
        el.classList.add("on");
      }, Math.max(0.25, base + 0.18) * 1000));
    })(all[q3]);
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
  if (/[?&]end=1/.test(location.search)) { setTimeout(function () { go(PAGES.length - 1); setTimeout(pullCurtain, 1500); }, 600); }
  // ?anim=0 关掉全部入场动效：layout.mjs 量的是终态，动画中途量会把底边量小
  if (/[?&]anim=0/.test(location.search)) document.body.classList.add("noanim");

  paint();
  console.log("[arena-effthink] pages=" + PAGES.length + " compare=" + (C && Object.keys(C).length) + " iters=" + IT.length);;
})();
