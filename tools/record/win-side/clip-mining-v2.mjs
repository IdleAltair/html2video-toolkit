// clip-mining-v2.mjs —— 找"放出来 5 秒内能让人啊一下"的实机镜头
// 只读：不在 meow-ai-arena 下写任何文件，不跑裁判/编译/GPU。逐文件流式处理，处理即释放。
// 输出：$WORKSPACE/arena-video/data/clip-candidates-v2.json
import fs from 'node:fs';
import path from 'node:path';

const ARENA = '//wsl.localhost/Ubuntu-22.04$HOME/deepseek-harness/workplace/meow-ai-arena';
const RUNS = path.join(ARENA, 'contestants', 'runs');
const OUT = '$WORKSPACE/arena-video/data/clip-candidates-v2.json';

const LAND_DIRS = [
  ['land-gui2/dbg/replay', '圈地 land-gui2/dbg/replay（正赛时段 15:47，duel 40×40）'],
  ['land-gui2/dbg/melee_base', '圈地 land-gui2/dbg/melee_base（22:00，melee 48×48）'],
  ['land-gui2/dbg/trace4', '圈地 land-gui2/dbg/trace4（22:22，melee 48×48）'],
];
const BOMB_LOCAL = path.join(RUNS, 'bomberman-gui1', 'replays');
const BOMB_CHALLENGE = [
  ['ctl-main-w7-105906', 'main 正赛交卷版'],
  ['ctl-ot-w7-110757', 'ot 加时终版'],
  ['ctl-ot-w2-111642', 'ot 加时终版(w2)'],
  ['20261003-183608', 'main 正赛交卷版（小样本）'],
];
const CTF_DIR = path.join(RUNS, 'ctf-gui1', 'replays');
// 纪律：land-gui1 整目录禁止进入，这里不枚举它。

const stats = { files_seen: 0, files_parsed: 0, files_skipped_not_self: 0, bomb_shortlisted: 0, bomb_deep_read: 0, mb_read: 0 };
const hits = [];
function addHit(h) {
  if (!h.path || h.turn == null || !h.what) return;
  h.surprise = surpriseScore(h);
  hits.push(h);
  if (hits.length > 4000) { hits.sort((a, b) => b.surprise - a.surprise); hits.length = 2500; }
}
function readJson(p) {
  const s = fs.readFileSync(p);
  stats.files_seen++; stats.mb_read += Math.round(s.length / 1048576 * 10) / 10;
  return JSON.parse(s.toString('utf8'));
}
const NB = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const md = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

