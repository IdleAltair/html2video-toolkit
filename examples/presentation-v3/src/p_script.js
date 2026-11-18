(function () {
  var NL = String.fromCharCode(10);
  var stage = document.getElementById("stage");
  var wipe = document.getElementById("wipe");
  var hud = document.getElementById("hud");
  if (/clean=1/.test(location.search)) { hud.style.display = "none"; document.documentElement.classList.add("clean"); }

  var VID_ROOT = "../clips/";   // 成片剪辑目录（项目内 clips/，原 $OUTPUT_DIR 已并入本项目）
  var INK = "#141210";
  var QUANTS = {
    q4:    { tag: "Q4",    label: "量化 A", name: "Q4_K_XL",          model: "Qwen3.8-27B-UD-Q4_K_XL",          sizeGB: 16.6, v: "Q4",    tin: "20.7M", tout: "460K",  tcomp: 1 },
    nvfp4: { tag: "NVFP4", label: "量化 B", name: "NVFP4-MTP-Q8attn", model: "Qwen3.8-27B-NVFP4-MTP-Q8attn", sizeGB: 17.8, v: "nvfp4", tin: "35.0M", tout: "485.7K", tcomp: 3 },
    q5:    { tag: "Q5",    label: "量化 C", name: "Q5_K_XL",          model: "Qwen3.8-27B-UD-Q5_K_XL",          sizeGB: 18.8, v: "Q5",    tin: "14.8M", tout: "397K",  tcomp: 2 }
  };
  var QORDER = ["q4", "nvfp4", "q5"];
  var PHUE = ["#1e56b0", "#0f8a7a", "#5546c8"];
  var PNUM = ["01", "02", "03"];
  var PROJECTS = [
    { n: 1, id: "storm-dusk-sea", zh: "海上风暴", en: "STORM DUSK SEA", sub: "黄昏海面 · 5层波浪 · 粒子飞溅 · 太阳光晕 · 无缝循环",
      tech: "Canvas 2D", form: "单文件", dep: "无依赖",
      data: {
        q4:    { in: "5.2M",  out: "138K",  kv: "q8 164K/185K", comp: 1, src: "Q4-storm-dusk-sea.html",     cut: "0:52-0:58",  dur: 6.0 },
        nvfp4: { in: "2M",    out: "89.7K", kv: "q8 160K/170K", comp: 0, src: "nvfp4-storm-dusk.html",      cut: "0:25-0:31",  dur: 6.0 },
        q5:    { in: "3M",    out: "128K",  kv: "q8 152K/160K", comp: 1, src: "Q5-storm-dusk-sea.html",     cut: "0:06-0:12",  dur: 6.0 }
      } },
    { n: 2, id: "ocean-vortex", zh: "海龙卷", en: "OCEAN VORTEX", sub: "3D 海上龙卷 · 粒子涡旋 · 风暴海面 · 闪电云层 · 科幻UI",
      tech: "WebGL / Three.js", form: "单文件", dep: "CDN Three.js",
      data: {
        q4:    { in: "10.2M", out: "174K", kv: "q8 160K/170K", comp: 0, src: "Q4-sea-tornado.html",        cut: "1:17-1:27",  dur: 10.0 },
        nvfp4: { in: "3.1M",  out: "132K", kv: "q8 164K/185K", comp: 1, src: "nvfp4-ocean-tornado.html",   cut: "1:38-2:03",  dur: 25.0 },
        q5:    { in: "937K",  out: "99K",  kv: "q8 152K/160K", comp: 0, src: "three-project-test.mp4 · 截取", cut: "2:15-2:48", dur: 33.0, res: "2560×1440" }
      } },
    { n: 3, id: "thunderstrom", zh: "雷暴", en: "THUNDERSTORM", sub: "ES Modules 多文件 · 程序化海面 · 体积光 · 枝状闪电 · bloom",
      tech: "Three.js + ES Modules", form: "多文件", dep: "本地 vendor",
      data: {
        q4:    { in: "5.3M",  out: "148K", kv: "q4 208K/220K", comp: 0, src: "Q4-thunderstorm-sea/",       cut: "5:01-5:17",  dur: 16.0 },
        nvfp4: { in: "29.9M", out: "264K", kv: "q4 208K/220K", comp: 2, src: "nvfp4-thunderstorm-ocean/",  cut: "6:24-6:54",  dur: 30.0 },
        q5:    { in: "10.9M", out: "170K", kv: "q4 208K/220K", comp: 1, src: "Q5-thunderstorm-ocean/",     cut: "7:30-7:50",  dur: 20.0 }
      } }
  ];
  var ENV = [
    ["生成后端", "DeepSeek Harness · PTC 优化版"],
    ["上下文压缩", "Mimo 2.5 high"],
    ["思考强度", "默认 xhigh"],
    ["GPU", "2× RTX 5060 Ti"],
    ["实机录像", "9 段 · 总时长 152s"],
    ["展示形式", "单文件 HTML · 16 页"]
  ];
  var OTHER = [
    { t: "gargantua", sub: "Uncensored · Q4_K_M", file: "Uncensored-q4-KM-gargantua.mp4", dur: "22s" },
    { t: "sea storm", sub: "Q5_K_XL", file: "Q5-sea-strom.mp4", dur: "6s" },
    { t: "gargantua", sub: "Q5_K_XL", file: "Q5-KXL-gargantua.mp4", dur: "10s" },
    { t: "sea sunset", sub: "Q5_K_XL", file: "Q5-sea-sunset.mp4", dur: "6s" }
  ];

  function barw(qk) { return Math.round(QUANTS[qk].sizeGB / 18.8 * 100) + "%"; }
  function qfile(p, qk) { return QUANTS[qk].v + "-test" + p.n + ".mp4"; }
  function qpath(p, qk) { return VID_ROOT + qfile(p, qk); }
  function qposter(p, qk) { return "assets/shot-" + p.id + "-" + QUANTS[qk].v + ".png"; }
  function xmarks() { return '<span class="xm tl"></span><span class="xm tr"></span><span class="xm bl"></span><span class="xm br"></span>'; }
  function mot(p) {
    if (p.n === 1) return '<svg class="mot" viewBox="0 0 120 18" preserveAspectRatio="none"><path d="M0 9 Q7.5 1 15 9 T30 9 T45 9 T60 9 T75 9 T90 9 T105 9 T120 9" fill="none" stroke="var(--p)" stroke-width="2.4"/></svg>';
    if (p.n === 2) return '<svg class="mot" viewBox="0 0 120 18"><circle cx="60" cy="9" r="6.5" fill="none" stroke="var(--p)" stroke-width="2.2"/><circle cx="60" cy="9" r="2.8" fill="var(--p)"/><path d="M6 9 H46 M74 9 H114" stroke="var(--p)" stroke-width="2.2"/></svg>';
    return '<svg class="mot" viewBox="0 0 120 18"><path d="M66 1 L48 10 H60 L52 17 L84 6 H68 Z" fill="none" stroke="var(--p)" stroke-width="2.2" stroke-linejoin="round"/><path d="M4 9 H36 M86 9 H116" stroke="var(--p)" stroke-width="2.2"/></svg>';
  }

  /* ===== 每页自适应背景（信息密度低→背景丰富 / 密度高→克制） ===== */
  function bgCover() {
    return '<div class="bg">' +
      '<div class="dline" style="top:29vh;--th:1vh;--lc:rgba(20,18,16,.2)"></div>' +
      '<div class="dline" style="top:39vh;--th:.5vh;--lc:rgba(217,58,18,.38)"></div>' +
      '<div class="dline" style="top:50vh;--th:.32vh;--lc:rgba(20,18,16,.24)"></div>' +
      '<div class="shard" style="left:-14vw;top:56vh;width:58vw;height:15vh;--sc:rgba(20,18,16,.06);clip-path:polygon(0 8%,100% 0,86% 96%,2% 100%)"></div>' +
      '<div class="orbit" style="right:-13vw;top:-9vh;width:74vh;height:74vh;--od:28s;--oc2:rgba(20,18,16,.32)"><i></i><i class="o2"></i></div>' +
      '<div class="pulse" style="left:17vw;bottom:15vh;width:16vh;height:16vh;--pc:rgba(217,58,18,.55);--pd:5.2s"></div>' +
      '<div class="pulse" style="left:13vw;bottom:11vh;width:28vh;height:28vh;--pc:rgba(30,86,176,.4);--pd:5.2s;--pl:-2.6s"></div>' +
      '<div class="arc" style="right:5vw;top:31vh;width:46vh;height:46vh;--ac:rgba(30,86,176,.5);--ad:26s"></div>' +
      '<div class="vstrip" style="top:22vh">QUANTIZATION SHOWCASE · 2026</div>' +
      '<div class="sline" style="left:-5vw;top:63vh;--lc:rgba(217,58,18,.4)"></div>' +
      '</div>';
  }
  function bgHead(p) {
    /* v3 分场景动效背景（公共=顶细线+左下点阵；动效集群放页边/缝隙，密度高页保持克制） */
    var base = '<div class="bg">' +
      '<div class="dline" style="top:5vh;--th:.4vh;--lc:rgba(20,18,16,.15)"></div>' +
      '<div class="dots" style="left:2vw;bottom:6.5vh;opacity:.3"></div>';
    if (p.n === 1) {   /* 海上风暴：三层海浪条沿 -18° 慢速漂移 + 大虚线轨道 + 黄昏双脉冲（云后太阳） */
      return base +
        '<div class="dstrip" style="top:26vh;--sc:rgba(30,86,176,.30);--h:1.5vh;--s1:3.2vw;--s2:5.4vw;--dd:26s;--dl:-3s"></div>' +
        '<div class="dstrip" style="top:45vh;--sc:rgba(30,86,176,.20);--h:1vh;--s1:2.2vw;--s2:4vw;--dd:38s;--dl:-17s"></div>' +
        '<div class="dstrip" style="top:70vh;--sc:rgba(30,86,176,.34);--h:2.1vh;--s1:4.4vw;--s2:7.2vw;--dd:19s;--dl:-9s"></div>' +
        '<div class="bring" style="left:-12vw;bottom:-6vh;width:44vh;height:44vh;--rc2:rgba(30,86,176,.32);--bd:150s"></div>' +
        '<div class="orbit" style="right:-10vw;top:2vh;width:42vh;height:42vh;--od:30s;--oc2:rgba(20,18,16,.26)"><i style="background:var(--p)"></i><i class="o2"></i></div>' +
        '<div class="pulse" style="right:23vw;top:6vh;width:20vh;height:20vh;--pc:rgba(217,58,18,.28);--pd:7s"></div>' +
        '<div class="pulse" style="right:20vw;top:3vh;width:26vh;height:26vh;--pc:rgba(30,86,176,.30);--pd:7s;--pl:-3.5s"></div>' +
        '<div class="sline" style="left:-5vw;top:90vh;--lc:rgba(20,18,16,.3)"></div>' +
        '</div>';
    }
    if (p.n === 2) {   /* 海龙卷：三层同心涡旋弧（双向旋转）+ 虚线漏斗轨道 + 碎屑条 + 闪烁数据方块 */
      return base +
        '<div class="arc" style="right:-9vw;top:14vh;width:48vh;height:48vh;--ac:var(--p);--ad:22s"></div>' +
        '<div class="arc rev" style="right:-3vw;top:20vh;width:36vh;height:36vh;--ac:rgba(20,18,16,.4);--ad:30s"></div>' +
        '<div class="arc" style="right:3vw;top:26vh;width:24vh;height:24vh;--ac:rgba(217,58,18,.55);--ad:16s"></div>' +
        '<div class="bring rev" style="right:-12vw;top:11vh;width:54vh;height:54vh;--rc2:rgba(15,138,122,.35);--bd:120s"></div>' +
        '<div class="dstrip" style="top:16vh;--sc:rgba(15,138,122,.42);--h:.8vh;--s1:1.8vw;--s2:3.2vw;--dd:12s;--dl:-2s"></div>' +
        '<div class="dstrip" style="top:32vh;--sc:rgba(20,18,16,.3);--h:1.3vh;--s1:3vw;--s2:5vw;--dd:16s;--dl:-8s"></div>' +
        '<div class="blksq" style="right:12.5vw;top:36vh"></div>' +
        '<div class="blksq" style="right:16.8vw;top:40.5vh;--bl:-1.1s"></div>' +
        '<div class="bring" style="left:-9vw;bottom:-8vh;width:30vh;height:30vh;--rc2:rgba(20,18,16,.14);--bd:150s"></div>' +
        '</div>';
    }
    /* 雷暴：四层陡角雨幕 + 锯齿闪电双重频闪（7s）+ 落点脉冲 + 风暴虚线轨道 + 数据方点列 */
    return base +
      '<div class="rain" style="top:14vh;--rc:rgba(20,18,16,.5);--rd:3.1s;--rl:0s"></div>' +
      '<div class="rain" style="top:40vh;--rc:rgba(85,70,200,.45);--rd:2.7s;--rl:-1.2s"></div>' +
      '<div class="rain" style="top:62vh;--rc:rgba(20,18,16,.36);--rd:3.6s;--rl:-2.1s"></div>' +
      '<div class="rain" style="top:82vh;--rc:rgba(85,70,200,.32);--rd:2.9s;--rl:-.6s"></div>' +
      '<div class="bolt" style="right:11vw;top:8vh"></div>' +
      '<div class="pulse" style="right:9.5vw;top:32vh;width:9vh;height:9vh;--pc:rgba(217,58,18,.55);--pd:7s;--pl:-2.73s"></div>' +
      '<div class="bring" style="right:-12vw;top:34vh;width:56vh;height:56vh;--rc2:rgba(85,70,200,.30);--bd:140s"></div>' +
      '<div class="shard" style="right:-8vw;bottom:6vh;width:34vw;height:11vh;--sc:rgba(20,18,16,.07);clip-path:polygon(0 20%,96% 0,100% 78%,4% 100%)"></div>' +
      '<div class="sqcol" style="right:3.4vw;bottom:7vh"><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div class="sline" style="left:-5vw;top:90vh;--lc:rgba(85,70,200,.4);animation-delay:-5s"></div>' +
      '</div>';
  }
  function bgVt(p) {
    var pi = p.n - 1;
    return '<div class="bg">' +
      '<div class="bignum">' + PNUM[pi] + '</div>' +
      '<div class="dline" style="top:15vh;--th:.5vh;--lc:rgba(217,58,18,.28)"></div>' +
      '<div class="dline" style="top:25vh;--th:.3vh;--lc:rgba(20,18,16,.2)"></div>' +
      '<div class="dline" style="top:80vh;--th:.35vh;--lc:rgba(20,18,16,.16)"></div>' +
      '<div class="orbit" style="right:-9vw;top:7vh;width:58vh;height:58vh;--od:32s"><i></i><i class="o2"></i></div>' +
      '<div class="arc" style="left:-6vw;bottom:3vh;width:30vh;height:30vh;--ac:var(--p);--ad:26s" class="arc rev"></div>' +
      '<div class="pulse" style="right:9vw;bottom:11vh;width:14vh;height:14vh;--pc:var(--p);--pd:5.5s"></div>' +
      '<div class="sline" style="right:1vw;top:34vh;width:19vw;--lc:rgba(20,18,16,.3);animation-delay:-5s"></div>' +
      '<div class="sline" style="left:2vw;bottom:13vh;width:15vw;--lc:rgba(217,58,18,.36);animation-delay:-9s"></div>' +
      '<div class="dots" style="right:2.5vw;bottom:7vh;opacity:.38"></div>' +
      '<div class="vstrip l" style="top:auto;bottom:11vh">TEST 0' + p.n + ' · ' + p.en + '</div>' +
      '</div>';
  }
  function bgSm() {
    return '<div class="bg">' +
      '<div class="dline" style="top:3.5vh;--th:.35vh;--lc:rgba(20,18,16,.17)"></div>' +
      '<div class="arc" style="left:-5vw;bottom:-6vh;width:22vh;height:22vh;--ac:rgba(217,58,18,.4);--ad:38s"></div>' +
      '<div class="dots" style="right:2vw;top:1.5vh;opacity:.35"></div>' +
      /* 断续斜条：沿 -18° 对角线自左下向右上方循环扫过（断点 = repeating 虚线段） */
      '<div class="dstrip" style="top:26vh;--sc:rgba(217,58,18,.4);--h:1.1vh;--s1:3.4vw;--s2:5.6vw;--dd:13s;--dl:-1s"></div>' +
      '<div class="dstrip" style="top:44vh;--sc:rgba(20,18,16,.28);--h:.5vh;--s1:2vw;--s2:3.6vw;--dd:17s;--dl:-8s"></div>' +
      '<div class="dstrip" style="top:58vh;--sc:rgba(217,58,18,.55);--h:.35vh;--s1:1.2vw;--s2:2.6vw;--dd:10s;--dl:-5s"></div>' +
      '<div class="dstrip" style="top:74vh;--sc:rgba(20,18,16,.1);--h:1.8vh;--s1:4.5vw;--s2:7.5vw;--dd:21s;--dl:-14s"></div>' +
      '<div class="dstrip" style="top:86vh;--sc:rgba(217,58,18,.32);--h:.6vh;--s1:2.6vw;--s2:3.8vw;--dd:15s;--dl:-11s"></div>' +
      '</div>';
  }
  function bgOx() {
    return '<div class="bg">' +
      '<div class="bring" style="left:50%;top:52%;margin-left:-47vh;margin-top:-47vh;width:94vh;height:94vh;--rc2:rgba(20,18,16,.16);--bd:150s"></div>' +
      '<div class="orbit" style="left:50%;top:52%;margin-left:-55vh;margin-top:-55vh;width:110vh;height:110vh;--od:46s"><i></i><i class="o2"></i></div>' +
      '<div class="arc" style="left:50%;top:52%;margin-left:-32vh;margin-top:-32vh;width:64vh;height:64vh;--ac:rgba(217,58,18,.45);--ad:28s"></div>' +
      '<div class="arc rev" style="left:50%;top:52%;margin-left:-20vh;margin-top:-20vh;width:40vh;height:40vh;--ac:rgba(20,18,16,.3);--ad:22s"></div>' +
      '<div class="dline" style="top:9vh;--th:.55vh;--lc:rgba(217,58,18,.38)"></div>' +
      '<div class="dline" style="top:84vh;--th:.38vh;--lc:rgba(20,18,16,.26)"></div>' +
      '<div class="pulse" style="right:15vw;top:17vh;width:12vh;height:12vh;--pc:rgba(217,58,18,.5);--pd:6s"></div>' +
      '<div class="dots" style="left:2vw;bottom:7vh;opacity:.32"></div>' +
      '<div class="dots" style="right:2vw;top:9vh;opacity:.28"></div>' +
      '</div>';
  }
  function bgFin() {
    return '<div class="bg">' +
      '<div class="finband"></div>' +
      '<div class="dline" style="top:9vh;--th:.6vh;--lc:rgba(217,58,18,.36)"></div>' +
      '<div class="dline" style="top:19vh;--th:.38vh;--lc:rgba(20,18,16,.26)"></div>' +
      '<div class="orbit" style="left:5vw;top:5vh;width:60vh;height:60vh;--od:30s;--oc2:rgba(20,18,16,.3)"><i></i><i class="o2"></i></div>' +
      '<div class="pulse" style="right:11vw;top:13vh;width:12vh;height:12vh;--pc:rgba(217,58,18,.55);--pd:5s"></div>' +
      '<div class="pulse" style="right:8vw;top:10vh;width:22vh;height:22vh;--pc:rgba(20,18,16,.25);--pd:5s;--pl:-2.5s"></div>' +
      '<div class="dots" style="right:14vw;top:5vh;opacity:.38"></div>' +
      '<div class="bring rev" style="left:-9vw;bottom:-10vh;width:32vh;height:32vh;--rc2:rgba(217,58,18,.35);--bd:110s"></div>' +
      '<div class="vstrip" style="top:30vh">THE END · 完</div>' +
      '</div>';
  }

  function coverHTML() {
    var env = ENV.map(function (e) { return '<div class="fx"><i>' + e[0] + '</i><b>' + e[1] + '</b></div>'; }).join(NL);
    var qcards = QORDER.map(function (qk) {
      var Q = QUANTS[qk];
      return '<div class="qc cv-qc fx"><div class="qc-h"><i class="qtag-sq"></i><b>' + Q.label + ' · ' + Q.name + '</b><span>' + Q.model + '</span></div>' +
        '<div class="qb"><i style="width:' + barw(qk) + '"></i></div>' +
        '<div class="qb-l"><span>显存占用 VRAM</span><b>' + Q.sizeGB.toFixed(1) + 'GB</b></div></div>';
    }).join(NL);
    var mx = "";
    for (var r = 1; r <= 3; r++) for (var c = 0; c < 3; c++) mx += '<i style="background:' + PHUE[r - 1] + ';border-color:' + PHUE[r - 1] + '"></i>';
    var legend = ["01 海上风暴", "02 海龙卷", "03 雷暴"].map(function (t, i) { return '<em style="--c:' + PHUE[i] + '">' + t + '</em>'; }).join("");
    return '<section class="slide cv" data-p="0">' +
      bgCover() +
      '<div class="cv-art"><div class="blk fx"></div><div class="ring rt fx"></div><div class="blk2 fx"></div></div><div class="diag"></div><div class="dots cv-dots"></div>' +
      '<div class="cv-l">' +
        '<div class="plate fx"><i></i>LLM × HTML → VIDEO · 动态网页</div>' +
        '<h1 class="fx">Qwen3.8-27B<i class="tred"></i></h1>' +
        '<div class="cv-sub fx">不同量化效果 · 直观展示对比</div>' +
        '<div class="cv-en fx">3 QUANTIZATIONS × 3 SCENES = 9 LIVE HTML WORLDS · 本地模型单轮生成 · 实机录屏</div>' +
        '<div class="cv-env">' + env + '</div>' +
        '<div class="cv-bot">' +
          '<div class="cv-mx fx"><div class="mx-t"><b>3 项目 × 3 量化 = 9 个动态场景</b><span>列 = 量化 A/B/C · 行 = 测试项目 01/02/03</span></div><div class="mx">' + mx + '</div><div class="mx-legend">' + legend + '</div></div>' +
          '<div class="cv-r2">' +
            '<div class="cv-go fx">按 <b>→</b> 进入 测试项目01 · 海上风暴 <span class="goarr">→</span></div>' +
            '<div class="cv-bgm fx" id="bgmchip" title="音乐 开/关（M）"><i></i>BGM · P5 空灵循环 <span class="st" id="bgmst">自动待开始</span></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="cv-r">' + qcards + '</div>' +
      xmarks() +
      '</section>';
  }

  function headHTML(p) {
    var pi = p.n - 1;
    var chips = [p.tech, p.form, p.dep].map(function (t) { return '<span class="chip">' + t + '</span>'; }).join(NL);
    var cards = QORDER.map(function (qk, qi) {
      var Q = QUANTS[qk], d = p.data[qk];
      return '<div class="qc fx' + (qi === 1 ? " mid" : "") + '">' +
        '<div class="qc-h"><i class="qtag-sq"></i><b>' + Q.name + '</b><span>' + Q.model + ' · ' + Q.sizeGB.toFixed(1) + 'GB</span></div>' +
        '<div class="qb"><i style="width:' + barw(qk) + '"></i></div>' +
        '<div class="qr"><i>输入</i><b>' + d.in + '</b><i>输出</i><b>' + d.out + '</b><i>KV Cache</i><b>' + d.kv + '</b><i>压缩次数</i><b class="' + (d.comp > 0 ? "rd" : "") + '">' + d.comp + ' 次</b></div>' +
        '</div>';
    }).join(NL);
    var durs = QORDER.map(function (qk) { return QUANTS[qk].tag + " " + p.data[qk].dur + "s"; }).join(" · ");
    var total = 0; QORDER.forEach(function (qk) { total += p.data[qk].dur; });
    return '<section class="slide hd" data-p="' + p.n + '">' +
      bgHead(p) +
      xmarks() +
      '<div class="ghost hd-ghost">' + PNUM[pi] + '</div>' +
      '<div class="hd-top"><div class="plate fx"><i></i>测试项目 ' + PNUM[pi] + ' · test0' + p.n + '</div><div class="chips fx">' + chips + '</div></div>' +
      '<div class="hd-main">' +
        '<div class="hd-l">' +
          '<div class="hd-title fx"><b>' + p.zh + '</b><span>' + p.en + '</span></div>' +
          '<div class="hd-sub fx">' + p.sub + '</div>' +
          '<div class="mot-wrap fx">' + mot(p) + '</div>' +
          '<div class="pb fx"><div class="pb-t">完整 PROMPT · 原样发送<span class="pb-hint">AUTO 滚动 · 滚轮可接管</span></div><div class="pb-b" data-prompt="' + p.n + '"></div></div>' +
        '</div>' +
        '<div class="hd-r"><div class="plate sm fx"><i></i>生成数据 DATA</div>' + cards +
          '<div class="hd-rec fx"><div class="hr-t">本段录像 · NEXT</div>' + QORDER.map(function (qk) { return '<div class="hr"><i></i><b>' + qfile(p, qk) + '</b><span>' + p.data[qk].dur + 's · 截取 ' + p.data[qk].cut + '</span></div>'; }).join(NL) + '</div></div>' +
      '</div>' +
      '<div class="hd-note fx"><i></i>下一节 · 三个量化各一段实机录像：<b>' + durs + '</b>（共 ' + total + 's）— 按 → 进入</div>' +
      '</section>';
  }

  function variantHTML(p, qk) {
    var pi = p.n - 1, Q = QUANTS[qk], d = p.data[qk];
    return '<section class="slide vt" data-p="' + p.n + '">' +
      bgVt(p) +
      xmarks() +
      '<div class="vnum"><b class="n1">' + PNUM[pi].charAt(0) + '</b><b class="n2">' + PNUM[pi].charAt(1) + '</b><span class="bar"></span></div>' +
      '<div class="vt-top"><div class="plate fx"><i></i>项目 ' + PNUM[pi] + ' · ' + p.zh + '</div>' +
        '<div class="vt-tr fx">' + mot(p) + '<div class="qtag"><b>' + Q.name + '</b><span>' + Q.model + ' · ' + Q.sizeGB.toFixed(1) + 'GB</span></div></div></div>' +
      '<div class="tc fx"><span class="rd"><i class="recdot"></i>REC</span> <span class="dim">·</span> <b>' + qfile(p, qk) + '</b> <span class="dim">·</span> ' + (d.res || "1280×720") + ' <span class="dim">·</span> H.264 <span class="dim">·</span> 截取 ' + d.cut + ' <span class="dim">·</span> 源 <b>' + d.src + '</b></div>' +
      '<div class="film fx" data-vid>' +
        '<video preload="auto" poster="' + qposter(p, qk) + '" src="' + qpath(p, qk) + '"></video>' +
        '<div class="vph"><div class="vph-t">待 录 制</div><div class="vph-p">' + qpath(p, qk) + '</div><div class="vph-h">将录像放到该路径（VID_ROOT 可改）后刷新页面</div></div>' +
        '<div class="vbtn">全屏播放 · P</div>' +
      '</div>' +
      '<div class="stats fx">' +
        '<div class="st"><i>输入</i><b>' + d.in + '</b></div>' +
        '<div class="st"><i>输出</i><b>' + d.out + '</b></div>' +
        '<div class="st"><i>KV CACHE</i><b>' + d.kv + '</b></div>' +
        '<div class="st"><i>压缩</i><b>' + d.comp + ' 次</b></div>' +
        '<div class="st rec"><i>片长</i><b>' + d.dur + 's</b></div>' +
        '<div class="st"><i>源文件</i><b>' + d.src + '</b></div>' +
      '</div>' +
      '</section>';
  }

  function summaryHTML() {
    var heads = QORDER.map(function (qk) {
      var Q = QUANTS[qk];
      return '<div class="sm-h"><b>' + Q.name + '</b><span>' + Q.model + ' · ' + Q.sizeGB.toFixed(1) + 'GB</span><div class="qb"><i style="width:' + barw(qk) + '"></i></div></div>';
    }).join(NL);
    var body = "";
    PROJECTS.forEach(function (p, pi) {
      body += '<div class="sm-rowlab"><div class="rl"><i class="sq" style="background:' + PHUE[pi] + ';border-color:' + PHUE[pi] + '"></i><b>test0' + p.n + '</b></div><span>' + p.tech + ' · ' + p.form + '</span></div>';
      QORDER.forEach(function (qk) {
        var d = p.data[qk];
        body += '<div class="sm-c" style="--rc:' + PHUE[pi] + '"><video muted loop autoplay preload="auto" poster="' + qposter(p, qk) + '" src="' + qpath(p, qk) + '"></video><div class="strip"><b class="' + (d.comp > 0 ? "rd" : "") + '">压缩 ' + d.comp + ' 次</b><span>in ' + d.in + ' / out ' + d.out + ' · ' + d.dur + 's</span></div></div>';
      });
    });
    var tot = '<div></div>' + QORDER.map(function (qk) {
      var Q = QUANTS[qk];
      return '<div class="sm-tc"><i>' + Q.name + ' 合计</i><span>输入</span><b>' + Q.tin + '</b><span>输出</span><b class="rd">' + Q.tout + '</b><span>压缩</span><b>' + Q.tcomp + ' 次</b></div>';
    }).join(NL);
    return '<section class="slide sm" data-p="0">' +
      bgSm() +
      xmarks() +
      '<div class="sm-top"><div class="plate fx"><i></i>总结对比 SUMMARY</div><h2 class="fx">三项目 × 三量化</h2></div>' +
      '<div class="sm-grid"><div></div>' + heads + body + tot + '</div>' +
      '<div class="sm-note fx"><span>观察：<b>NVFP4</b> 总输出最高（485.7K）且压缩 3 次仍稳定；<b>Q5</b> 总输入最低（14.8M）；<b>Q4</b> 在 test2 消耗最大（10.2M）。量化档位与场景复杂度共同决定生成行为与压缩触发，完整数据见 docs/规划.txt。</span></div>' +
      '</section>';
  }

  function drumHTML() {
    var faces = OTHER.map(function (o, i) {
      return '<div class="face">' +
        '<div class="face-frame" data-ox>' +
          '<video muted loop autoplay preload="auto" src="' + VID_ROOT + o.file + '"></video>' +
          '<div class="face-shade"></div>' +
          '<div class="face-ph"><div class="fn">0' + (i + 1) + '</div><div class="ft">' + o.t + '</div><div class="fsub">' + o.sub + ' · ' + o.dur + '</div><div class="fp">' + o.file + '</div><div class="fh">放入同名文件即自动显示</div></div>' +
          '<div class="face-plate"><span><i></i>' + o.t + ' · ' + o.sub + '</span><span>' + o.file + '</span></div>' +
        '</div></div>';
    }).join(NL);
    return '<section class="slide ox" data-p="0">' +
      bgOx() +
      xmarks() +
      '<div class="ox-top"><div class="plate fx"><i></i>其他作品 · OTHER</div><h2 class="fx">滚筒轮播</h2><span class="ox-sub fx">4 PROJECTS · 3D BARREL · LOOP</span>' +
        '<div class="ox-deco fx"><span class="dr f"></span><span class="dr"></span><span class="dr"></span></div></div>' +
      '<div class="drum-stage fx"><div class="drum" id="drum">' + faces + '</div></div>' +
      '<div class="ox-hint fx"><i></i>悬停暂停旋转 · 点击空白翻页 · 4 段实机录像：gargantua ×2 · sea storm · sea sunset · 源 <b>clips/</b></div>' +
      '</section>';
  }

  function endHTML() {
    var CREDITS = [
      ["参 演", "Q5_K_XL · Q4_K_XL · NVFP4-MTP-Q8attn", "CAST", "cast"],
      ["网页制作", "Qwen3.8-27B-UD-Q5_K_XL", "WEB BUILD", ""],
      ["音 乐", "Qwen3.8-27B-UD-Q5_K_XL", "MUSIC", ""],
      ["数据分析 · 技术支持", "Qwen3.8-27B-UD-Q5_K_XL", "DATA & TECH", ""],
      ["风格监督", "我", "STYLE", "me"],
      ["视频录制", "我", "REC", "me"],
      ["总体规划", "我", "PLAN", "me"]
    ];
    var rows = CREDITS.map(function (c) {
      return '<div class="cr fx ' + c[3] + '"><i>' + c[0] + '</i><b>' + c[1] + '</b><span class="en">' + c[2] + '</span></div>';
    }).join(NL);
    return '<section class="slide fin" data-p="0">' +
      bgFin() +
      xmarks() +
      '<div class="fin-deco"></div>' +
      '<div class="fin-l">' +
        '<div class="fin-block fx"><b>完</b></div>' +
        '<div class="fin-plate plate fx"><i></i>THE END · 完</div>' +
        '<div class="fin-line fx"></div>' +
        '<div class="fin-tag fx">QWEN3.8-27B · QUANTIZATION SHOWCASE · 2026</div>' +
      '</div>' +
      '<div class="fin-r">' + rows + '</div>' +
      '<div class="fin-foot fx"><span>按 <b>→</b> 拉下灯绳落幕</span><span>·</span><span><b>Home</b> 回到封面</span><span>·</span><span><b>F</b> 全屏</span></div>' +
      '</section>';
  }

  var SLIDES = [];
  function addSlide(html, label, kind) {
    var el = document.createElement("div");
    el.innerHTML = html;
    var s = el.firstElementChild;
    stage.appendChild(s);
    SLIDES.push({ el: s, label: label, kind: kind || "" });
  }
  addSlide(coverHTML(), "封面 · 主题与配置");
  PROJECTS.forEach(function (p, pi) {
    addSlide(headHTML(p), "测试项目" + PNUM[pi] + " · 设定");
    QORDER.forEach(function (qk) {
      addSlide(variantHTML(p, qk), "测试项目" + PNUM[pi] + " · " + QUANTS[qk].name + " 录像");
    });
  });
  addSlide(summaryHTML(), "总结对比", "sm");
  addSlide(drumHTML(), "其他作品 · 滚筒轮播", "drum");
  addSlide(endHTML(), "结束 · 鸣谢");

  SLIDES.forEach(function (s) {
    var ph = s.el.querySelector("[data-prompt]");
    if (ph) ph.setAttribute("data-raw", document.getElementById("prompt-" + ph.getAttribute("data-prompt")).textContent.trim());
  });
  SLIDES.forEach(function (s) {
    var ph = s.el.querySelector("[data-prompt]");
    if (ph) renderPrompt(ph);
  });

  /* ===== 提示词代码块：行号 + 固定字号 + 手动滚动 ===== */
  function renderPrompt(el) {
    var lines = el.getAttribute("data-raw").split(NL);
    var html = "";
    for (var i = 0; i < lines.length; i++) {
      html += '<div class="pline"><span class="ln">' + (i + 1) + '</span><span class="pt">' + (lines[i] || "&nbsp;") + "</span></div>";
    }
    el.innerHTML = html;
  }
  window.addEventListener("resize", function () {});

  var idx = 0, busy = false;
  var hudc = document.getElementById("hudc"), idxEl = document.getElementById("idx"),
      prog = document.getElementById("prog").firstElementChild, track = document.getElementById("track");
  for (var t = 0; t < 10; t++) {
    var cell = document.createElement("i");
    cell.style.borderColor = (t < 9) ? PHUE[Math.floor(t / 3)] : "#d93a12";
    cell.style.color = (t < 9) ? PHUE[Math.floor(t / 3)] : "#d93a12";
    track.appendChild(cell);
  }
  var cells = track.children;
  function trackSlide(i) { return i < 9 ? (2 + Math.floor(i / 3) * 4 + (i % 3)) : 14; }
  /* ===== 自动导览（A 键 / ?auto=1）：圆形倒计时 → 自动翻页 =====
     驻留：轻页 4s、密页 9s、录像页 4s+片长、总结 10s、滚筒 4 面转一圈 30s+6s；
     倒计时视觉：每页空白处（逐页按布局选定）一个顺时针旋转的虚线圆（一圈 = 该页驻留时长），
     圆心为实心点、圆心正下方边缘为红点（外有灰细环）；P5R 配色：淡灰虚线（奶白衬底）+ 品红实线弧
     （黑色偏移阴影衬底），实线弧从红点起顺时针生长覆盖虚线边缘，实线闭合（转满一圈）瞬间自动翻页；
     任何手动翻页即退出自动（rAF 驱动，不依赖 WAAPI） */
  var AUTO_LOW = 4, AUTO_HIGH = 9, AUTO_VIDBASE = 4,
      AUTO_SM = 10, AUTO_DRUM_LAP = 30, AUTO_DRUM_PAD = 6;
  var AUTO_DUR = [AUTO_LOW];
  PROJECTS.forEach(function (p) {
    AUTO_DUR.push(AUTO_HIGH);
    QORDER.forEach(function (qk) { AUTO_DUR.push(AUTO_VIDBASE + p.data[qk].dur); });
  });
  AUTO_DUR.push(AUTO_SM, AUTO_DRUM_LAP + AUTO_DRUM_PAD, AUTO_LOW);

  /* 每页锚点中心（vw/vh 百分比）：按各页布局选定的不遮挡内容的空白区 */
  var AUTO_ANCHOR = [
    [45, 17.5],  /* 00 封面：主标题红方块右侧（× 标记位） */
    [41, 16],    /* 01 test01：标题行右侧、PROMPT 面板上方 */
    [69, 10],    /* 02 P1 录像：顶带、模型卡左侧 */
    [69, 10],    /* 03 */
    [69, 10],    /* 04 */
    [41, 16],    /* 05 test02：同 01 */
    [69, 10],    /* 06 P2 录像 */
    [69, 10],    /* 07 */
    [69, 10],    /* 08 */
    [41, 16],    /* 09 test03：同 01 */
    [69, 10],    /* 10 P3 录像 */
    [69, 10],    /* 11 */
    [69, 10],    /* 12 */
    [5.9, 16.9], /* 13 总结：test 标签 e/s 中间 × 红条 y 对齐 */
    [85.9, 5.9], /* 14 滚筒：菱标行左侧虚拟第 4 方块中心 */
    [50, 19.2]   /* 15 尾版：灯绳末端黑结处（× 标记位） */
  ];
  var AUTO_RVH = 2.9;   /* 倒计时圆半径（vh） */
  var P5RED = "#e0182e";             /* P5R 品红：实线弧 + 起点红点 */
  var DASHC = "rgba(20,18,16,0.45)"; /* 淡灰虚线（奶白底上清晰可辨） */
  var CREAM = "#f4efe3";             /* 虚线圆奶白衬底：压住背景纹样 */

  var autotEl = document.getElementById("autot");
  var autoOn = false, autoT = 0, autoAnim = null;
  function drawAutoGeo(i, D, t0) {
    var NS = "http://www.w3.org/2000/svg";
    if (autoAnim) { cancelAnimationFrame(autoAnim.raf); autoAnim = null; }
    var W = window.innerWidth, H = window.innerHeight;
    var an = AUTO_ANCHOR[i], cx = an[0] * W / 100, cy = an[1] * H / 100,
        r = AUTO_RVH * H / 100;
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    autotEl.innerHTML = "";
    autotEl.appendChild(svg);
    var C = 2 * Math.PI * r, seg12 = C / 12;
    var under = document.createElementNS(NS, "circle");  /* 奶白衬底：淡灰虚线在背景纹样上保持清晰 */
    under.setAttribute("cx", cx); under.setAttribute("cy", cy); under.setAttribute("r", r);
    under.setAttribute("fill", "none");
    under.setAttribute("stroke", CREAM);
    under.setAttribute("stroke-width", (Math.max(1.4, H * 0.0019) + 5).toFixed(1));
    under.setAttribute("opacity", "0.92");
    svg.appendChild(under);
    var dashG = document.createElementNS(NS, "g");   /* 虚线圆（整组顺时针旋转） */
    var dc = document.createElementNS(NS, "circle");
    dc.setAttribute("cx", cx); dc.setAttribute("cy", cy); dc.setAttribute("r", r);
    dc.setAttribute("fill", "none");
    dc.setAttribute("stroke", DASHC);
    dc.setAttribute("stroke-width", Math.max(1.4, H * 0.0019).toFixed(1));
    dc.setAttribute("stroke-dasharray", (seg12 * 0.6).toFixed(1) + " " + (seg12 * 0.4).toFixed(1));
    dashG.appendChild(dc);
    svg.appendChild(dashG);
    var arcW = Math.max(2.4, H * 0.0029);
    var arcShadow = document.createElementNS(NS, "path");  /* P5 黑色偏移阴影弧（衬底） */
    arcShadow.setAttribute("fill", "none");
    arcShadow.setAttribute("stroke", INK);
    arcShadow.setAttribute("stroke-width", (arcW * 1.9).toFixed(1));
    arcShadow.setAttribute("stroke-linecap", "square");
    arcShadow.setAttribute("transform", "translate(2.4 2.8)");
    arcShadow.setAttribute("opacity", "0.9");
    svg.appendChild(arcShadow);
    var arc = document.createElementNS(NS, "path");   /* 实线弧：P5 品红，自正下方顺时针生长 */
    arc.setAttribute("fill", "none");
    arc.setAttribute("stroke", P5RED);
    arc.setAttribute("stroke-width", arcW.toFixed(1));
    arc.setAttribute("stroke-linecap", "square");
    svg.appendChild(arc);
    var core = document.createElementNS(NS, "circle");   /* 圆心实心点 */
    core.setAttribute("cx", cx); core.setAttribute("cy", cy);
    core.setAttribute("r", Math.max(3, H * 0.0042).toFixed(1));
    core.setAttribute("fill", INK);
    svg.appendChild(core);
    var sr = Math.max(3.8, H * 0.0054);
    var ring = document.createElementNS(NS, "circle");   /* 正下方边缘红点 + 细环（灰） */
    ring.setAttribute("cx", cx); ring.setAttribute("cy", cy + r);
    ring.setAttribute("r", (sr * 1.55).toFixed(1));
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", DASHC);
    ring.setAttribute("stroke-width", "1.2");
    ring.setAttribute("opacity", "0.9");
    svg.appendChild(ring);
    var startShadow = document.createElementNS(NS, "circle");  /* 红点黑色偏移阴影（P5） */
    startShadow.setAttribute("cx", cx + 2.4); startShadow.setAttribute("cy", cy + r + 2.8);
    startShadow.setAttribute("r", sr.toFixed(1));
    startShadow.setAttribute("fill", INK);
    startShadow.setAttribute("opacity", "0.9");
    svg.appendChild(startShadow);
    var start = document.createElementNS(NS, "circle");
    start.setAttribute("cx", cx); start.setAttribute("cy", cy + r);
    start.setAttribute("r", sr.toFixed(1));
    start.setAttribute("fill", P5RED);
    svg.appendChild(start);
    autoAnim = {
      i: i, cx: cx, cy: cy, r: r, sr: sr,
      t0: t0 || performance.now(), Dms: Math.round(D * 1000),
      dashG: dashG, arc: arc, arcShadow: arcShadow, start: start, startShadow: startShadow,
      raf: requestAnimationFrame(tickAuto)
    };
  }
  function autoArcD(a, cx, cy, r) {
    /* a = 已扫过角度（deg，0 起自正下方、顺时针）→ 自下方红点到当前位置的弧路径 */
    var bx = cx, by = cy + r;
    if (a >= 359.9) {
      return "M " + bx + " " + by + " A " + r + " " + r + " 0 1 1 " + cx + " " + (cy - r) +
             " A " + r + " " + r + " 0 1 1 " + bx + " " + by;
    }
    var t = a * Math.PI / 180;
    var fx = cx - r * Math.sin(t), fy = cy + r * Math.cos(t);
    return "M " + bx + " " + by + " A " + r + " " + r + " 0 " + (a > 180 ? 1 : 0) +
           " 1 " + fx.toFixed(2) + " " + fy.toFixed(2);
  }
  function tickAuto() {
    if (!autoOn || !autoAnim) return;
    var t = performance.now() - autoAnim.t0, Dms = autoAnim.Dms;
    var p = t < Dms ? t / Dms : 1;
    var a = p * 360;
    autoAnim.dashG.setAttribute("transform", "rotate(" + a.toFixed(2) + " " + autoAnim.cx + " " + autoAnim.cy + ")");
    var ad = autoArcD(a, autoAnim.cx, autoAnim.cy, autoAnim.r);
    autoAnim.arc.setAttribute("d", ad);
    autoAnim.arcShadow.setAttribute("d", ad);
    /* 收尾 4%：红点（连同黑阴影）轻脉冲提示即将闭合 */
    var pr = (autoAnim.sr * (p > 0.96 ? 1 + 0.55 * Math.sin(Math.PI * (p - 0.96) / 0.04) : 1)).toFixed(1);
    autoAnim.start.setAttribute("r", pr);
    autoAnim.startShadow.setAttribute("r", pr);
    if (t < Dms) autoAnim.raf = requestAnimationFrame(tickAuto);
    else autoAnim = null;
  }
  window.addEventListener("resize", function () {
    if (autoOn && autoAnim) drawAutoGeo(autoAnim.i, autoAnim.Dms / 1000, autoAnim.t0);
  });
  function autoShow(i) {
    if (!autoOn) return;
    if (autoT) { clearTimeout(autoT); autoT = 0; }
    var D = AUTO_DUR[i];
    drawAutoGeo(i, D);
    autotEl.classList.add("on");
    autoT = setTimeout(autoAdvance, D * 1000);
  }
  function autoAdvance() {
    if (!autoOn) return;
    autoT = 0;
    if (idx >= SLIDES.length - 1) { autoStop(); return; }
    go(idx + 1);
  }
  function autoStart() {
    if (autoOn) return;
    autoOn = true;
    autoShow(idx);
  }
  function autoStop() {
    autoOn = false;
    if (autoT) { clearTimeout(autoT); autoT = 0; }
    if (autoAnim) { cancelAnimationFrame(autoAnim.raf); autoAnim = null; }
    autotEl.classList.remove("on");
    autotEl.innerHTML = "";
  }
  function toggleAuto() { autoOn ? autoStop() : autoStart(); }


  function showFx(s) {
    var fx = s.el.querySelectorAll(".fx");
    for (var i = 0; i < fx.length; i++) {
      (function (f, i) { setTimeout(function () { f.classList.add("on"); }, 90 + i * 60); })(fx[i], i);
    }
  }
  function hideFx(s) {
    var fx = s.el.querySelectorAll(".fx.on");
    for (var i = 0; i < fx.length; i++) fx[i].classList.remove("on");
  }
  function paint() {
    idxEl.textContent = ("0" + (idx + 1)).slice(-2) + " / 16";
    prog.style.width = ((idx + 1) / 16 * 100) + "%";
    hudc.textContent = SLIDES[idx].label;
    for (var i = 0; i < 10; i++) cells[i].classList.toggle("hit", trackSlide(i) <= idx);
  }

  function slideVideos(s) {
    /* 滚筒面 / 总结 9 宫格视频不在此列：它们从页面加载起就常驻循环，切页/后台都不中断 */
    var vs = s.el.querySelectorAll("video");
    var out = [];
    for (var i = 0; i < vs.length; i++) if (!vs[i].closest(".face-frame") && !vs[i].closest(".sm-c")) out.push(vs[i]);
    return out;
  }
  function pauseSlideVideos(s) { var vs = slideVideos(s); for (var i = 0; i < vs.length; i++) vs[i].pause(); }
  function playSlideVideos(s) { var vs = slideVideos(s); for (var i = 0; i < vs.length; i++) vs[i].play().catch(function () {}); }
  function seekVideo(s) {
    if (s.kind === "drum" || s.kind === "sm") return;
    var v = s.el.querySelector("video");
    if (!v) return;
    var st = 0;
    if (s.kindData && s.kindData.start) st = s.kindData.start;
    try { v.currentTime = st; } catch (e) {}
  }

  function slideColor(el) {
    var p = parseInt(el.getAttribute("data-p"), 10);
    return p >= 1 && p <= 3 ? PHUE[p - 1] : INK;
  }

  /* ===== v3 四向转场：右→左 ← / 下→上 ↑ / 左→右 →
     方向按目标页段（1-4: L · 5-8: U · 9-12: R · 13-15: U）；←键返回镜像；
     三个章节边界（进入 5 / 9 / 13，含反向跨章）改用马赛克幕（见 runMosaic） ===== */
  var WIPET = { in: [[.26, 0], [.28, .04], [.32, .08]], out: [[.22, 0], [.24, .03], [.28, .06]] };
  var WIPE_EASE = "cubic-bezier(.8,0,.2,1)";
  function segDir(n) { return n < 5 ? "L" : (n < 9 ? "U" : (n < 13 ? "R" : "U")); }
  function chapterCross(a, b) {
    return (a < 5) !== (b < 5) || (a < 9) !== (b < 9) || (a < 13) !== (b < 13);
  }
  /* 转场“起始偏移”（vw, vh）：马赛克块从该偏移处整体移回原位（L 前进=从右入，U 前进=从下入，反向镜像） */
  function wipeVec(dir, back) {
    if (dir === "U") return back ? [0, -115] : [0, 115];
    if (dir === "L") return back ? [-130, 0] : [130, 0];
    return back ? [130, 0] : [-130, 0];   /* R */
  }
  function runWipe(color, dir, back, phase) {
    wipe.style.setProperty("--wc", color);
    var axis = dir === "U" ? "y" : "x";
    wipe.classList.remove("ax-x", "ax-y", "flipx", "flipy");
    wipe.classList.add(axis === "y" ? "ax-y" : "ax-x");
    if (axis === "y" ? back : (dir === "L") !== back) wipe.classList.add(axis === "y" ? "flipy" : "flipx");
    var ws = wipe.children, T = WIPET[phase];
    var kf = phase === "in" ? (axis === "y" ? "wInY " : "wInX ") : (axis === "y" ? "wOutY " : "wOutX ");
    for (var i = 0; i < 3; i++) {
      ws[i].style.animation = "none"; void ws[i].offsetWidth;
      ws[i].style.animation = kf + T[i][0] + "s " + WIPE_EASE + " " + T[i][1] + "s forwards";
    }
  }

  /* ===== 章节边界马赛克幕：6 块不规则大色块（含一大圆，呼应 sample2 的 V4 徽章）沿方向向量错峰进出。
     静态拼缝由 3×2 网格 + 每块 26vw/26vh 外扩保证覆盖；jitter/裁剪/配色每次转场随机 ===== */
  var mos = document.getElementById("mosaic");
  var mosB = mos ? mos.children : [];
  var MOS_CLIP = [
    "polygon(0 0,100% 0,100% 100%,0 100%)",
    "polygon(3% 0,100% 4%,97% 100%,0 93%)",
    "polygon(0 5%,95% 0,100% 88%,4% 100%)",
    "polygon(6% 0,100% 0,94% 100%,0 100%)"
  ];
  function mosLay(color) {
    for (var i = 0; i < mosB.length; i++) {
      var b = mosB[i], c = Math.floor(i / 2), r = i % 2;
      b.style.left = (c * 40 + Math.random() * 10 - 5).toFixed(2) + "vw";
      b.style.top = (r * 54 + Math.random() * 8 - 4).toFixed(2) + "vh";
      if (i === 3) { b.style.width = "74vw"; b.style.height = "88vh"; b.style.borderRadius = "50%"; b.style.clipPath = "none"; }
      else {
        b.style.width = "66vw"; b.style.height = "80vh"; b.style.borderRadius = "0";
        b.style.clipPath = MOS_CLIP[Math.floor(Math.random() * MOS_CLIP.length)];
      }
      b.style.backgroundImage = (i === 2) ? "radial-gradient(rgba(244,239,227,.14) 1.2px,transparent 1.3px)" : "none";
      b.style.backgroundSize = (i === 2) ? "14px 14px" : "auto";
      b.style.backgroundColor = (i === 0 || i === 5) ? INK : (i === 1 || i === 4) ? color : (i === 2 ? INK : "#d93a12");
      b.style.animation = "none";
    }
  }
  function runMosaic(color, dir, back, phase) {
    var v = wipeVec(dir, back);
    mos.style.setProperty("--mx", v[0] + "vw");
    mos.style.setProperty("--my", v[1] + "vh");
    var D = phase === "in" ? [0, .05, .02, .09, .06, .03] : [.04, 0, .06, .02, .08, .05];
    var dur = phase === "in" ? .34 : .32;
    for (var i = 0; i < mosB.length; i++) {
      mosB[i].style.animation = "none"; void mosB[i].offsetWidth;
      mosB[i].style.animation = (phase === "in" ? "mIn " : "mOut ") + dur + "s cubic-bezier(.7,0,.25,1) " + D[i] + "s forwards";
    }
  }
  function mosaicOff() {
    if (!mos) return;
    mos.classList.remove("on");
    for (var i = 0; i < mosB.length; i++) mosB[i].style.animation = "none";
  }
  function go(n) {
    if (busy || n === idx || n < 0 || n >= SLIDES.length) return;
    if (fsFilm) exitFilmFS();
    busy = true;
    var back = n < idx;
    var cur = SLIDES[idx], nxt = SLIDES[n];
    var color = slideColor(nxt.el), dir = segDir(n);
    var swap = function () {
      pauseSlideVideos(cur);
      clearAutoPlay(cur);
      hideFx(cur);
      cur.el.classList.remove("on");
      nxt.el.classList.add("on");
      idx = n;
      showFx(nxt);
      paint();
      autoShow(idx);   /* 自动导览：新页起倒计时（仅 autoOn 时生效） */
      if (nxt.kind === "drum") {
        playSlideVideos(nxt);
        // canplay 是一次性事件，可能早于监听或漏发 → 显式检查 readyState + playing（每次起播都触发）
        var ffs = nxt.el.querySelectorAll(".face-frame");
        for (var k = 0; k < ffs.length; k++) {
          (function (ff) {
            var v = ff.querySelector("video");
            if (!v) return;
            function chk() { if (v.readyState >= 3) ff.classList.add("ok"); }
            v.addEventListener("playing", chk);
            chk();
          })(ffs[k]);
        }
      }
      else seekVideo(nxt);
      scheduleAutoPlay(nxt);
      var pb = nxt.el.querySelector(".pb-b");
      if (pb) ascStart(pb);
      else { asc.on = false; asc.el = null; }
      var isFin = n === SLIDES.length - 1;
      if (isFin) {
        if (curt.state === "done") curtainReset();
        cEl.classList.add("on");
        cEl.classList.toggle("clickable", curt.state === "idle");
      } else {
        cEl.classList.remove("on", "clickable");
        if (curt.state !== "idle") curtainReset();
      }
    };
    if (chapterCross(idx, n)) {
      /* 章节边界：马赛克幕（入 0.43s 铺满 → 450ms 换页 → 470ms 起散 → 950ms 解锁，节奏比板切更舒展） */
      mosLay(color);
      mos.classList.add("on");
      runMosaic(color, dir, back, "in");
      setTimeout(swap, 450);
      setTimeout(function () { runMosaic(color, dir, back, "out"); }, 470);
      setTimeout(function () { mosaicOff(); busy = false; }, 950);
    } else {
      runWipe(color, dir, back, "in");
      setTimeout(function () {
        swap();
        setTimeout(function () { runWipe(color, dir, back, "out"); }, 15);
        setTimeout(function () {
          var ws = wipe.children;
          for (var i = 0; i < ws.length; i++) ws[i].style.animation = "none";
          busy = false;
        }, 445);
      }, 350);
    }
  }

  SLIDES.forEach(function (s) {
    var film = s.el.querySelector(".film");
    s.film = film;
    if (film) {
      var v = film.querySelector("video");
      v.addEventListener("error", function () { film.classList.add("novideo"); });
      film.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (film.classList.contains("novideo") || fsExiting) return;
        if (fsFilm === film) exitFilmFaded();
        else { if (fsFilm) exitFilmFS(); enterFilmFS(film, s); }
      });
      v.addEventListener("ended", function () {
        if (fsFilm === film) exitFilmFaded();                          // 首播完：淡出全屏 → 原位续播（play 自动从头）
        else { v.currentTime = 0; v.play().catch(function () {}); }    // 原位循环（loop 属性已移除，便于感知首播结束）
      });
    }
    var ox = s.el.querySelector("[data-ox]");
    if (ox) {
      var ov = ox.querySelector("video");
      ov.addEventListener("canplay", function () { ox.classList.add("ok"); });
    }
  });

  /* ===== 滚筒：JS 驱动伪 3D（悬停暂停） ===== */
  var drum = document.getElementById("drum");
  var drumFaces = [];
  var dfl = drum.querySelectorAll(".face");
  for (var fi = 0; fi < dfl.length; fi++) {
    var df = dfl[fi];
    df._sh = df.querySelector(".face-shade");
    drumFaces.push(df);
  }
  /* 进入页面即开始循环：加载时就把 4 段全部起播（本地文件 preload=auto 已预载），
     且永不暂停（切到其他页也不中断） */
  for (var di = 0; di < drumFaces.length; di++) {
    var dv = drumFaces[di].querySelector("video");
    if (dv) dv.play().catch(function () {});
  }
  /* 总结 9 宫格的 9 段视频同样：加载即常驻循环，永不暂停（muted，多段同播不串音） */
  var smvs = document.querySelectorAll(".sm-c video");
  for (var smi = 0; smi < smvs.length; smi++) smvs[smi].play().catch(function () {});
  var oxAngle = 0, oxHover = false, oxLast = 0;
  var drumStage = drum.parentElement;
  drumStage.addEventListener("mouseenter", function () { oxHover = true; });
  drumStage.addEventListener("mouseleave", function () { oxHover = false; });
  (function oxTick(ts) {
    if (!oxLast) oxLast = ts;
    var dt = Math.min(0.05, (ts - oxLast) / 1000);
    oxLast = ts;
    if (!oxHover) oxAngle -= (360 / 30) * dt;
    if (oxAngle < -360) oxAngle += 360;
    for (var i = 0; i < drumFaces.length; i++) {
      var a = (oxAngle + i * 90) * Math.PI / 180;
      var c = Math.cos(a), s = Math.sin(a);
      var f = drumFaces[i];
      /* 背面不隐藏（隐藏会停掉该视频解码 → 转回来时卡顿/起步）：
         钳制到边缘态，始终留在绘制树里循环解码 */
      var cc = c < 0.03 ? 0.03 : c;
      var sc = 0.72 + 0.28 * cc;        // 整体缩放：正面 1.0 → 侧面 0.72
      var sx = 0.30 + 0.70 * cc;        // 横向压缩（近大远小的透视感）：正面 1.0 → 临边 0.30
      f.style.opacity = String(0.15 + 0.85 * Math.pow(cc, 1.6));
      f.style.zIndex = String(10 + Math.round(cc * 90));
      f.style.transform = "translateX(" + (s * 34).toFixed(2) + "vw) scale(" + sx.toFixed(3) + "," + sc.toFixed(3) + ")";
      if (f._sh) f._sh.style.opacity = (0.55 * (1 - cc)).toFixed(3);   // 侧面压暗
    }
    requestAnimationFrame(oxTick);
  })(0);

  /* ===== 提示词自动滚动（进入先停 1s，然后 5 行/秒；滚轮接管即停） ===== */
  /* 浮点位置在 JS 内累加（部分浏览器对 scrollTop 赋值截断为整数，逐帧小数会丢失） */
  var asc = { el: null, on: false, last: 0, pos: 0, wait: 0 };
  function ascTick(ts) {
    if (!asc.on || !asc.el) return;
    if (!asc.last) asc.last = ts;
    var dt = Math.min(0.1, (ts - asc.last) / 1000);
    asc.last = ts;
    if (asc.wait > 0) { asc.wait -= dt; requestAnimationFrame(ascTick); return; }
    var b = asc.el;
    if (!b.offsetParent) { requestAnimationFrame(ascTick); return; }
    var lh = parseFloat(getComputedStyle(b).lineHeight) || 28;
    var max = b.scrollHeight - b.clientHeight;
    asc.pos = Math.min(max, asc.pos + lh * 5 * dt);
    b.scrollTop = asc.pos;
    if (asc.pos >= max - 1) { asc.on = false; return; }
    requestAnimationFrame(ascTick);
  }
  function ascStart(b) {
    asc.on = false; asc.el = null; asc.last = 0; asc.pos = 0;
    if (b.scrollHeight <= b.clientHeight + 2) return;
    b.scrollTop = 0;
    asc.wait = 1;
    asc.el = b; asc.on = true;
    requestAnimationFrame(ascTick);
  }
  document.addEventListener("wheel", function (ev) {
    if (ev.target && ev.target.closest && ev.target.closest(".pb-b")) { asc.on = false; asc.el = null; }
  }, true);

  /* ===== 落幕：拉灯绳（P5R 斗篷式） =====
     灯绳从画面中央垂下，拉动后幕布自上而下垂落：上黑、下红、中间渐变；
     幕布下缘带被拉扯的 U 形弧度 + 行进波纹；落满后红带褪为纯黑。 */
  var curt = { state: "idle", t: 0, last: 0, jolted: false, dirty: true };
  var cEl = document.getElementById("curtain");
  var cPath = document.getElementById("cPath");
  var cClipPath = document.getElementById("cClipPath");
  var cEdge = document.getElementById("cEdge");
  var cEdgeGlow = document.getElementById("cEdgeGlow");
  var cRope = document.getElementById("cRope");
  var cRopeShade = document.getElementById("cRopeShade");
  var cKnot = document.getElementById("cKnot");
  var cStage = document.getElementById("stage");
  var cStops = [0, 1, 2, 3, 4, 5].map(function (i) { return document.getElementById("cs" + i); });
  var C_BASE = [[0,0,0],[6,4,4],[28,9,6],[92,19,12],[168,30,18],[230,50,28]];
  // 幕布竖向褶皱（低透明度，被 cClip 裁到幕布内）
  (function () {
    var s = "";
    for (var x = 4; x < 160; x += 8) s += '<line x1="' + x + '" y1="-2" x2="' + x + '" y2="92" stroke="rgba(0,0,0,.30)" stroke-width="1.1"/>';
    for (var x2 = 8; x2 < 160; x2 += 8) s += '<line x1="' + x2 + '" y1="-2" x2="' + x2 + '" y2="92" stroke="rgba(255,255,255,.045)" stroke-width=".4"/>';
    document.getElementById("cFolds").innerHTML = s;
  })();
  function cLerp(a, b, t) { return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; }
  function cCss(c) { return "rgb(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + ")"; }
  function cEdgeY(x, u, sag, amp, ph) {
    return u - sag * (1 - Math.sin(Math.PI * x / 160)) + amp * Math.sin(x / 160 * 6 * Math.PI + ph);
  }
  function cBuildFill(u, sag, amp, ph) {
    var d = "M0 0H160V" + cEdgeY(160, u, sag, amp, ph).toFixed(2);
    for (var x = 158; x >= 0; x -= 2) d += "L" + x + " " + cEdgeY(x, u, sag, amp, ph).toFixed(2);
    return d + "Z";
  }
  function cBuildEdge(u, sag, amp, ph) {
    var d = "M160 " + cEdgeY(160, u, sag, amp, ph).toFixed(2);
    for (var x = 158; x >= 0; x -= 2) d += "L" + x + " " + cEdgeY(x, u, sag, amp, ph).toFixed(2);
    return d;
  }
  function cDrawRope(tipX, tip, bow, op) {
    var d = "M80 0Q" + (80 + bow).toFixed(2) + " " + (tip * 0.45).toFixed(2) + " " + tipX.toFixed(2) + " " + tip.toFixed(2);
    cRope.setAttribute("d", d);
    cRope.setAttribute("opacity", op);
    cRopeShade.setAttribute("d", d);
    cRopeShade.setAttribute("opacity", op);
    var k = tip + 1.2;
    cKnot.setAttribute("d", "M" + tipX.toFixed(2) + " " + (tip - 0.3).toFixed(2) + "L" + (tipX + 1).toFixed(2) + " " + k.toFixed(2) +
      "L" + tipX.toFixed(2) + " " + (tip + 2.7).toFixed(2) + "L" + (tipX - 1).toFixed(2) + " " + k.toFixed(2) + "Z");
    cKnot.setAttribute("opacity", op);
  }
  function curtainReset() {
    curt.state = "idle"; curt.t = 0; curt.jolted = false; curt.dirty = true;
    for (var i = 0; i < cStops.length; i++) cStops[i].setAttribute("stop-color", cCss(C_BASE[i]));
    cEdge.setAttribute("opacity", "0.9");
    cEdgeGlow.setAttribute("opacity", "0.55");
    cEl.classList.toggle("clickable", cEl.classList.contains("on"));
  }
  function curtainPull() {
    if (curt.state !== "idle") return;
    curt.state = "pull"; curt.t = 0; curt.jolted = false; curt.dirty = true;
    cEl.classList.remove("clickable");
  }
  (function cTick(ts) {
    if (!curt.last) curt.last = ts;
    var dt = Math.min(0.05, (ts - curt.last) / 1000);
    curt.last = ts;
    if (curt.state === "done" && !curt.dirty) { requestAnimationFrame(cTick); return; }
    curt.t += dt;
    var t = curt.t;
    if (curt.state === "idle") {
      var sw = Math.sin(t * 1.3);
      cPath.setAttribute("d", ""); cClipPath.setAttribute("d", "");
      cEdge.setAttribute("d", ""); cEdgeGlow.setAttribute("d", "");
      cDrawRope(80 + sw * 0.9, 16 + Math.sin(t * 1.3 + 0.8) * 0.4, sw * 1.1, 1);
      requestAnimationFrame(cTick); return;
    }
    var u, sag, amp, ph, tipX = 80, bow = 0, dark = 0;
    if (curt.state === "pull") {
      var p = Math.min(1, t / 1.5);
      var e = 1 - Math.pow(1 - p, 2.4);
      u = 16 + (93 - 16) * e;
      sag = 9 * (1 - e) + 1.1;
      amp = 1.7 * (1 - e) + 0.3;
      ph = t * 11;
      tipX = 80 + Math.sin(t * 22) * 0.5 * (1 - e);
      bow = Math.sin(t * 18) * 0.6 * (1 - e);
      if (p >= 1) {
        curt.state = "settle"; curt.t = 0;
        if (!curt.jolted) { curt.jolted = true; cStage.classList.remove("jolt"); void cStage.offsetWidth; cStage.classList.add("jolt"); }
      }
    } else if (curt.state === "settle") {
      u = 93; sag = 1.1; amp = 1.6 * Math.exp(-4 * t) + 0.25; ph = t * 11;
      if (t > 0.35) { curt.state = "dark"; curt.t = 0; }
    } else if (curt.state === "dark") {
      u = 93; sag = 1.1; amp = 0.25; ph = 0;
      dark = Math.min(1, t / 0.8);
      if (dark >= 1) { curt.state = "done"; curt.dirty = false; }
    }
    if (u > 0.5) {
      var df = cBuildFill(u, sag, amp, ph);
      cPath.setAttribute("d", df);
      cClipPath.setAttribute("d", df);
      var de = cBuildEdge(u, sag, amp, ph);
      cEdge.setAttribute("d", de);
      cEdgeGlow.setAttribute("d", de);
      cEdge.setAttribute("opacity", (0.9 * (1 - dark)).toFixed(3));
      cEdgeGlow.setAttribute("opacity", (0.55 * (1 - dark)).toFixed(3));
    }
    if (dark > 0) {
      for (var i = 0; i < cStops.length; i++) cStops[i].setAttribute("stop-color", cCss(cLerp(C_BASE[i], [0,0,0], dark)));
    }
    if (curt.state === "done") {
      cDrawRope(80, 16, 0, 0);
    } else {
      cDrawRope(tipX, u, bow, 1);
    }
    requestAnimationFrame(cTick);
  })(0);
  cEl.addEventListener("click", function () {
    if (curt.state === "idle") curtainPull();
    else if (curt.state === "done") curtainReset();
  });

  // ===== 音乐 =====
  var bgm = document.getElementById("bgm");
  var mbtn = document.getElementById("mbtn");
  var bgmst = document.getElementById("bgmst");
  var mstate = "auto";
  function paintMusic() {
    mbtn.classList.toggle("on", mstate === "on");
    if (bgmst) bgmst.textContent = mstate === "on" ? "播放中" : (mstate === "off" ? "已关 · M 开启" : "自动 · 任意键开始");
  }
  function setMusic(on) {
    mstate = on ? "on" : "off";
    if (on) bgm.play().catch(function () { mstate = "off"; });
    else bgm.pause();
    paintMusic();
  }
  bgm.addEventListener("play", function () { mstate = "on"; paintMusic(); });
  bgm.addEventListener("pause", function () { if (mstate !== "auto") { mstate = "off"; paintMusic(); } });
  mbtn.addEventListener("click", function (ev) { ev.stopPropagation(); setMusic(mstate !== "on"); });
  var chip = document.getElementById("bgmchip");
  if (chip) chip.addEventListener("click", function (ev) { ev.stopPropagation(); setMusic(mstate !== "on"); });
  paintMusic();
  function firstTouch() { if (mstate === "auto") setMusic(true); }
  document.addEventListener("keydown", firstTouch, true);
  document.addEventListener("pointerdown", firstTouch, true);

  stage.addEventListener("click", function (ev) {
    if (ev.target.closest(".film") || ev.target.closest("#mbtn") || ev.target.closest("#bgmchip")) return;
    go(idx + 1);
  });

  /* F：假全屏 = 纯净模式（隐藏底栏 + 隐藏鼠标，等同 ?clean=1 开关）。
     不走浏览器 Fullscreen API → 不会出现"按 Esc 退出全屏"提示条 */
  function toggleFS() {
    var on = !document.documentElement.classList.contains("clean");
    document.documentElement.classList.toggle("clean", on);
    hud.style.display = on ? "none" : "";
  }
  /* 录像页自动播放 + 自动全屏：切页到位后排程，2s 后原位起播；
     第 3s（起播后 1s）自动进假全屏；第一次播放结束即退出全屏、原位继续循环；
     提前离开该页（或手动进全屏）即取消，不会在隐藏页起播 */
  function clearAutoPlay(s) {
    if (!s) return;
    if (s._apt) { clearTimeout(s._apt); s._apt = null; }
    if (s._fst) { clearTimeout(s._fst); s._fst = null; }
  }
  function scheduleAutoPlay(s) {
    clearAutoPlay(s);
    if (!s || !s.film || s.film.classList.contains("novideo")) return;
    s._apt = setTimeout(function () {
      s._apt = null;
      if (fsFilm) return;                        // 已在全屏：播放由全屏路径接管
      var v = s.film.querySelector("video");
      if (v && v.paused) v.play().catch(function () {});
    }, 2000);
    s._fst = setTimeout(function () {
      s._fst = null;
      if (fsFilm || SLIDES[idx] !== s) return;   // 已在全屏 / 已离开该页
      enterFilmFS(s.film, s);
    }, 3000);
  }

  /* 假全屏：视频铺满视口（不走浏览器 Fullscreen API → 无 Esc 提示条）
     现代 Chromium 中 position:fixed 会建立堆叠上下文，#stage（fixed）把整个
     幻灯片子树的 z-index 锁死在其层级内，压不过 #hud（z:50）——
     所以全屏时把 film 移到 body 下参与根级堆叠，退出时还原。
     进入走 fsIn 转场（淡入+轻微放大）；视频结束或手动退出走 fsOut（淡出回幻灯片）；
     全屏期间原位留 .film-ghost 占位，录像页版式不塌陷。 */
  var fsFilm = null, fsFilmParent = null, fsFilmNext = null, fsGhost = null, fsExiting = false, fsExitT = 0;
  function enterFilmFS(film, s) {
    clearAutoPlay(s);
    fsGhost = document.createElement("div");
    fsGhost.className = "film-ghost";
    fsFilmParent = film.parentElement;
    fsFilmNext = film.nextSibling;
    fsFilmParent.insertBefore(fsGhost, film);
    document.body.appendChild(film);
    void film.offsetWidth;                       // 先以全屏位就位，再跑进入转场
    film.classList.add("fsplay");
    fsFilm = film;
    var v = film.querySelector("video");
    if (v) {
      if (v.ended || (isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.06)) {
        try { v.currentTime = 0; } catch (e) {}  // 已播完则从头重播
      }
      v.play().catch(function () {});
    }
  }
  function exitFilmFS() {
    if (fsExitT) { clearTimeout(fsExitT); fsExitT = 0; }
    fsExiting = false;
    if (!fsFilm) return;
    var film = fsFilm, v = film.querySelector("video");
    fsFilm = null;
    film.classList.remove("fsplay", "fs-exit");
    if (fsGhost) { fsGhost.remove(); fsGhost = null; }
    if (fsFilmParent) fsFilmParent.insertBefore(film, fsFilmNext);
    fsFilmParent = null; fsFilmNext = null;
    if (v) v.pause();
  }
  /* 淡出退出（fsOut 0.52s 交叉回幻灯片）：视频结束 / 点击 / Esc 共用 */
  function exitFilmFaded() {
    if (!fsFilm || fsExiting) return;
    fsExiting = true;
    fsFilm.classList.add("fs-exit");
    fsExitT = setTimeout(function () {
      fsExitT = 0;
      var film = fsFilm, v = film ? film.querySelector("video") : null;
      exitFilmFS();
      if (v && SLIDES[idx].film === film) v.play().catch(function () {});  // 仍在本页则续上循环播放
    }, 540);
  }
  function playFilm() {
    if (fsExiting) return;
    var s = SLIDES[idx];
    var film = s.film;
    if (!film || film.classList.contains("novideo")) return;
    if (fsFilm === film) { exitFilmFaded(); return; }
    if (fsFilm) exitFilmFS();
    enterFilmFS(film, s);
  }

  document.addEventListener("keydown", function (ev) {
    var navKey = ev.key === "ArrowRight" || ev.key === " " || ev.key === "PageDown" || ev.key === "Enter" ||
      ev.key === "ArrowLeft" || ev.key === "PageUp" || ev.key === "Home" || ev.key === "End" ||
      ev.key === "0" || (ev.key >= "1" && ev.key <= "9");
    if (navKey && autoOn) autoStop();   /* 手动翻页 → 退出自动导览 */
    if (ev.key === "ArrowRight" || ev.key === " " || ev.key === "PageDown" || ev.key === "Enter") {
      ev.preventDefault();
      if (idx === SLIDES.length - 1) {
        if (curt.state === "idle") curtainPull();
        else if (curt.state === "done") curtainReset();
        return;
      }
      go(idx + 1);
    }
    else if (ev.key === "ArrowLeft" || ev.key === "PageUp") {
      ev.preventDefault();
      if (idx === SLIDES.length - 1 && curt.state === "done") { curtainReset(); return; }
      go(idx - 1);
    }
    else if (ev.key === "Home") { ev.preventDefault(); go(0); }
    else if (ev.key === "End") { ev.preventDefault(); go(SLIDES.length - 1); }
    else if (ev.key === "f" || ev.key === "F") { ev.preventDefault(); toggleFS(); }
    else if (ev.key === "p" || ev.key === "P") { ev.preventDefault(); playFilm(); }
    else if (ev.key === "Escape") {
      if (idx === SLIDES.length - 1 && curt.state === "done") { ev.preventDefault(); curtainReset(); }
      else if (fsFilm) { ev.preventDefault(); exitFilmFaded(); }
    }
    else if (ev.key === "m" || ev.key === "M") { ev.preventDefault(); setMusic(mstate !== "on"); }
    else if (ev.key === "a" || ev.key === "A") { ev.preventDefault(); toggleAuto(); }
    else if (ev.key === "0") { ev.preventDefault(); go(14); }
    else if (ev.key >= "1" && ev.key <= "9") {
      var k = parseInt(ev.key, 10) - 1;
      go(2 + Math.floor(k / 3) * 4 + (k % 3));
    }
  });

  window.__dsh_go = go;
  window.__dsh_idx = function () { return idx; };
  window.__dsh_auto = toggleAuto;
  window.__dsh_autoOn = function () { return autoOn; };
  SLIDES[0].el.classList.add("on");
  showFx(SLIDES[0]);
  paint();
  var sp = location.search.match(/[?&]s=(\d+)/);
  if (sp) go(Math.min(SLIDES.length - 1, parseInt(sp[1], 10)));   /* ?s=N 直接跳页（验证/截图用） */
  if (/auto=1/.test(location.search)) autoStart();   /* ?auto=1 加载即自动导览（录屏用） */
})();