// ============================================================  圈地
function analyzeLand(p, groupNote) {
  const d = readJson(p);
  const cfg = d.config || d.result.config || {};
  const W = cfg.width, H = cfg.height;
  const names = d.names || d.result.names;
  const selfIdx = names.map((n, i) => (/greedy|random|anchor/i.test(n) ? -1 : i)).filter(i => i >= 0);
  if (!selfIdx.length) { stats.files_skipped_not_self++; return; }
  stats.files_parsed++;
  const frames = d.frames || [];
  const spawns = d.spawns || [];
  const owner = new Int8Array(W * H).fill(-1);
  const init = d.initial_owner || '';
  for (let k = 0; k < W * H; k++) { const c = init[k]; if (c && c !== '.') owner[k] = c.charCodeAt(0) - 48; }
  const trails = names.map(() => new Set());
  const trailLen = new Int32Array(names.length);
  const area = new Int32Array(names.length);
  const recompute = () => { area.fill(0); for (let k = 0; k < W * H; k++) if (owner[k] >= 0) area[owner[k]]++; };
  recompute();
  let pos = spawns.map(s => [s[0], s[1]]);
  const deathsBy = names.map(() => []);
  const series = selfIdx.map(() => ({ mine: [], best: [] }));
  let sealedFired = 0;

  for (let fi = 0; fi < frames.length; fi++) {
    const fr = frames[fi];
    const turn = fi + 1;                        // 圈地 viewer 的回合号 = 帧序号
    for (const e of (fr.events || [])) {
      if (e.type === 'death' && selfIdx.includes(e.player)) {
        const tl = trailLen[e.player], myA = area[e.player], at = pos[e.player] || [0, 0];
        deathsBy[e.player].push({ turn, reason: e.reason, at: [at[0], at[1]], tl, myA });
        if (e.reason === 'self') {
          addHit({
            game: 'land', path: p, group: groupNote, kind: 'self-suicide',
            board: `${W}x${H}`, players: names.length, turns: frames.length, turn,
            what: `第 ${turn} 回合：它一脚踩进自己画的线里，当场阵亡、传送回出生点。踩线前它挂着 ${tl} 格没合拢的轨迹、${myA} 格领地。`,
            why: '画面里是小人一格一格画线、然后走进自己刚画的那条线上消失。',
            weights: { self: 11, contradiction: 11, visible: 10 }, extra: { trailLen: tl, at }
          });
        } else if (e.reason === 'wall') {
          addHit({
            game: 'land', path: p, group: groupNote, kind: 'wall-crash',
            board: `${W}x${H}`, players: names.length, turns: frames.length, turn,
            what: `第 ${turn} 回合：它朝棋盘外走，撞在边界上死了（手里 ${tl} 格轨迹、${myA} 格领地）。`,
            why: '大片空地上直线撞墙，观众看得懂它往哪走、为什么没了。',
            weights: { self: 8, visible: 9 }, extra: { at }
          });
        } else if (e.reason === 'head') {
          addHit({
            game: 'land', path: p, group: groupNote, kind: 'head-on',
            board: `${W}x${H}`, players: names.length, turns: frames.length, turn,
            what: `第 ${turn} 回合：它在 (${at[0]},${at[1]}) 和另一个小人对脸互撞（同格/换格对撞），两边同时死，${tl} 格轨迹全清。`,
            why: '两个小人迎头撞在一起同时消失，天然笑点。',
            weights: { visible: 8, contradiction: 5 }, extra: { at, trailLen: tl }
          });
        } else if (e.reason === 'cut' && tl >= 30) {
          addHit({
            game: 'land', path: p, group: groupNote, kind: 'long-line-cut',
            board: `${W}x${H}`, players: names.length, turns: frames.length, turn,
            what: `第 ${turn} 回合：它刚把线铺到第 ${tl} 格（在 (${at[0]},${at[1]})），这条长线被路上踩到，人直接回出生点，${tl} 格白画。`,
            why: '观众能看到一条越来越长的线，然后在某一格整条线突然消失、人闪回出生点——"忙一场"的可视化。',
            weights: { waste: 8, visible: 8 }, extra: { trailLen: tl, at, myArea: myA }
          });
        }
      }
      if (e.type === 'capture' && selfIdx.includes(e.player)) {
        const tl = trailLen[e.player];
        if (tl >= 40 && e.cells <= tl) {
          addHit({
            game: 'land', path: p, group: groupNote, kind: 'empty-loop',
            board: `${W}x${H}`, players: names.length, turns: frames.length, turn,
            what: `第 ${turn} 回合：它绕了 ${tl} 格终于把圈合上，结算 ${e.cells} 格——等于只把自己走过的线变成地，圈进来的新地是 ${Math.max(0, e.cells - tl)} 格。`,
            why: '画一大圈、观众等着大片变色，结果变色面积只等于那条线本身。',
            weights: { contradiction: 9, visible: 8 }, extra: { trailLen: tl, cells: e.cells }
          });
        } else if (e.cells === 0 && tl >= 12) {
          addHit({
            game: 'land', path: p, group: groupNote, kind: 'empty-loop',
            board: `${W}x${H}`, players: names.length, turns: frames.length, turn,
            what: `第 ${turn} 回合：它合拢了一个 ${tl} 格的圈，结算 0 格。`,
            why: '0 格结算条弹出来就是笑点。',
            weights: { contradiction: 8, visible: 8 }, extra: { trailLen: tl, cells: e.cells }
          });
        }
      }
    }

    if (fr.owner) for (const [k, o] of fr.owner) owner[k] = o;
    if (fr.trail_clear) for (const i of fr.trail_clear) { trails[i].clear(); trailLen[i] = 0; }
    if (fr.trail_add) for (const [i, k] of fr.trail_add) { trails[i].add(k); trailLen[i] = trails[i].size; }
    if (fr.pos) pos = fr.pos.map(x => [x[0], x[1]]);
    recompute();
    for (const s of selfIdx) {
      myAreaSeries.push(area[s]);
      bestOtherSeries.push(Math.max(...Array.from(area).map((v, i) => i === s ? -1 : v)));
    }
    if (trails[selfIdx[0]].size >= 8 && sealedFired < 2) {
      const [px, py] = pos[selfIdx[0]];
      let free = 0;
      for (const [dx, dy] of NB) { const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; if (!trails[selfIdx[0]].has(ny * W + nx)) free++; }
      if (free === 0) {
        sealedFired++;
        addHit({
          game: 'land', path: p, group: groupNote, kind: 'sealed-in',
          board: `${W}x${H}`, players: names.length, turns: frames.length, turn,
          what: `第 ${turn} 回合：它站的那一格四个方向全是自己刚砌的线或棋盘边界（${trails[selfIdx[0]].size} 格轨迹在手），下一步往哪走都是踩自己的线。`,
          why: '"自己把出口全封死"可以停帧讲：观众能数出四个方向都堵着。',
          weights: { self: 11, contradiction: 11, visible: 9 }, extra: { at: [px, py] }
        });
      }
    }
  }

  // 单回合面积跳水
  for (let t = 1; t < myAreaSeries.length; t++) {
    const drop = myAreaSeries[t] - myAreaSeries[t - 1];
    if (drop <= -40) {
      addHit({
        game: 'land', path: p, group: groupNote, kind: 'area-plunge',
        board: `${W}x${H}`, players: names.length, turns: frames.length, turn: t + 1,
        what: `第 ${t + 1} 回合：它的领地一回合掉 ${-drop} 格（${myAreaSeries[t - 1]}→${myAreaSeries[t]}），一整片颜色一帧换掉。`,
        why: '一帧之内大片变色，观众立刻知道出事了。',
        weights: { collapse: 8, visible: 8 }, extra: { from: myAreaSeries[t - 1], to: myAreaSeries[t] }
      });
    }
  }
  // 终盘
  const NN = myAreaSeries.length;
  if (NN > 30) {
    const myA = myAreaSeries[NN - 1], best = bestOtherSeries[NN - 1], margin = myA - best;
    let led = 0; for (let t = 0; t < NN; t++) if (myAreaSeries[t] >= bestOtherSeries[t]) led++;
    let flips = 0, prev = null;
    for (let t = Math.max(0, NN - 20); t < NN; t++) { const now = myAreaSeries[t] > bestOtherSeries[t]; if (prev != null && now !== prev) flips++; prev = now; }
    if (led / NN > 0.85 && margin < 0) addHit({
      game: 'land', path: p, group: groupNote, kind: 'choke',
      board: `${W}x${H}`, players: names.length, turns: frames.length, turn: NN,
      what: `终盘：它 ${Math.round(led / NN * 100)}% 的回合都在领先，最后 ${margin} 格输掉（${myA} vs ${best}）。`,
      why: '"赢定了"被反超。', weights: { terminal: 7, visible: 5 }, extra: { myA, best, margin }
    });
    if (Math.abs(margin) <= 3) addHit({
      game: 'land', path: p, group: groupNote, kind: 'one-cell',
      board: `${W}x${H}`, players: names.length, turns: frames.length, turn: NN,
      what: `终局差 ${margin >= 0 ? '+' : ''}${margin} 格（它 ${myA}，最强对手 ${best}）。`,
      why: '一格定胜负。', weights: { terminal: 6, visible: 6 }, extra: { myA, best, margin }
    });
    if (flips >= 2) addHit({
      game: 'land', path: p, group: groupNote, kind: 'last-flip',
      board: `${W}x${H}`, players: names.length, turns: frames.length, turn: NN,
      what: `最后 20 回合：领先权换了 ${flips} 次，终局 ${myA} vs ${best}。`,
      why: '终盘来回翻面。', weights: { terminal: 8, visible: 8 }, extra: { flips, margin }
    });
  }
  // 死亡密度窗口（一局里反复暴毙）
  for (const s of selfIdx) {
    const ds = deathsBy[s];
    if (ds.length < 3) continue;
    let best = { n: 0, from: 0, to: 0 };
    for (let a = 0; a < ds.length; a++) {
      let b = a;
      while (b < ds.length && ds[b].turn - ds[a].turn <= 80) b++;
      if (b - a > best.n) best = { n: b - a, from: ds[a].turn, to: ds[b - 1].turn };
    }
    const cells = {};
    for (const x of ds) cells[x.at.join(',')] = (cells[x.at[1] != null ? x.at.join(',') : ''] || 0) + 1;
    const hot = Object.entries(cells).sort((a, b) => b[1] - a[1])[0];
    if (best.n >= 4) {
      addHit({
        game: 'land', path: p, group: groupNote, kind: 'death-magnet',
        board: `${W}x${H}`, players: names.length, turns: frames.length, turn: best.from,
        what: `第 ${best.from}–${best.to} 回合（80 回合）它阵亡 ${best.n} 次，平均每 ${Math.round((best.to - best.from) / best.n * 10) / 10} 回合死一次；整局共死 ${ds.length} 次（${ds.map(x => x.turn).slice(0, 12).join('、')}${ds.length > 12 ? '…' : ''}），最常在 ${hot ? hot[0] : '?'} 附近这一带出事。`,
        why: '快放 80 回合 = 小人在场上反复暴毙、闪回出生点，5 秒内能看到好几次"啊？"，而且不需要解释分数。',
        weights: { repetition: 11, visible: 10, self: 6 },
        extra: { window: [best.from, best.to], n: best.n, total: ds.length, turns: ds.map(x => x.turn), hot }
      });
    }
  }
}

// ============================================================  炸弹人
function section(text, tag, prefix) {
  if (!text) return [];
  const lines = text.split('\n'); const out = []; let n = -1;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (L.startsWith(tag)) { n = parseInt(L.split(' ')[1] || '0', 10); continue; }
    if (n >= 0) { if (out.length < n) { if (L.startsWith(prefix)) out.push(L.trim()); else break; } else break; }
  }
  return out;
}
function crossSet(bx, by, radius, board) {
  const n = board.length, res = [bx + ',' + by];
  for (const [dx, dy] of NB) for (let r = 1; r <= radius; r++) {
    const x = bx + dx * r, y = by + dy * r;
    if (x < 0 || y < 0 || x >= n || y >= n) break;
    if (board[y][x] === '#') break;
    res.push(x + ',' + y);
    if (board[y][x] === '+') break;
  }
  return new Set(res);
}
function freeReachable(board, sx, sy, blockedSet) {
  const n = board.length, seen = new Set([sx + ',' + sy]), st = [[sx, sy]]; let c = 0;
  while (st.length) {
    const [x, y] = st.pop(); c++;
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n || seen.has(k)) continue;
      if (board[ny][nx] !== '.' || blockedSet.has(k)) continue;
      seen.add(k); st.push([nx, ny]);
    }
  }
  return c;
}

function analyzeBomb(p, groupNote, versionLabel) {
  const d = readJson(p);
  const res = d.result || {}; const names = res.names || [];
  const S = names.findIndex(n => n === 'Mine' || /你的\s*bot/.test(n));
  if (S < 0) { stats.files_skipped_not_self++; return; }
  stats.files_parsed++;
  const frames = d.frames || [];
  const cfg = res.config || {};
  const radius = cfg.radius ?? 3, fuse = cfg.fuse ?? 4, size = cfg.size ?? 13, players = cfg.players ?? 2;
  const boardTag = `${size}x${size}`;
  const win = res.ranks?.[S] === 1;
  const places = [];
  let selfTrapFired = 0, walkWallFired = 0;

  for (let fi = 0; fi < frames.length; fi++) {
    const fr = frames[fi];
    const board = fr.board || [];
    const evs = fr.events || [];
    const me = fr.players?.[S];
    const inText = fr.input_text || '';
    const seenTurn = inText ? parseInt((inText.match(/^TURN (\d+)/) || [0, fi - 1])[1], 10) : fi - 1;

    for (const e of evs) {
      if (e.type === 'place' && e.player === S) places.push({ turn: seenTurn, x: e.x, y: e.y, fi });
      if (e.type === 'blocked' && e.player === S) {
        let run = 1;
        for (let g = fi - 1; g >= 0 && g >= fi - 20; g--) {
          if ((frames[g].events || []).some(x => x.type === 'blocked' && x.player === S)) run++; else break;
        }
        if (run >= 6 && run % 6 === 0 && walkWallFired < 2) {
          walkWallFired++;
          addHit({
            game: 'bomb', path: p, group: groupNote, kind: 'walk-into-wall', version: versionLabel,
            board: boardTag, players, turns: frames.length, turn: seenTurn,
            what: `第 ${seenTurn} 回合：它已经连续 ${run} 个回合想往同一个方向走，每次都被判"走不动"（那一格是墙/箱子/别人的雷）。`,
            why: '一个小人对着一面墙反复顶，画面自己就好笑。',
            weights: { contradiction: 7, visible: 9 }, extra: { run, at: [me?.x, me?.y] }
          });
        }
      }
      if (e.type !== 'death' || e.player !== S) continue;
      const T = e.turn ?? (fi - 1);
      const reason = e.reason;
      const px = me.x, py = me.y;
      const prev = fi > 0 ? frames[fi - 1].players?.[S] : null;
      const flames = section(inText, 'FLAMES', 'F ').map(l => { const a = l.split(' '); return { x: +a[1], y: +a[2], expiry: +a[3], line: l }; });
      const liveFlames = flames.filter(f => f.expiry >= T);          // 这一步执行时还烧着的
      const listedFlames = flames;                                    // 文本里写给它的（含已过期的）
      const bombsTxt = section(inText, 'BOMBS', 'B ').map(l => { const a = l.split(' '); return { owner: +a[1], x: +a[2], y: +a[3], at: +a[4], line: l }; });

      // 哪些雷照到了它
      const hits = [];
      for (const b of evs.filter(x => x.type === 'explode')) {
        if (board[py] && crossSet(b.x, b.y, radius, board).has(px + ',' + py)) hits.push(b);
      }
      const owners = new Set(hits.map(b => b.player));
      const onlySelf = owners.size === 1 && owners.has(S);
      const killer = hits.find(b => b.player === S);
      const plant = killer ? places.slice().reverse().find(q => q.x === killer.x && q.y === killer.y && q.turn <= T + 1 && T - q.turn <= fuse + 2) : null;

      if (reason === 'blast' && onlySelf) {
        let escape = null, reach = null, plantTurn = null, bombXY = null;
        if (plant) {
          plantTurn = plant.turn; bombXY = [plant.x, plant.y];
          const bd = frames[plant.fi]?.board || board;
          const cross = crossSet(plant.x, plant.y, radius, bd);
          const bombCells = new Set((frames[plant.fi]?.bombs || []).map(b => b.x + ',' + b.y));
          bombCells.add(plant.x + ',' + plant.y);
          escape = NB.filter(([dx, dy]) => { const nx = plant.x + dx, ny = plant.y + dy; return bd[ny] && bd[ny][nx] === '.' && !cross.has(nx + ',' + ny) && !bombCells.has(nx + ',' + ny); }).length;
          reach = freeReachable(bd, plant.x, plant.y, bombCells);
        }
        const cellIdx = py * size + px, blindHalf = size * size > 312 && cellIdx >= 312;
        addHit({
          game: 'bomb', path: p, group: groupNote, kind: 'suicide', version: versionLabel,
          board: boardTag, players, turns: frames.length, turn: T,
          what: `第 ${T} 回合：这一回合能照到 (${px},${py}) 的雷只有它自己埋的那颗，它被自己的雷炸死。`
            + (plant ? ` 雷是第 ${plantTurn} 回合埋在 (${bombXY[0]},${bombXY[1]})、引信 ${fuse} 回合。` : '')
            + (escape === 0 ? ' 埋雷那一刻它四个出口全在这颗雷的爆炸范围里——放下去的瞬间就必死（自己封死唯一活路）。' : (escape === 1 ? ' 埋雷那一刻只有 1 个出口不在爆炸范围里，它没走出去。' : ''))
            + (blindHalf ? ` 死亡格 ${(py * size + px)} 号，在 25×25 盘的后半盘（火焰表只读到 312 号）。` : ''),
          why: '自己埋雷→原地绕几回合→自己被炸死，一条因果链全在画面里；escape=0 的话还能停帧指"四个出口全被自己的雷封了"。',
          weights: { self: 12 + (escape === 0 ? 2 : 0), contradiction: 12, visible: 10 },
          extra: { plantTurn, bombXY, escapeCells: escape, reach, deathCell: [px, py], blindHalf, points: res.points?.[S], rank: res.ranks?.[S] }
        });
      } else if (reason === 'blast' && owners.has(S) && owners.size > 1) {
        addHit({
          game: 'bomb', path: p, group: groupNote, kind: 'mutual-kill', version: versionLabel,
          board: boardTag, players, turns: frames.length, turn: T,
          what: `第 ${T} 回合：照死它的雷同时来自 ${[...owners].map(i => i + '号').join(' 和 ')}——它的雷也在里面，同归于尽。`,
          why: '一帧两团火同时铺开，自己也搭进去。',
          weights: { drama: 6, visible: 8 }, extra: { owners: [...owners], deathCell: [px, py] }
        });
      }
      if (reason === 'forfeit') {
        const diag = (res.diagnostics || []).filter(x => x.player === S)[0];
        addHit({
          game: 'bomb', path: p, group: groupNote, kind: 'forfeit-death', version: versionLabel,
          board: boardTag, players, turns: frames.length, turn: T,
          what: `第 ${T} 回合：它被判违规/超时直接抬走（reason=forfeit${diag ? `，第 ${diag.turn} 回合 ${diag.error}` : ''}），本局 ${res.points?.[S] ?? 0} 分${win ? '，但结算还是第 1' : ''}。`,
          why: '不是打得差，是连"出手"都没出手就被抬走。',
          weights: { early: 9, visible: 8, self: 5 },
          extra: { error: diag?.error, points: res.points?.[S], rank: res.ranks?.[S] }
        });
      }
      if (reason === 'shrink') {
        const c = (size - 1) / 2; let d0 = null, d1 = null;
        for (let g = Math.max(0, fi - 7); g <= fi; g++) { const pm = frames[g].players?.[S]; if (!pm) continue; const dd = md([pm.x, pm.y], [c, c]); if (d0 === null) d0 = dd; d1 = dd; }
        const trend = d1 - d0;
        addHit({
          game: 'bomb', path: p, group: groupNote, kind: 'shrink-death', version: versionLabel,
          board: boardTag, players, turns: frames.length, turn: T,
          what: `第 ${T} 回合：缩圈刚生成的那一圈墙正好压在它身上（reason=shrink，位置 (${px},${py})）。死前 7 回合它离中心${trend > 0 ? ` 又远了 ${trend} 格——它朝圈外走` : ` 近了 ${-trend} 格`}。`,
          why: '地图边缘一格格变墙、它站在正被关闭的那一侧，视觉上就是被墙吃掉。',
          weights: { self: trend > 0 ? 10 : 6, contradiction: trend > 0 ? 10 : 4, visible: 9 },
          extra: { trend, at: [px, py], points: res.points?.[S] }
        });
      }
      // 铁证：发给它的文本里明写着那一格有火 / 有雷，它还是把人放过去了
      if (inText && prev) {
        const destIsListed = listedFlames.filter(f => f.x === px && f.y === py);
        const movedIn = !(prev.x === px && prev.y === py);
        if (destIsListed.length) {
          const f = destIsListed[0];
          addHit({
            game: 'bomb', path: p, group: groupNote, kind: 'blind-flame', version: versionLabel,
            board: boardTag, players, turns: frames.length, turn: T,
            what: `第 ${T} 回合：它这一步从 (${prev.x},${prev.y}) 走到 (${px},${py})，而它做这个决定时收到的文本（TURN ${seenTurn}）FLAMES 段里就有「${f.line}」这一行${f.expiry >= T ? '（还在燃烧）' : `（过期回合 ${f.expiry}）`}，本回合它死于 ${reason}。`,
            why: '铁证型：左屏放"给它看的文本"，右屏放小人走进那格写着有火的地上，观众自己得出结论。',
            weights: { blindness: 12, visible: 10 },
            extra: { line: f.line, from: [prev.x, prev.y], to: [px, py], reason, stillLive: f.expiry >= T, blindHalf: size * size > 312 && (py * size + px) >= 312 }
          });
        }
        const onBomb = bombsTxt.find(b => b.x === px && b.y === py && b.at <= T);
        if (onBomb && reason === 'blast') {
          addHit({
            game: 'bomb', path: p, group: groupNote, kind: 'blind-bomb', version: versionLabel,
            board: boardTag, players, turns: frames.length, turn: T,
            what: `第 ${T} 回合：文本里有一行「${onBomb.line}」—— (${onBomb.x},${onBomb.y}) 这颗雷第 ${onBomb.at} 回合爆，而它这一步正好把自己放在那格上，随后被炸死。`,
            why: '引爆回合就写在那行字里，它照着走过去。',
            weights: { blindness: 10, visible: 10 }, extra: { line: onBomb.line, owner: onBomb.owner }
          });
        }
        // 它站在原地就已经在文本写着的火里
        const selfIsBurnt = liveFlames.filter(f => f.x === prev.x && f.y === prev.y);
        if (selfIsBurnt.length && !movedIn) {
          addHit({
            game: 'bomb', path: p, group: groupNote, kind: 'blind-flame-stay', version: versionLabel,
            board: boardTag, players, turns: frames.length, turn: T,
            what: `第 ${T} 回合：文本 FLAMES 段有「${selfIsBurnt[0].line}」，也就是它上一步已经站在火里（(${prev.x},${prev.y})），这一步它没离开，直接被烧死。`,
            why: '"站在火上不动"在画面上是零解释成本的荒诞。',
            weights: { blindness: 11, visible: 10 }, extra: { line: selfIsBurnt[0].line }
          });
        }
      }
    }

    // 一回合死 3 个以上，火源里有它的雷
    const deaths = evs.filter(e => e.type === 'death');
    if (deaths.length >= 3 && evs.some(e => e.type === 'explode' && e.player === S)) {
      addHit({
        game: 'bomb', path: p, group: groupNote, kind: 'chain-mass-kill', version: versionLabel,
        board: boardTag, players, turns: frames.length, turn: seenTurn,
        what: `第 ${seenTurn} 回合：它埋的雷（含连锁）当回合带走 ${deaths.length} 个：${deaths.map(x => `${x.player}号(${x.reason})`).join('、')}。`,
        why: '一帧炸一大片，火源是它埋的——"它做对了"的爽点。',
        weights: { drama: 9, visible: 10 }, extra: { deaths: deaths.length }
      });
    }
    // 被雷封成孤岛
    if (fi > 0 && fi % 4 === 0 && me?.alive && selfTrapFired < 2) {
      const bombCells = new Set((fr.bombs || []).map(b => b.x + ',' + b.y));
      if (bombCells.size >= 1) {
        const r = freeReachable(board, me.x, me.y, bombCells);
        if (r <= 1) {
          selfTrapFired++;
          addHit({
            game: 'bomb', path: p, group: groupNote, kind: 'self-trap', version: versionLabel,
            board: boardTag, players, turns: frames.length, turn: seenTurn,
            what: `第 ${seenTurn} 回合：场上 ${bombCells.size} 颗雷把它封得只剩脚下这 1 格能站，一步都动不了（它${res.players[S].death_turn != null && res.players[S].death_turn >= seenTurn ? '后来就是这么死的' : '后来才脱身'}）。`,
            why: '十字火网把小人钉死在一格里，是"自己把自己关起来"的定格。',
            weights: { self: 10, contradiction: 9, visible: 9 }, extra: { reachable: r, bombs: bombCells.size, at: [me.x, me.y] }
          });
        }
      }
    }
  }

  const dt = res.players?.[S]?.death_turn;
  const early = players >= 10 ? 14 : 10;
  if (dt != null && dt <= early) {
    addHit({
      game: 'bomb', path: p, group: groupNote, kind: 'flash-death', version: versionLabel,
      board: boardTag, players, turns: frames.length, turn: dt,
      what: `第 ${dt} 回合它已经出局（reason=${res.players[S].reason}），这局共 ${res.turns} 回合、${players} 个人、盘 ${size}×${size}。`,
      why: '开局极早就没了，观众来不及反应——最省解释成本的镜头。',
      weights: { early: players <= 4 ? 9 : 5, visible: players <= 4 ? 9 : 5 },
      extra: { reason: res.players[S].reason, points: res.points?.[S], rank: res.ranks?.[S] }
    });
  }
  if (win) {
    const pts = res.points?.[S] ?? 0;
    const others = res.points.filter((_, i) => i !== S);
    const second = others.length ? Math.max(...others) : 0;
    const margin = pts - second;
    const deadEarly = dt != null && dt < frames.length * 0.5;
    const suicide = res.players[S].reason === 'blast' && (res.kill_credit?.[S] ?? 0) === 0;
    if (deadEarly || suicide || margin <= 0.5 || (dt != null && (res.survivors || []).length === 0)) {
      addHit({
        game: 'bomb', path: p, group: groupNote, kind: 'weird-win', version: versionLabel,
        board: boardTag, players, turns: frames.length, turn: dt ?? frames.length - 1,
        what: `它拿第 1（${pts} 分，比第 2 多 ${Math.round(margin * 100) / 100}）`
          + (deadEarly ? `，但它第 ${dt} 回合就死了（reason=${res.players[S].reason}），后面 ${frames.length - 1 - dt} 个回合场上已经没有它的人，它是在"人早没了"的状态下赢的。` : suicide ? '，而且它是被自己雷炸死的（自炸），靠击杀分登顶。' : '，但它没活到最后。')
          + ` 终局存活：${(res.survivors || []).length ? res.survivors.join('#') : '无（所有人都死了）'}。`,
        why: '先死后赢：人早没了分数还最高，回放停在它死那一帧、比分条已经排好——比输更有节目效果。',
        weights: { win: 12, counterintuitive: 12, visible: 7 },
        extra: { points: pts, second, margin, death_turn: dt, reason: res.players[S].reason, survivors: res.survivors, kill_credit: res.kill_credit?.[S] }
      });
    }
  }
  if (frames.length >= 3) {
    const last = frames[frames.length - 1], prevF = frames[frames.length - 2];
    if (last.players && prevF.players) {
      const diedLast = last.players.map((x, i) => (!x.alive && prevF.players[i].alive) ? i : -1).filter(i => i >= 0);
      if (diedLast.length && (diedLast.includes(S) || win)) {
        addHit({
          game: 'bomb', path: p, group: groupNote, kind: 'final-turn', version: versionLabel,
          board: boardTag, players, turns: frames.length, turn: frames.length - 2,
          what: `第 ${frames.length - 2} 回合（终盘最后一动）同时倒下 ${diedLast.length} 个（${diedLast.map(i => i + '号').join('、')}），名次就在这一下定下来；它终局 ${res.points?.[S]} 分、第 ${res.ranks?.[S]} 名。`,
          why: '终点线前集体摔倒，结算条当场换序。',
          weights: { terminal: 8, visible: 9 }, extra: { diedLast }
        });
      }
    }
  }
}

// ============================================================  夺旗
function analyzeCtf(p, groupNote) {
  const d = readJson(p);
  const names = d.names || d.result?.names || [];
  const S = names.findIndex(n => !/baseline/i.test(n));
  if (S < 0) { stats.files_skipped_not_self++; return; }
  stats.files_parsed++;
  const frames = d.frames || [];
  const head = d.header || {};
  const num = v => (typeof v === 'string' ? JSON.parse(v) : v);
  const teams = num(head.teams ?? names.length);
  const size = num(head.size ?? 0);
  const bases = head.bases ? num(head.bases) : null;
  const ownBase = bases?.[S] ? [Math.round(bases[S].reduce((a, c) => a + c[0], 0) / 9), Math.round(bases[S].reduce((a, c) => a + c[1], 0) / 9)] : null;
  const enemyBases = (bases || []).map((b, i) => i === S ? null : [Math.round(b.reduce((a, c) => a + c[0], 0) / 9), Math.round(b.reduce((a, c) => a + c[1], 0) / 9)]).filter(Boolean);
  const unitTeam = id => Math.floor(id / 3);

  let waitRun = 0, waitStart = null, waitScore = null, homeHogRun = 0, homeHogStart = null;
  const carry = new Map(); // holder -> 逐回合的举旗档案
  const pickSeq = [];
  const lastPick = new Map();
  const scoreSeries = [];

  const flush = () => {
    if (waitRun >= 30) addHit({
      game: 'ctf', path: p, group: groupNote, kind: 'team-freeze',
      board: `${size}x${size}`, players: teams, turns: frames.length, turn: waitStart,
      what: `第 ${waitStart}–${waitStart + waitRun - 1} 回合：它 3 个单位同时 WAIT，连 ${waitRun} 个回合画面完全不动（比分 ${waitScore} → ${(frames[Math.min(frames.length - 1, waitStart + waitRun)]?.score || []).join('/')}）。`,
      why: '整队罚站几十回合——回放里就是一张静止图，观众立刻知道"它卡住了"。',
      weights: { contradiction: 9, visible: 10 }, extra: { run: waitRun }
    });
    if (homeHogRun >= 60) addHit({
      game: 'ctf', path: p, group: groupNote, kind: 'guard-the-door',
      board: `${size}x${size}`, players: teams, turns: frames.length, turn: homeHogStart,
      what: `第 ${homeHogStart}–${homeHogStart + homeHogRun - 1} 回合：它 3 个单位一直挤在自家基地 ${3} 格以内守一个点，共 ${homeHogRun} 回合没出去过（终局比分 ${(d.result?.score || []).join('/')}）。`,
      why: '"守一个点饿死别处"的可视化：三个人堵在家门口，旗就在场上没人拿。',
      weights: { contradiction: 10, visible: 8 }, extra: { run: homeHogRun }
    });
    waitRun = 0; waitStart = null; waitScore = null; homeHogRun = 0; homeHogStart = null;
  };

  for (let fi = 0; fi < frames.length; fi++) {
    const fr = frames[fi];
    const turn = fr.turn ?? fi;
    const evs = fr.events || [];
    const orders = fr.orders || {};
    const myOrder = orders[String(S)] || [];
    const unitById = new Map((fr.units || []).map(u => [u.id, u]));
    const allWait = myOrder.length >= 3 && myOrder.every(o => String(o.move).toUpperCase() === 'WAIT' && (o.act === 'wait' || !o.act));
    if (allWait) { if (waitStart === null) { waitStart = turn; waitScore = (fr.score || []).join('/'); } waitRun++; }
    else flush();

    if (ownBase && myOrder.length >= 3) {
      const home = myOrder.every(o => { const u = unitById.get(o.id); return u && u.pos && md(u.pos, ownBase) <= 3; });
      if (home) { if (homeHogStart === null) homeHogStart = turn; homeHogRun++; } else { homeHogRun = 0; homeHogStart = null; }
    }

    const carriersNow = new Set();
    for (const f of (fr.flags || [])) {
      if (f.status !== 'carried' || f.holder == null || unitTeam(f.holder) !== S) continue;
      const u = unitById.get(f.holder); if (!u || !u.pos) continue;
      carriersNow.add(f.holder);
      const cmd = myOrder.find(o => o.id === f.holder);
      const isWait = cmd && String(cmd.move).toUpperCase() === 'WAIT';
      const dist = ownBase ? md(u.pos, ownBase) : null;
      let st = carry.get(f.holder);
      if (!st) { st = { start: turn, end: turn, waitStart: null, waitRun: 0, cells: new Set(), dist0: dist, minDist: dist, maxDist: dist, wrongStart: null, wrongRun: 0, wrongFrom: dist, worst: dist, prevDist: dist, flag: f.id }; carry.set(f.holder, st); }
      st.end = turn; st.cells.add(u.pos.join(','));
      if (dist != null) { st.minDist = Math.min(st.minDist, dist); st.maxDist = Math.max(st.maxDist, dist); st.worst = st.maxDist; }
      // 原地 WAIT
      if (isWait) { if (st.waitStart === null) st.waitStart = turn; st.waitRun++; }
      else { st.waitStart = null; st.waitRun = 0; }
      if (st.waitRun === 12 || st.waitRun === 30) {
        addHit({
          game: 'ctf', path: p, group: groupNote, kind: 'carrier-freeze',
          board: `${size}x${size}`, players: teams, turns: frames.length, turn: st.waitStart,
          what: `第 ${st.waitStart} 回合起：#${f.holder} 举着 ${f.id} 号旗站在 (${u.pos[0]},${u.pos[1]}) 一动不动，已经 ${st.waitRun} 个回合（离自家基地 ${dist} 格，终局比分 ${(d.result?.score || []).join('/')}）。`,
          why: '旗已经在手上、基地也不算远，它就是不交——"拿到了但不会用"最好懂。',
          weights: { contradiction: 12, visible: 10 }, extra: { holder: f.holder, pos: [u.pos[0], u.pos[1]], run: st.waitRun, dist }
        });
      }
      // 越走越远
      if (dist != null) {
        if (dist > st.prevDist) {
          if (st.wrongStart === null) { st.wrongStart = turn; st.wrongFrom = st.prevDist; }
          st.wrongRun++;
          if (st.wrongRun === 6 || st.wrongRun === 12) {
            const toEnemy = enemyBases.length ? Math.min(...enemyBases.map(b => md(u.pos, b))) : null;
            addHit({
              game: 'ctf', path: p, group: groupNote, kind: 'carrier-wrong-way',
              board: `${size}x${size}`, players: teams, turns: frames.length, turn: st.wrongStart,
              what: `第 ${st.wrongStart}–${turn} 回合：#${f.holder} 举着旗，连续 ${st.wrongRun} 个回合走"离自家基地更远"的方向（${st.wrongFrom} 格 → ${dist} 格），这会儿它离最近的敌方基地 ${toEnemy} 格。`,
              why: '举旗一路往别人家走，画面上轨迹一直在远离自己的基地——反向操作一眼可见。',
              weights: { contradiction: 12, visible: 10 }, extra: { fromDist: st.wrongFrom, toDist: dist, toEnemy, holder: f.holder }
            });
          }
        } else { st.wrongStart = null; st.wrongRun = 0; }
        st.prevDist = dist;
      }
    }
    for (const [id, st] of carry) {
      if (carriersNow.has(id)) continue;
      const run = st.end - st.start + 1;
      if (run >= 20 && st.dist0 != null && st.minDist >= st.dist0) {
        addHit({
          game: 'ctf', path: p, group: groupNote, kind: 'carrier-loiter',
          board: `${size}x${size}`, players: teams, turns: frames.length, turn: st.start,
          what: `第 ${st.start}–${st.end} 回合：#${id} 举着 ${st.flag} 号旗走了 ${run} 个回合、踏过 ${st.cells.size} 个不同格子，但它离自家基地最近的一次仍是开始时的 ${st.dist0} 格（最远拉到 ${st.maxDist} 格）——一步都没往家里靠。`,
          why: '举着旗在场上绕 20+ 回合却不回家，慢放能看到它在原地附近画圈，比"输了"有戏得多。',
          weights: { contradiction: 11, visible: 9 }, extra: { run, cells: st.cells.size, dist0: st.dist0, minDist: st.minDist, maxDist: st.maxDist, holder: id }
        });
      } else if (run >= 15 && st.cells.size <= 8) {
        addHit({
          game: 'ctf', path: p, group: groupNote, kind: 'carrier-loop',
          board: `${size}x${size}`, players: teams, turns: frames.length, turn: st.start,
          what: `第 ${st.start}–${st.end} 回合：#${id} 举着旗绕 ${run} 个回合，只踏过 ${st.cells.size} 个不同格子——在 ${st.dist0} 格距离上原地打转。`,
          why: '在小范围里来回走同一条路，画面是"它在绕圈"，一眼看得懂。',
          weights: { contradiction: 10, visible: 9 }, extra: { run, cells: st.cells.size, dist0: st.dist0, holder: id }
        });
      }
      carry.delete(id);
    }

    for (const e of evs) {
      if (e.type === 'pickup' && e.unit != null && unitTeam(e.unit) === S) lastPick.set(e.unit, turn);
      if (e.type === 'death' && e.unit != null && unitTeam(e.unit) === S) {
        const pt = lastPick.get(e.unit);
        if (pt != null && turn - pt <= 3 && e.flag != null) {
          pickSeq.push({ turn, pickup: pt, unit: e.unit });
          if (pickSeq.length >= 4) {
            addHit({
              game: 'ctf', path: p, group: groupNote, kind: 'pickup-then-die',
              board: `${size}x${size}`, players: teams, turns: frames.length, turn,
              what: `第 ${turn} 回合：#${e.unit} 又在拿起旗后 ${turn - pt} 个回合内被打死、旗掉地。这种"捡到就死"本局已经发生 ${pickSeq.length} 次（回合 ${pickSeq.map(x => x.turn).join('、')}）。`,
              why: '同一件蠢事连着做好几次，快放时是"每次一拿到就倒"的节奏笑点。',
              weights: { repetition: 10, visible: 9 }, extra: { times: pickSeq.length, turns: pickSeq.map(x => x.turn) }
            });
          }
        }
        if (e.flag != null && e.pos && ownBase) {
          const dist = md(e.pos, ownBase);
          if (dist <= 2) addHit({
            game: 'ctf', path: p, group: groupNote, kind: 'near-miss-death',
            board: `${size}x${size}`, players: teams, turns: frames.length, turn,
            what: `第 ${turn} 回合：#${e.unit} 举着旗，在离自家基地只有 ${dist} 格的地方被打死，旗掉在门口。`,
            why: '"就差一格"的构图最好懂：人倒在门口，分没拿到。',
            weights: { drama: 9, visible: 10 }, extra: { unit: e.unit, dist, pos: e.pos }
          });
        }
      }
      if (e.type === 'drop' && e.unit != null && unitTeam(e.unit) === S && ownBase) {
        const u = unitById.get(e.unit);
        if (u && u.pos) {
          const dist = md(u.pos, ownBase);
          if (dist <= 2) addHit({
            game: 'ctf', path: p, group: groupNote, kind: 'drop-at-door',
            board: `${size}x${size}`, players: teams, turns: frames.length, turn,
            what: `第 ${turn} 回合：#${e.unit} 在自己基地门口 ${dist} 格处主动把 ${e.flag} 号旗丢了（act=drop）。`,
            why: '送到门口又扔地上——动作和目的正面矛盾。',
            weights: { contradiction: 10, visible: 8 }, extra: { pos: u.pos }
          });
        }
      }
    }
    scoreSeries.push(fr.score ? fr.score.slice() : null);
  }
  flush();

  const last = scoreSeries.filter(Boolean).pop();
  if (last) {
    const my = last[S], best = Math.max(...last.map((v, i) => i === S ? -1 : v)), margin = my - best;
    if (Math.abs(margin) <= 1) addHit({
      game: 'ctf', path: p, group: groupNote, kind: 'one-point',
      board: `${size}x${size}`, players: teams, turns: frames.length, turn: frames.length - 1,
      what: `终局比分 ${last.join('/')}：它 ${my} 分，和最高的 ${best} 分只差 ${Math.abs(margin)} 分。`,
      why: '一分之差的名次。', weights: { terminal: 6, visible: 5 }, extra: { score: last, margin }
    });
    const nn = scoreSeries.filter(Boolean);
    let flip = null;
    for (let t = nn.length - 1; t >= Math.max(1, nn.length - 30); t--) {
      const s = nn[t], s2 = nn[t - 1];
      const lt = s[S] - Math.max(...s.map((v, i) => i === S ? -1 : v));
      const lp = s2[S] - Math.max(...s2.map((v, i) => i === S ? -1 : v));
      if ((lt > 0) !== (lp > 0)) { flip = t; break; }
    }
    if (flip != null) addHit({
      game: 'ctf', path: p, group: groupNote, kind: 'terminal-flip',
      board: `${size}x${size}`, players: teams, turns: frames.length, turn: flip,
      what: `第 ${flip} 回合附近（终盘 30 回合内）：它的领先/落后身份换边，终局 ${last.join('/')}。`,
      why: '终盘一次交旗就把名次换掉。', weights: { terminal: 7, visible: 8 }, extra: { score: last }
    });
  }
}

// ============================================================  打分
function surpriseScore(h) {
  let s = 0;
  for (const k in (h.weights || {})) s += h.weights[k] * (k === 'stat' ? 0.12 : 1);
  if (h.game === 'bomb') {
    if (h.players === 2) s += 3; else if (h.players <= 4) s += 2; else if (h.players >= 10) s -= 2;
    const sz = parseInt(String(h.board)); if (sz && sz <= 17) s += 2;
    if (h.turns && h.turns <= 120) s += 2;
  } else if (h.game === 'land') { if (h.players === 2) s += 2; }
  else if (h.game === 'ctf') { if (h.players <= 3) s += 3; else if (h.players >= 8) s -= 3; }
  if (['suicide', 'blind-flame', 'carrier-freeze', 'carrier-wrong-way', 'weird-win', 'sealed-in', 'self-suicide', 'self-trap', 'death-magnet', 'empty-loop', 'pickup-then-die'].includes(h.kind)) s += 4;
  return Math.round(s * 100) / 100;
}

// ============================================================  炸弹人大样本：便宜的 results.json 初筛
function bombShortlist(runDir) {
  const rj = path.join(ARENA, 'bomberman', 'challenge-runs', runDir, 'results.json');
  if (!fs.existsSync(rj)) return [];
  const list = readJson(rj);
  const out = [], seen = new Set();
  const push = (m, why) => { const key = m.match; if (seen.has(key)) return; seen.add(key); out.push({ match: m.match, why }); };
  // 先按"最可能出意外"的优先级扫两遍
  const rankOf = m => {
    const r = m.result || {}; const si = (r.names || []).findIndex(n => /你的\s*bot/.test(n));
    if (si < 0) return 99;
    const pl = r.players?.[si] || {}, np = r.config?.players || 2, sz = r.config?.size || 13;
    if (r.ranks?.[si] === 1 && np >= 10 && pl.death_turn != null) return 0;
    if (r.ranks?.[si] === 1 && np <= 4) return 1;
    if (pl.reason === 'forfeit') return 2;
    if (pl.death_turn != null && pl.death_turn <= 6 && np <= 4 && sz <= 17) return 3;
    if (pl.reason === 'blast' && np <= 4 && sz <= 17) return 4;
    if (pl.reason === 'shrink' && np <= 4) return 5;
    if (np === 2 && r.turns <= 100) return 6;
    return 7;
  };
  const sorted = list.slice().sort((a, b) => rankOf(a) - rankOf(b));
  for (const m of sorted) {
    const r = m.result || {}; const si = (r.names || []).findIndex(n => /你的\s*bot/.test(n));
    if (si < 0) continue;
    push(m, 'r' + rankOf(m));
  }
  return out;
}
function limitPicks(picks, cap) { return picks.slice(0, cap); }

function walkDir(dir, filt) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => n.endsWith('.json') && (!filt || filt(n))).map(n => path.join(dir, n));
}

function main() {
  for (const [sub, note] of LAND_DIRS) for (const f of walkDir(path.join(RUNS, sub))) analyzeLand(f, note);
  for (const f of walkDir(BOMB_LOCAL)) analyzeBomb(f, 'bomberman-gui1/replays（本机手测）', '手测版');
  for (const [run, ver] of BOMB_CHALLENGE) {
    const picks = limitPicks(bombShortlist(run), 90);
    stats.bomb_shortlisted += picks.length;
    const note = `bomberman/challenge-runs/${run}`;
    for (const m of picks) {
      const f = path.join(ARENA, 'bomberman', 'challenge-runs', run, 'replays', String(m.match).padStart(5, '0') + '.json');
      if (!fs.existsSync(f)) continue;
      stats.bomb_deep_read++;
      try { analyzeBomb(f, note, ver + '｜初筛档 ' + m.why); } catch (e) { console.log('bomb fail', f, e.message); }
    }
  }
  for (const f of walkDir(CTF_DIR)) { try { analyzeCtf(f, 'ctf-gui1/replays'); } catch (e) { console.log('ctf fail', f, e.message); } }
  const diag = path.join(CTF_DIR, 'replays', 'diag8.json');
  if (fs.existsSync(diag)) { try { analyzeCtf(diag, 'ctf-gui1/replays/replays/diag8'); } catch (e) { console.log('diag8 fail', e.message); } }

  hits.sort((a, b) => b.surprise - a.surprise);
  const byKind = {}; for (const h of hits) byKind[h.kind] = (byKind[h.kind] || 0) + 1;
  fs.writeFileSync(OUT, JSON.stringify({
    generated_at: new Date().toISOString(), script: 'pipeline/clip-mining-v2.mjs',
    standard: '要看得见的矛盾动作，不要统计结论；每条命中指到具体回合',
    discipline: { land_gui1_forbidden: true, no_network: true, read_only: true, streaming: true },
    scan_stats: stats, kind_counts: byKind, total_hits: hits.length, candidates: hits.slice(0, 500)
  }, null, 1), 'utf8');
  console.log('seen', stats.files_seen, 'parsed', stats.files_parsed, 'notself', stats.files_skipped_not_self, 'deep', stats.bomb_deep_read, 'MB', stats.mb_read, 'hits', hits.length);
  console.log(JSON.stringify(byKind));
  for (const h of hits.slice(0, 40)) console.log(h.surprise, h.kind, '|', h.game, h.board, h.players + 'p', 'T' + h.turn, '|', (h.what || '').slice(0, 110), '|', h.path.replace(ARENA, ''), '|', h.version || '');
}
main();
