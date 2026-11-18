#!/usr/bin/env node
/**
 * clip-mining.mjs —— 只读挖掘「有节目效果」的对局候选。
 *
 * 纪律：
 *   - 全程只读。不写入 meow-ai-arena，不调用 evaluate.py / referee.py / 编译器，不占 GPU。
 *   - land/replays、ctf/replays、bomberman/replays（官方示例、他人对局）只列文件名与大小，不解析内容。
 *   - 只解析「本机 27B 自己参与」的回放：bot 名 / bot_specs 命中 SELF_TOKENS。
 *
 * 输出：$WORKSPACE/arena-video/data/clip-candidates.json
 * 用法：node pipeline/clip-mining.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = '//wsl.localhost/Ubuntu-22.04$HOME/deepseek-harness/workplace/meow-ai-arena/';
const OUT = '$WORKSPACE/arena-video/data/clip-candidates.json';

/* ---------------------------------------------------------------- 身份判定 */
// 三场里代表「本机 27B」的名字；其余一律视为他人/基准。
const SELF_TOKENS = {
  land: ['A:bot', 'A:bot.cpp', 'A:bot_dbg', 'A:a.cpp', 'A:b.cpp', 'A:c.cpp', 'A:d.cpp', 'A:e.cpp', 'A:f.cpp', 'A:g.cpp', 'A:h.cpp', 'A:i7.cpp'],
  bomb: ['Mine', '你的 bot'],
  ctf: ['bot'], // 夺旗沙箱里第一槽有时直接写成迭代版本号（v13 等），那也算本机 27B —— analyzeCtf 用 assumeSelf 兜住并把它标成「加时自迭代版 vX」
};
// 他人/官方基准（不视为本人，且其对局不解析）
const FOREIGN_TOKENS = { land: ['B:', 'C:', 'D:'], bomb: ['Base', 'B1', 'B2'], ctf: ['baseline'] };

const selfIndex = (game, names, assumeFirstIsSelf = false) => {
  if (game === 'ctf') { const i = names.findIndex((n) => n === 'bot'); return i >= 0 ? i : (assumeFirstIsSelf ? 0 : -1); }
  if (game === 'bomb') return names.findIndex((n) => SELF_TOKENS.bomb.includes(n));
  return names.findIndex((n) => SELF_TOKENS.land.includes(n));
};
// land 里 A:a.cpp 等是「本人旧版副本」（selfplay 的 prev），对手槽位也可能同样是本人代码
const isSelfSlot = (game, name) => (game === 'land' ? SELF_TOKENS.land.includes(name) : SELF_TOKENS[game].includes(name));

/* UNC 路径专用拼接：Node 的 path.posix.join 会把 //wsl.localhost 折叠成 /wsl.localhost，
   Windows 下就变成 E:\wsl.localhost，所以自己拼，只保证不重复斜杠。 */
const P = (base, ...segs) => [String(base).replace(/\/+$/, ''), ...segs.map((s) => String(s).replace(/^\/+/, ''))].join('/');

/* ---------------------------------------------------------------- 工具 */
const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const lsJson = (dir) => (exists(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : []);
const statOf = (dir) => (exists(dir) ? fs.readdirSync(dir).map((f) => ({ file: f, bytes: fs.statSync(P(dir, f)).size })) : []);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------- 通用：名次跳变/终盘 */
// rankSeries: 每回合的名次数组（越大越差）。返回终盘 20% 窗口内的跳变统计。
function lateRankJumps(rankSeries, selfIdx) {
  const n = rankSeries.length;
  if (!n) return { jumps: 0, maxDelta: 0, lateSpan: 0, decidedInLast5: null, tail: [] };
  const start = Math.max(1, Math.floor(n * 0.8));
  let jumps = 0, maxDelta = 0;
  for (let i = start; i < n; i++) {
    const d = rankSeries[i - 1][selfIdx] - rankSeries[i][selfIdx]; // 正数 = 名次上升
    if (d !== 0) { jumps++; maxDelta = Math.max(maxDelta, Math.abs(d)); }
  }
  const leadAt = (arr) => arr.indexOf(Math.max(...arr));
  const tail = rankSeries.slice(start, n).map((row, k) => ({ turn: start + k, selfRank: row[selfIdx] }));
  const firstLead = leadAt(rankSeries[start]);
  const lastLead = leadAt(rankSeries[n - 1]);
  const last5 = rankSeries.slice(Math.max(0, n - 6));
  const decidedInLast5 = new Set(last5.map(leadAt)).size > 1;
  return { jumps, maxDelta, lateSpan: n - start, decidedInLast5, firstLeadLate: firstLead, lastLeadLate: lastLead, tail };
}

/* --------------------------------------------------------- 录制窗口（滑窗） */
// density: 每回合的戏剧密度；窗长 = 目标秒数 ÷ 每回合秒数。
// anchors: 必须出现在画面里的回合（故障回合 / 最大连锁爆 / 本人阵亡 / 终盘），窗口必须盖住其中之一。
function bestWindow(density, targetSec, secPerTurn, anchors = [], minSec = 15, maxSec = 40) {
  const n = density.length;
  if (!n) return null;
  const winSec = clamp(targetSec, minSec, maxSec);
  const w = clamp(Math.round(winSec / secPerTurn), 2, n);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + density[i];
  const pick = (lo, hi) => {
    let best = -1, bi = lo;
    for (let i = lo; i <= hi && i + w <= n; i++) { const s = pre[i + w] - pre[i]; if (s > best) { best = s; bi = i; } }
    return { bi, best };
  };
  let chosen = null, anchored = null;
  for (const a of anchors.filter((x) => Number.isFinite(x))) {
    const lo = clamp(Math.max(0, a - w + Math.round(w * 0.25)), 0, Math.max(0, n - w));
    const hi = clamp(Math.min(a - Math.round(w * 0.15), n - w), lo, Math.max(0, n - w));
    if (hi < lo) continue;
    const c = pick(lo, hi);
    if (!chosen || c.best > chosen.best) chosen = c;
    anchored = a;
  }
  if (!chosen) chosen = pick(0, Math.max(0, n - w));
  const bi = chosen.bi, frames = Math.min(w, n - bi);
  return {
    turn_start: bi,
    turn_end: bi + frames,
    frames,
    density_sum: r2(chosen.best),
    est_seconds_at_this_rate: r2(frames * secPerTurn),
    anchored_on_turn: anchored != null ? anchored : null,
  };
}

/* --------------------------------------------------------------- 页面映射 */
// 依据 script/口播稿.md 的 24 页结构：正赛交卷页 / 加时赛页 是插录屏的位置。
const PAGES = {
  land: { stall: 5, main: 6, reversal: 7, overtime: 8 },
  bomb: { stall: 9, main: 10, reversal: 11, overtime: 12, followup: 13 },
  ctf: { stall: 14, main: 15, reversal: 16, overtime: 17, result: 18 },
};

/* ------------------------------------------------------- 播放器节奏（实测） */
// 每回合秒数取自各场查看器的默认倍速，用来把「回合区间」换成「录制秒数」。
const BOMB_SEC_PER_TURN = 0.2;   // contestants/runs/bomberman-gui1/replays/*.html：speed 下拉默认 5 回合/秒
const CTF_SEC_PER_TURN = 0.1;    // contestants/runs/ctf-gui1/viewer.html：300ms/回合 ÷ 默认 3×
const LAND_SEC_PER_TURN = 1 / 30; // land/workspace/viewer/viewer.html：speed 下拉默认 30 回合/秒

/* =================================================================== LAND */
// frames: [{pos:[[x,y,dir],…], moves:[…]}]，没有逐回合面积，只能从移动推死亡重生。
function analyzeLand(file, tag) {
  const j = readJson(file);
  const names = j.names || [];
  const self = selfIndex('land', names);
  if (self < 0) return null;
  const res = j.result, cfg = j.config;
  const players = names.length;
  const frames = j.frames || [];
  // 逐帧：位移 >1 曼哈顿距离 = 被击杀后重生
  const respawnTurns = [];
  const perPlayerStuck = new Array(players).fill(0);
  let stay = 0, maxStay = 0, dirChanges = 0;
  let lastDir = null;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].pos, b = frames[i].pos;
    if (!a || !b) continue;
    const d = Math.abs(a[self][0] - b[self][0]) + Math.abs(a[self][1] - b[self][1]);
    if (d > 1) respawnTurns.push(i);
    if (d === 0) { stay++; maxStay = Math.max(maxStay, stay); perPlayerStuck[self]++; } else stay = 0;
    if (b[self][2] !== lastDir) { dirChanges++; lastDir = b[self][2]; }
  }
  const greedyIdx = names.findIndex((n) => /greedy|random/.test(n));
  const areaSeries = null; // land 回放不含逐回合面积（如实标注）

  const myArea = res.areas[self], topArea = Math.max(...res.areas), myRank = res.ranks[self];
  const absurdity = {
    zero_final: myArea === 0,
    last_place: myRank === players,
    area_gap_vs_winner: r2(topArea ? (topArea - myArea) / topArea : 0),
    died_times: res.deaths[self],
    longest_frozen_turns: maxStay, // 原地不动 = 被自己/对手封死的代理证据
    frozen_turns_total: perPlayerStuck[self],
  };
  const drama = {
    respawn_turns: respawnTurns,
    respawns_late_20pct: respawnTurns.filter((t) => t >= frames.length * 0.8).length,
    turn_direction_changes: dirChanges,
    rank_series_available: false,
  };
  const hooks = [];
  if (tag.version === 'main' && greedyIdx >= 0 && myRank > res.ranks[greedyIdx])
    hooks.push({ key: 'land_main_reversed_by_greedy', w: 60, tier: 1, note: `${res.mode === 'duel' ? '单挑' : `${players} 人混战`}里被官方贪心基准反超（面积 ${myArea} vs ${res.areas[greedyIdx]}，本人第 ${myRank} 名）—— 第 6 页「交卷 6.4 分」那句的实机对应` });
  if (res.mode === 'melee' && (absurdity.last_place || myArea <= Math.min(...res.areas) + 1))
    hooks.push({ key: 'land_melee_bottom', w: 42, tier: 1, note: `混战垫底（面积 ${myArea}，大样本同型：melee 0 分 / Elo −313）` });
  if (tag.version === 'main' && res.mode === 'duel' && myRank === 1)
    hooks.push({ key: 'land_duel_win', w: 16, tier: 3, note: '单挑赢贪心基准（对应「单挑正常」那一半）' });
  if (maxStay >= 8) hooks.push({ key: 'land_possible_self_encircle', w: 20, tier: 2, note: `连续 ${maxStay} 回合原地不动，疑似把自己围死（land 帧不含墙与归属，属代理证据）` });
  if (absurdity.zero_final) hooks.push({ key: 'land_zero_area', w: 40, tier: 1, note: '终场 0 格领土' });

  const tier = Math.min(9, ...hooks.filter((h) => h.tier).map((h) => h.tier), 9);

  const pages = tag.version === 'main' ? [PAGES.land.main] : [PAGES.land.overtime];
  if (drama.respawns_late_20pct >= 2 || hooks.some((h) => h.key === 'land_main_reversed_by_greedy')) pages.push(PAGES.land.reversal);

  const density = frames.map((_, i) => (respawnTurns.includes(i) ? 9 : 0) + (i >= frames.length * 0.8 ? 1.5 : 0.35));
  const anchors = [...respawnTurns.slice(-4), frames.length - 1].filter((x) => Number.isFinite(x));
  return {
    game: 'land', path: file, group: tag.group, run: tag.run, version_label: tag.label || tag.version, tier,
    self_index: self, self_name: names[self],
    opponents: names.filter((_, i) => i !== self),
    opponents_also_written_by_self: names.filter((n, i) => i !== self && isSelfSlot('land', n)),
    board: `${cfg.width}x${cfg.height}`, players, mode: res.mode, max_turns: cfg.max_turns,
    turns: res.turns, frames: frames.length,
    final: { seed: j.seed, areas: res.areas, ranks: res.ranks, winner: res.winner, deaths: res.deaths, kills: res.kills, errors: res.errors, timeouts: res.timeouts, forfeit: res.forfeit, max_ms: res.max_ms },
    metrics: { absurdity, drama, hooks },
    rec: { sec_per_turn_source: 'land/workspace/viewer/viewer.html 默认 30 回合/秒（回放不含 elapsed_seconds，无法按对局真实每回合耗时估）', sec_per_turn: r2(LAND_SEC_PER_TURN), full_game_seconds_at_player_rate: r2(frames.length * LAND_SEC_PER_TURN), window: bestWindow(density, 30, LAND_SEC_PER_TURN, anchors) },
    pages: [...new Set(pages)],
    raw_score: 0,
  };
}

/* ============================================================= BOMBERMAN */
// frames: [{turn,board,players,bombs,flames,events}]，events: place/explode/death/blocked/kill_credit/shrink
function analyzeBomb(file, extra = {}) {
  const j = readJson(file);
  const res = j.result, names = res.names || [], self = selfIndex('bomb', names);
  if (self < 0) return null;
  const cfg = res.config, frames = j.frames || [];
  const players = names.length;

  const deathsSelf = res.players[self] ? res.players[self].death_turn : null;
  const reasonSelf = res.players[self] ? res.players[self].reason : '';

  // 事件扫描
  let chainMax = 0, chainMaxTurn = null, chainFrames = 0, selfBlocked = 0, selfBurnedAtOwnFeet = 0, oneForMany = 0;
  const explodeByTurn = new Map();
  const killCreditSelf = [];
  const deathsAll = [];
  for (const f of frames) {
    const evs = f.events || [];
    const ex = evs.filter((e) => e.type === 'explode');
    if (ex.length) { explodeByTurn.set(f.turn, ex); if (ex.length > chainMax) { chainMax = ex.length; chainMaxTurn = f.turn; } if (ex.length >= 2) chainFrames++; }
    for (const e of evs) {
      if (e.type === 'blocked' && e.player === self) selfBlocked++;
      if (e.type === 'death') {
        deathsAll.push({ turn: f.turn, player: e.player, reason: e.reason });
        if (e.player === self && e.reason === 'blast') {
          const at = ex.find((x) => x.player === self && f.players && f.players[self] && Math.abs(f.players[self].x - x.x) <= cfg.radius && Math.abs(f.players[self].y - x.y) <= cfg.radius);
          if (at) selfBurnedAtOwnFeet++;
        }
      }
      if (e.type === 'kill_credit' && Array.isArray(e.owners) && e.owners.includes(self)) killCreditSelf.push({ turn: f.turn, victim: e.victim, owners: e.owners, share: e.share });
    }
  }
  // 残局一换多：同一回合自己拿下的击杀 ≥2
  const byTurn = new Map();
  for (const k of killCreditSelf) byTurn.set(k.turn, (byTurn.get(k.turn) || 0) + 1);
  for (const [, c] of byTurn) if (c >= 2) oneForMany++;

  // 火焰截断：bot.cpp:472 memcpy(R.flame, FL, 625) —— R.flame 是 int16_t[625]（应 1250 字节），
  // 只拷了前 625 字节 = 格子序号 0..311。所以「格子序号 ≥312」的火焰它读不到。
  // size=13（169 格）/17（289 格）在安全区，size=25（625 格）后半盘全瞎 —— 发作的是 10 人档。
  const cellCount = cfg.size * cfg.size;
  const blindZoneStarts = cellCount > 312;              // 该局是否在缺陷可发作的尺寸内
  const frameAt = new Map(frames.map((f) => [f.turn, f]));
  const deadFrame = deathsSelf != null ? (frameAt.get(deathsSelf) || frameAt.get(deathsSelf + 1)) : null;
  const deadX = res.players[self] ? res.players[self].x : null;
  const deadY = res.players[self] ? res.players[self].y : null;
  const deadCell = deadX != null ? deadX + deadY * cfg.size : null;
  const flamesOnDeadCell = deadFrame ? (deadFrame.flames || []).some(([fx, fy]) => fx === deadX && fy === deadY) : false;
  // 自爆：死亡帧里引爆的雷 owner 是自己，且十字射线覆盖自己坐标
  let selfBombKilledMe = false, selfBombAtOwnFeet = 0;
  for (const f of frames) {
    const mine = (f.events || []).filter((e) => e.type === 'explode' && e.player === self);
    if (!mine.length || !f.players) continue;
    const me = f.players[self];
    for (const e of mine) if (e.x === me.x && e.y === me.y) selfBombAtOwnFeet++;
    if (deathsSelf === f.turn || deathsSelf === f.turn - 1) {
      if (me && mine.some((e) => Math.abs(e.x - me.x) <= cfg.radius && Math.abs(e.y - me.y) <= cfg.radius)) selfBombKilledMe = true;
    }
  }

  // 实时名次代理：死亡顺序越晚名次越好 → 用「存活人数曲线」+ 本人死亡时机
  const aliveSeries = frames.map((f) => (f.players || []).filter((p) => p.alive).length);
  const lastThird = frames.length * 0.8;
  const lateDeathsSelf = deathsAll.filter((d) => d.player === self && d.turn >= lastThird);
  const lateDeathsOthers = deathsAll.filter((d) => d.player !== self && d.turn >= lastThird);
  const faults = (res.diagnostics || []).filter((d) => d.player === self);

  const absurdity = {
    zero_final: (res.points[self] ?? 0) === 0,
    last_place: res.ranks[self] === players,
    points: res.points[self], winner_points: Math.max(...res.points),
    died: deathsSelf !== null, death_turn: deathsSelf, death_reason: reasonSelf,
    died_at_cell_index: deadCell, death_cell_in_blind_half: deadCell != null && deadCell >= 312,
    flame_actually_on_death_cell: flamesOnDeadCell,
    bombs_planted_on_own_cell: selfBombAtOwnFeet, killed_by_own_bomb: selfBombKilledMe,
    burned_at_own_feet: selfBurnedAtOwnFeet,
    early_death: deathsSelf != null && deathsSelf <= frames.length * 0.15,
    blocked_moves_by_self: selfBlocked,
    shrank_to_death: reasonSelf === 'shrink',
  };
  const drama = {
    chain_max_bombs_in_one_turn: chainMax, chain_turns: chainFrames,
    one_for_many_turns: oneForMany,
    kill_credit_self: killCreditSelf.slice(0, 20),
    deaths_late_20pct_self: lateDeathsSelf.length,
    deaths_late_20pct_others: lateDeathsOthers.length,
    alive_curve_head: aliveSeries.slice(0, 1), alive_curve_tail: aliveSeries.slice(-1),
    turns_used: res.turns, max_turns: cfg.max_turns,
    decided_early: res.turns < cfg.max_turns * 0.5,
    faults_self: faults,
  };
  const secPerTurnReal = res.elapsed_seconds && res.turns ? res.elapsed_seconds / res.turns : null;

  const hooks = [];
  const bothErrorSlots = ((res.errors || []).filter((e) => e > 0)).length;
  const isEngineSelfTest = bothErrorSlots > 1 && res.turns <= 2;
  if ((faults.length || (res.errors && res.errors[self] > 0)) && !isEngineSelfTest) {
    const mm = res.max_ms && res.max_ms[self] != null ? Math.round(res.max_ms[self]) : null;
    const moveBudget = (res.environment && res.environment.move_ms) || 50;
    const initBudget = (res.environment && res.environment.initial_ms) || 2000;
    const budgetTalk = mm == null ? '耗时未记录'
      : mm >= initBudget * 0.75 ? `出事那一下算到 ${mm}ms，贴着 ${initBudget}ms 的首帧预算，裁判机稍慢就判超时`
        : mm > moveBudget * 3 ? `出事那一下算到 ${mm}ms，是每回合 ${moveBudget}ms 预算的 ${(mm / moveBudget).toFixed(1)} 倍`
          : `它只用 ${mm}ms 就被记 ${faults[0] ? faults[0].error : 'error'}（每回合预算 ${moveBudget}ms，卡在上限，不是算力不够）`;
    const runTalk = extra.run === '20261003-183608'
      ? '正式评测那 5 局故障之一（同机同档其余十家 0 故障）—— 第 10 页的既有剧情'
      : `对照跑 ${extra.run || extra.group || '本机手测'} 里复现的同类故障（这一轮共 ${extra.faultTotal} 局故障，不是那 5 局本身）`;
    hooks.push({ key: 'bomb_fault_game', w: 60, tier: 1, note: `${runTalk}（第 ${faults[0] ? faults[0].turn : '?'} 回合 ${faults[0] ? faults[0].error : 'error'}；${budgetTalk}）` });
  } else if (isEngineSelfTest) {
    hooks.push({ key: 'bomb_engine_selftest', w: 6, note: '引擎自检局：双方都报 error、1 回合就收，不是正赛那 5 局故障，别当证据用' });
  }
  if (blindZoneStarts && flamesOnDeadCell && deadCell >= 312 && reasonSelf === 'blast')
    hooks.push({ key: 'bomb_flame_blind_zone', w: 55, tier: 1, note: `火焰截断案发现场：回放帧里 ( ${deadX},${deadY} )（格号 ${deadCell}）确实有火，而 memcpy(R.flame,FL,625) 只拷了前 312 格，size=${cfg.size} 的 ${cellCount}格里它读不到这一格 —— 与加时日志记的 v4 根因同型（那条是 10P seed 202 在 (17,21) 被火杀），第 13 页要的实机证据就是这段` });
  else if (blindZoneStarts)
    hooks.push({ key: 'bomb_blind_size_board', w: 12, note: `size=${cfg.size}（${cellCount} 格 > 312），是火焰截断可发作的档位，但本局没死在盲区格上` });
  if (selfBombKilledMe) hooks.push({ key: 'bomb_killed_by_own_bomb', w: 34, tier: 2, note: '被自己放的雷炸死（把火放在自己脚下）' });
  else if (selfBombAtOwnFeet) hooks.push({ key: 'bomb_own_feet', w: 20, tier: 2, note: `${selfBombAtOwnFeet} 次把雷直接压在自己脚下引爆` });
  if (chainMax >= 3) hooks.push({ key: 'bomb_chain', w: 26, tier: 2, note: `连环爆：单回合 ${chainMax} 颗同时引爆` });
  else if (chainFrames >= 3) hooks.push({ key: 'bomb_chain_soft', w: 12, note: `${chainFrames} 个回合出现 2 颗连锁引爆` });
  if (selfBlocked >= 6) hooks.push({ key: 'bomb_self_encircle', w: 16, note: `${selfBlocked} 次放弹被堵死，形同自封出口` });
  if (absurdity.zero_final && absurdity.last_place) hooks.push({ key: 'bomb_zero_last', w: 30, tier: 2, note: '终场 0 分且全场垫底' });
  if (absurdity.early_death && players >= 10) hooks.push({ key: 'bomb_early_death_10p', w: 22, tier: 2, note: `十人档第 ${deathsSelf} 回合就出局（正赛 10P 档第一率 0% 的典型画面）` });
  if (absurdity.shrank_to_death) hooks.push({ key: 'bomb_shrink_death', w: 12, note: '被缩圈挤死（reason=shrink）' });
  if (players >= 10) hooks.push({ key: 'bomb_melee10', w: 10, note: '十人混战，画面本身就是「混乱」主题' });
  if (!blindZoneStarts) hooks.push({ key: 'bomb_blind_zone_silent', w: 0, note: `size=${cfg.size}（${cellCount} 格 ≤312），火焰截断在这档根本不发作 —— 适合当「13 页的反面参照：为什么 2P 一直没问题」` });

  const tier = Math.min(9, ...hooks.filter((h) => h.tier).map((h) => h.tier), 9);
  const pages = [];
  if (extra.version === 'main') pages.push(PAGES.bomb.main);
  else if (extra.version === 'ot') pages.push(PAGES.bomb.overtime);
  else pages.push(PAGES.bomb.overtime);
  if (hooks.some((h) => h.key === 'bomb_chain' || h.key === 'bomb_chain_soft' || h.key === 'bomb_melee10' || h.key === 'bomb_early_death_10p')) pages.push(PAGES.bomb.reversal);
  if (hooks.some((h) => ['bomb_flame_blind_zone', 'bomb_killed_by_own_bomb', 'bomb_own_feet', 'bomb_self_encircle', 'bomb_blind_size_board'].includes(h.key))) pages.push(PAGES.bomb.followup);
  if (hooks.some((h) => h.key === 'bomb_blind_zone_silent')) pages.push(PAGES.bomb.followup);
  if (extra.group && /手测/.test(extra.group)) pages.push(PAGES.bomb.overtime);

  const density = frames.map((f) => {
    const evs = f.events || [];
    let s = 0;
    for (const e of evs) {
      if (e.type === 'explode') s += 2;
      else if (e.type === 'death') s += 5;
      else if (e.type === 'kill_credit') s += e.owners && e.owners.includes(self) ? 4 : 1;
      else if (e.type === 'blocked') s += e.player === self ? 1.5 : 0.2;
      else if (e.type === 'shrink') s += 0.5;
      else if (e.type === 'place') s += e.player === self ? 0.4 : 0.05;
    }
    if (f.turn >= frames.length * 0.8) s += 1;
    return s;
  });
  // 窗长锚点：故障回合 > 火焰截断阵亡回合 > 最大连锁爆回合 > 本人阵亡 > 终盘
  const anchors = [...faults.map((f) => f.turn),
    (blindZoneStarts && flamesOnDeadCell && deadCell >= 312) ? deathsSelf : null,
    chainMaxTurn, deathsSelf, frames.length - 1].filter((x) => Number.isFinite(x));
  const window = bestWindow(density, 30, BOMB_SEC_PER_TURN, anchors);
  if (window && secPerTurnReal) {
    window.wallclock_seconds_during_eval_run = r2(window.frames * secPerTurnReal);
    window.wallclock_note = '这是评测机上跑完这段回合的真实墙钟时间（含 7 并发排队），只用来判断「对局本身有多快」，不能当成片时长；剪辑尺度看 est_seconds_at_this_rate（播放器 5 回合/秒）';
  }
  return {
    game: 'bomb', path: file, group: extra.group, run: extra.run, version_label: extra.version, tier,
    self_index: self, self_name: names[self],
    opponents: names.filter((_, i) => i !== self),
    board: `${cfg.size}x${cfg.size}`, players, mode: players >= 3 ? `${players} 人混战` : '双人对决',
    max_turns: cfg.max_turns, turns: res.turns, frames: frames.length,
    final: { seed: res.seed, match: extra.match || null, points: res.points, ranks: res.ranks, survivors: res.survivors, kill_credit: res.kill_credit, survival_points: res.survival_points, errors: res.errors, max_ms: res.max_ms.map ? res.max_ms.map(r2) : res.max_ms, elapsed_seconds: r2(res.elapsed_seconds), diagnostics: res.diagnostics || [] },
    metrics: { absurdity, drama, hooks },
    rec: { sec_per_turn_source: '回放页 r11.html 下拉默认 5 回合/秒 = 0.2s/回合（elapsed_seconds 是 7 并发评测里的真实耗时，含排队，只作参考不作剪辑尺度）', sec_per_turn: BOMB_SEC_PER_TURN, sec_per_turn_real: secPerTurnReal ? r2(secPerTurnReal) : null, full_game_seconds_at_player_rate: r2(frames.length * BOMB_SEC_PER_TURN), window },
    pages: [...new Set(pages)],
    raw_score: 0,
  };
}

// 粗筛：不读 frames，只用 run 的 results.json（内含每局 result）
function prescanBombRun(runDir, meta) {
  const rj = P(runDir, 'results.json');
  if (!exists(rj)) return { games: 0, picked: [] };
  const all = readJson(rj);
  const out = [];
  for (const g of all) {
    const res = g.result; if (!res || !res.names) continue;
    const self = selfIndex('bomb', res.names); if (self < 0) continue;
    const fault = (res.errors && res.errors[self] > 0) || (res.diagnostics || []).some((d) => d.player === self);
    const zero = (res.points[self] ?? 0) === 0, last = res.ranks[self] === res.names.length;
    const top = Math.max(...res.points);
    let s = 0;
    if (fault) s += 1000;              // 剧情点优先
    if (zero && last) s += 120; else if (zero) s += 70; else if (last) s += 55;
    s += clamp((top - res.points[self]) / (top || 1), 0, 1) * 40;
    if (res.names.length >= 10) s += 18; // 混乱主题
    if (res.turns < res.config.max_turns * 0.55) s += 12; // 提前分胜负 = 看得懂
    const late = res.players && res.players[self] && res.players[self].death_turn != null && res.players[self].death_turn > res.turns * 0.8;
    if (late) s += 10;
    out.push({ match: g.match, size: g.size, rough: s, fault, names: res.names, file: P(runDir, 'replays', String(g.match).padStart(5, '0') + '.json') });
  }
  out.sort((a, b) => b.rough - a.rough);
  // 每档（size）取前 4，故障局全留
  const bySize = {};
  const picked = [];
  for (const o of out) {
    if (o.fault) { picked.push(o); continue; }
    bySize[o.size] = (bySize[o.size] || 0);
    if (bySize[o.size] < 4) { bySize[o.size]++; picked.push(o); }
  }
  return { games: out.length, selfGames: out.length, faultTotal: out.filter((o) => o.fault).length, picked: picked.slice(0, 24), meta };
}

/* =================================================================== CTF */
// frames: [{turn,score,events,units,flags,orders}]，events: attack/death/pickup/respawn/capture/return
function analyzeCtf(file, extra = {}) {
  const j = readJson(file);
  const names = j.names || [], self = selfIndex('ctf', names, !!extra.assumeSelf);
  if (self < 0) return null;
  const res = j.result, hdr = j.header, frames = j.frames || [];
  const teams = hdr.teams, unitsPerTeam = frames.length ? Math.round(frames[0].units.length / teams) : 0;
  // 本人的单位编号：第 0 帧往往还没有 orders，往后找第一帧带本队指令的；再兜底用 id 分段
  let selfUnits = [];
  for (let i = 0; i < Math.min(frames.length, 5); i++) {
    const o = frames[i].orders && frames[i].orders[String(self)];
    if (o && o.length) { selfUnits = o.map((x) => x.id); break; }
  }
  if (!selfUnits.length) selfUnits = Array.from({ length: unitsPerTeam }, (_, k) => self * unitsPerTeam + k);
  const statSelf = res.stats[self] || {};

  const rankSeries = frames.map((f) => {
    const order = f.score.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const ranks = new Array(teams);
    order.forEach(([, i], k) => { ranks[i] = k + 1; });
    return ranks;
  });
  const late = lateRankJumps(rankSeries, self);

  let waitFrames = 0, maxWaitRun = 0, curWaitRun = 0, pickupSelf = 0, captureSelf = 0, returnSelf = 0, deathSelf = 0;
  let carriedFrames = 0, carriedFrozenMax = 0, carriedFrozenRun = 0, ownFlagHeldFrames = 0;
  const idSet = new Set(selfUnits);
  const marks = { lastPickup: null, lastCapture: null, lastReturn: null, lastDeathSelf: null, waitRun: null, carryFrozenRun: null };
  let waitRunStart = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    for (const e of f.events || []) {
      const mine = idSet.has(e.unit) || (typeof e.unit === 'number' && Math.floor(e.unit / unitsPerTeam) === self);
      if (e.type === 'pickup' && mine) { pickupSelf++; marks.lastPickup = f.turn; }
      if (e.type === 'capture' && mine) { captureSelf++; marks.lastCapture = f.turn; }
      if (e.type === 'return' && mine) { returnSelf++; marks.lastReturn = f.turn; }
      if (e.type === 'death' && mine) { deathSelf++; marks.lastDeathSelf = f.turn; }
    }
    // 本人三单位是否全 WAIT
    const ord = (f.orders && f.orders[String(self)]) || [];
    const allWait = ord.length > 0 && ord.every((o) => o.move === 'WAIT');
    if (allWait) {
      if (waitRunStart == null) waitRunStart = f.turn;
      waitFrames++; curWaitRun++;
      if (curWaitRun > maxWaitRun) { maxWaitRun = curWaitRun; marks.waitRun = [waitRunStart, f.turn]; }
    } else { curWaitRun = 0; waitRunStart = null; }
    // 抱旗不动
    if (i > 0) {
      const prev = frames[i - 1].units, cur = f.units;
      let held = 0, frozen = 0;
      for (const u of selfUnits) { if (prev[u] && prev[u].flag) { held++; if (cur[u] && prev[u].pos && cur[u].pos && prev[u].pos[0] === cur[u].pos[0] && prev[u].pos[1] === cur[u].pos[1]) frozen++; } }
      if (held) { carriedFrames += held; ownFlagHeldFrames = Math.max(ownFlagHeldFrames, held); carriedFrozenRun = frozen === held ? carriedFrozenRun + held : 0; carriedFrozenMax = Math.max(carriedFrozenMax, carriedFrozenRun); }
      else carriedFrozenRun = 0;
    }
  }

  const absurdity = {
    zero_final: res.score[self] === 0,
    last_place: rankSeries[rankSeries.length - 1][self] === teams,
    score: res.score[self], top_score: Math.max(...res.score),
    pickups: statSelf.pickups ?? pickupSelf, captures: statSelf.captures ?? captureSelf,
    pick_without_return: (statSelf.pickups || 0) > 0 && (statSelf.captures || 0) === 0,
    units_pinned_home_frames: waitFrames, units_pinned_home_max_run: maxWaitRun,
    carrying_but_frozen_max_turns: carriedFrozenMax,
    faults: (res.bots && res.bots[self] && res.bots[self].faults) || [],
  };
  const drama = {
    rank_jumps_late_20pct: late.jumps, rank_max_jump: late.maxDelta,
    lead_changed_late: late.firstLeadLate !== late.lastLeadLate,
    decided_in_last5_turns: late.decidedInLast5,
    kills: statSelf.kills ?? null, carrier_kills: statSelf.carrier_kills ?? null, deaths: statSelf.deaths ?? deathSelf,
    self_vs_top_score_gap: r2(Math.max(...res.score) - res.score[self]),
  };
  const hooks = [];
  if (absurdity.zero_final) hooks.push({ key: 'ctf_zero_score', w: 60, tier: 1, note: `终场 0 分，同场其余 ${teams - 1} 家 ${Math.min(...res.score.filter((_, i) => i !== self))}–${Math.max(...res.score.filter((_, i) => i !== self))} 分` });
  if (absurdity.pick_without_return) hooks.push({ key: 'ctf_pick_no_return', w: 45, tier: 1, note: `抢过 ${absurdity.pickups} 次旗、零次搬回本垒` });
  else if ((statSelf.pickups || 0) >= 8 && (statSelf.captures || 0) <= 2) hooks.push({ key: 'ctf_pick_few_return', w: 45, tier: 1, note: `抢 ${statSelf.pickups} 次旗只搬回 ${statSelf.captures || 0} 次 —— 加时日志里那句「覆盖率够了，死在携旗转化」的同一回事` });
  if (maxWaitRun >= 12) hooks.push({ key: 'ctf_pinned_home', w: 42, tier: 1, note: `${unitsPerTeam} 个单位在第 ${marks.waitRun[0]}–${marks.waitRun[1]} 回合整队连续 WAIT ${maxWaitRun} 回合，钉在家里（第 17 页「三个单位钉在家里」的原始画面）` });
  if (carriedFrozenMax >= 10) hooks.push({ key: 'ctf_carry_sink', w: 26, tier: 2, note: `抱着旗原地沉底 ${carriedFrozenMax} 回合` });
  if (late.decided_in_last5_turns) hooks.push({ key: 'ctf_last5', w: 18, tier: 2, note: '最后 5 回合才分出榜首' });
  if (late.jumps >= 3) hooks.push({ key: 'ctf_rankflip', w: 20, tier: 2, note: `终盘 20% 内本人名次跳变 ${late.jumps} 次` });
  if (absurdity.last_place) hooks.push({ key: 'ctf_last_place', w: 16, note: `第 ${teams}/${teams} 名垫底` });
  if ((absurdity.faults || []).length) hooks.push({ key: 'ctf_fault', w: 34, tier: 2, note: `本局有 ${absurdity.faults.length} 次故障记录` });

  const tier = Math.min(9, ...hooks.filter((h) => h.tier).map((h) => h.tier), 9);
  const secPerTurn = CTF_SEC_PER_TURN; // viewer 300ms/回合 ÷ 默认 3×
  const density = frames.map((f) => {
    let s = 0;
    for (const e of f.events || []) {
      const mine = typeof e.unit === 'number' ? (idSet.has(e.unit) || Math.floor(e.unit / unitsPerTeam) === self) : false;
      if (e.type === 'capture') s += mine ? 8 : 4;
      else if (e.type === 'pickup') s += mine ? 6 : 2;
      else if (e.type === 'return') s += mine ? 7 : 3;
      else if (e.type === 'death') s += mine ? 1 : 0.6;
      else if (e.type === 'attack') s += mine ? 0.5 : 0.12;
      else if (e.type === 'respawn') s += 0.2;
    }
    if (f.turn >= frames.length * 0.8) s += 0.6;
    return s;
  });
  const anchors = [marks.waitRun && marks.waitRun[0], marks.lastReturn, marks.lastCapture, marks.lastPickup, marks.lastDeathSelf, frames.length - 1].filter((x) => Number.isFinite(x));
  // 版本归属：回放里第一槽有时直接写迭代版本号（v13 等）；否则看文件名前缀（v9_s3 = 加时窗口第 9 版、seed 3；fin8 = 加时终版 8 方）
  const fname = String(file).split('/').pop().replace(/\.json$/, '');
  const iterName = names[self] && names[self] !== 'bot' ? names[self] : null;
  const iterFromName = /^v(\d+[a-z]?)(?:_s|$)/.exec(fname);
  const isIteration = !!(iterName || iterFromName);
  const versionLabel = iterName ? `加时自迭代版 ${iterName}`
    : iterFromName ? `加时自迭代版 v${iterFromName[1]}（文件名）`
      : /^fin/.test(fname) ? 'ot（加时终版）'
        : /^diag/.test(fname) ? 'diag（诊断局）'
          : extra.version;
  const pages = [];
  if (isIteration) pages.push(PAGES.ctf.overtime);
  else if (extra.version === 'main') pages.push(PAGES.ctf.main);
  else if (extra.version === 'ot') pages.push(PAGES.ctf.result);
  if (teams === 2) pages.push(PAGES.ctf.reversal);
  if (hooks.some((h) => ['ctf_pinned_home', 'ctf_pick_no_return', 'ctf_pick_few_return', 'ctf_carry_sink'].includes(h.key))) pages.push(PAGES.ctf.overtime);
  if (hooks.some((h) => ['ctf_last5', 'ctf_rankflip'].includes(h.key))) pages.push(PAGES.ctf.result);
  return {
    game: 'ctf', path: file, group: extra.group, run: extra.run, version_label: versionLabel, tier,
    self_index: self, self_name: names[self], opponents: names.filter((_, i) => i !== self),
    board: `${hdr.size}x${hdr.size}`, players: teams, units_per_team: unitsPerTeam,
    mode: teams === 2 ? '双人对决' : `${teams} 队混战`,
    max_turns: hdr.rules.turns, turns: res.turns, frames: frames.length,
    final: { score: res.score, stats: res.stats, seed: res.seed, faults: (res.bots || []).map((b) => b.faults.length) },
    metrics: { absurdity, drama, hooks },
    rec: { sec_per_turn_source: 'ctf-gui1/viewer.html：300ms/回合 ÷ 默认 3×（回放不含 elapsed_seconds，无法按对局真实每回合耗时估）', sec_per_turn: secPerTurn, full_game_seconds_at_player_rate: r2(frames.length * secPerTurn), window: bestWindow(density, 30, secPerTurn, anchors) },
    pages: [...new Set(pages)],
    raw_score: 0,
  };
}

/* =================================================================== 主流程 */
const scan = { seen: 0, parsed: 0, skipped_not_self: 0, skipped_foreign_dirs: [] };
const pool = [];

/* --- 1) 官方示例目录：只登记文件名与大小，不解析内容 */
for (const d of ['land/replays', 'ctf/replays', 'bomberman/replays']) {
  const abs = P(SRC, d);
  scan.skipped_foreign_dirs.push({ dir: d, files: statOf(abs).length, total_bytes: statOf(abs).reduce((a, b) => a + b.bytes, 0), parsed: false, reason: '官方示例/他人对局，按纪律只列文件名与大小' });
}

/* --- 2) land 本人局（有逐回合帧的只有 contestants 下的自测回放） */
const LAND_SETS = [
  { rel: 'contestants/runs/land-gui1/rp', group: 'land-gui1/rp', version: 'main', label: '圈地正赛那一轮 · 交卷版 1v1 vs 贪心基准' },
  { rel: 'contestants/runs/land-gui1/rp4', group: 'land-gui1/rp4', version: 'main', label: '圈地正赛那一轮 · 交卷版 4 人混战 vs 贪心×3' },
  { rel: 'contestants/runs/land-gui2/dbg/replay', group: 'land-gui2/dbg/replay', version: 'ot', label: '圈地加时那一轮 · 1v1 vs 贪心基准' },
  { rel: 'contestants/runs/land-gui2/dbg/melee_base', group: 'land-gui2/dbg/melee_base', version: 'ot', label: '圈地加时那一轮 · vs 本人旧版 + 贪心×2' },
  { rel: 'contestants/runs/land-gui2/dbg/trace4', group: 'land-gui2/dbg/trace4', version: 'ot', label: '圈地加时那一轮 · 逐回合 trace 用局（4 人）' },
];
for (const s of LAND_SETS) {
  const dir = P(SRC, s.rel);
  for (const f of lsJson(dir)) {
    scan.seen++;
    try {
      const a = analyzeLand(P(dir, f), { group: s.group, version: s.version, label: s.label, run: 'contestants' });
      if (a) { scan.parsed++; pool.push(a); } else scan.skipped_not_self++;
    } catch (e) { console.warn('land parse fail', f, e.message); }
  }
}

/* --- 3) 炸弹人：本地手测回放全解析 */
// 版本归属：文件名里没有版本号，但 ITERATION_LOG.md 的「v4 10P 本地 5 种子」表给了
// (seed → 阵亡回合, 终分)，而 ten_N 就是 seed 200+N（同一份日志的采样说明），可以逐局对得上。
const BOMB_V4_TABLE = {
  202: { death_turn: 29, points: 2.5 }, 203: { death_turn: 80, points: 5 }, 204: { death_turn: 155, points: 9.5 },
  205: { death_turn: null, points: 9.5 }, 206: { death_turn: 68, points: 6 },
};
const localAttribution = [];
const BOMB_LOCAL = { rel: 'contestants/runs/bomberman-gui1/replays', group: 'bomberman-gui1/replays（本机手测）' };
{
  const dir = P(SRC, BOMB_LOCAL.rel);
  for (const f of lsJson(dir)) {
    scan.seen++;
    try {
      const a = analyzeBomb(P(dir, f), { group: BOMB_LOCAL.group, run: 'contestants', version: 'local-unattributed' });
      if (!a) { scan.skipped_not_self++; continue; }
      scan.parsed++;
      const m = /^ten_(\d)$/.exec(f.replace('.json', ''));
      if (m) {
        const seed = 200 + Number(m[1]);
        const exp = BOMB_V4_TABLE[seed];
        const got = { death_turn: a.metrics.absurdity.death_turn, points: a.final.points[a.self_index] };
        const hit = exp && exp.death_turn === got.death_turn && Math.abs(exp.points - got.points) < 1e-6;
        a.version_label = hit ? `v4 火焰修复后采样（seed ${seed}，与日志逐字对上）` : `旧版/v3 采样（seed ${seed}，与日志里的 v4 行不符）`;
        localAttribution.push({ file: f, seed, expected_v4: exp || null, observed: got, matches_v4: !!hit });
      } else localAttribution.push({ file: f, seed: null, note: '文件名不含版本线索，无法归属；只按内容判页' });
      pool.push(a);
    } catch (e) { console.warn('bomb local parse fail', f, e.message); }
  }
}

/* --- 4) 炸弹人：challenge-runs 大样本（先 results.json 粗筛，再精读被选中的局） */
const BOMB_RUNS = [];
{
  const base = P(SRC, 'bomberman/challenge-runs');
  if (exists(base)) for (const d of fs.readdirSync(base)) if (fs.statSync(P(base, d)).isDirectory()) BOMB_RUNS.push(d);
}
const bombRunScan = [];
const BOT_HASH = { 'bot-2d9c83320600': 'main（正赛交卷版）', 'bot-3650968bd41d': 'ot（加时终版）', 'bot-a4ca3e21d2f8': 'BASELINE-AS-BOT' };
for (const d of BOMB_RUNS) {
  const runDir = P(SRC, 'bomberman/challenge-runs', d);
  let version = 'unknown', baselineHash = null;
  try {
    const idj = readJson(P(runDir, 'identity.json'));
    baselineHash = idj && idj.engine_manifest && idj.engine_manifest['baseline.cpp'] ? String(idj.engine_manifest['baseline.cpp']).slice(0, 12) : null;
  } catch { /* identity.json 缺失就算了 */ }
  if (baselineHash) BOT_HASH[`bot-${baselineHash}`] = 'BASELINE-AS-BOT（那一轮「你的 bot」槽位装的是官方 baseline.cpp，不是 27B 写的）';
  try {
    const res0 = readJson(P(runDir, 'results.json'));
    const specs = new Set();
    for (const g of res0.slice(0, 40)) for (const s of (g.result.bot_specs || [])) { const m = /\/(bot-[0-9a-f]{12})$/.exec(s); if (m) specs.add(m[1]); }
    version = [...specs].map((h) => BOT_HASH[h] || h).join('+') || 'unknown';
  } catch { /* ignore */ }
  const isBaselineRun = version.includes('BASELINE-AS-BOT');
  const { games, selfGames, picked, faultTotal } = prescanBombRun(runDir, { run: d, version });
  bombRunScan.push({ run: d, version, fault_games_with_self: faultTotal, excluded_reason: isBaselineRun ? '「你的 bot」槽位 = 官方 baseline.cpp 的编译产物（bot-<sha256(baseline.cpp)[:12]>），不是本机 27B，按纪律不入选' : null, games_in_results_json: games, replay_files: statOf(P(runDir, 'replays')).length, deep_read: isBaselineRun ? 0 : picked.length, picked_matches: isBaselineRun ? [] : picked.map((p) => p.match) });
  if (isBaselineRun) continue;
  for (const p of picked) {
    if (!exists(p.file)) continue;
    scan.seen++;
    try {
      const a = analyzeBomb(p.file, { group: `bomberman/challenge-runs/${d}`, run: d, version: version.startsWith('main') ? 'main' : version.startsWith('ot') ? 'ot' : 'pre', rough_prescan: p.rough, match: p.match, faultTotal });
      if (a) { scan.parsed++; pool.push(a); } else scan.skipped_not_self++;
    } catch (e) { console.warn('bomb run parse fail', p.file, e.message); }
  }
}

/* --- 5) 夺旗：contestants 下全部本人局（含 diag8） */
const CTF_SETS = [
  { rel: 'contestants/runs/ctf-gui1/replays', group: 'ctf-gui1/replays（本机自测/正式混战局）', versionFor: (f) => (/^fin/.test(f) ? 'ot' : /^p8|^diag/.test(f) ? 'main' : 'main') },
  { rel: 'contestants/runs/ctf-gui1/replays/replays', group: 'ctf-gui1/replays/replays（diag8 所在）', versionFor: () => 'main' },
];
for (const s of CTF_SETS) {
  const dir = P(SRC, s.rel);
  for (const f of lsJson(dir)) {
    scan.seen++;
    try {
      const a = analyzeCtf(P(dir, f), { group: s.group, run: 'contestants', version: s.versionFor(f), assumeSelf: true });
      if (a) { scan.parsed++; pool.push(a); } else scan.skipped_not_self++;
    } catch (e) { console.warn('ctf parse fail', f, e.message); }
  }
}
// 夺旗/圈地的大样本目录有没有可录的逐回合回放？（结论写进 not_found）
const ctfRunReplays = [];
{
  const base = P(SRC, 'ctf/challenge-runs');
  if (exists(base)) for (const d of fs.readdirSync(base)) {
    const g = P(base, d, 'games');
    const r = P(base, d, 'replays');
    ctfRunReplays.push({ run: d, games_dir: exists(g) ? statOf(g).map((x) => x.file) : [], replays_dir: exists(r) });
  }
}
const landRunReplays = [];
{
  const base = P(SRC, 'land/challenge-runs');
  if (exists(base)) for (const d of fs.readdirSync(base)) {
    const rl = P(base, d, 'results.jsonl');
    let lines = 0, selfLines = 0;
    if (exists(rl)) { for (const ln of fs.readFileSync(rl, 'utf8').split('\n')) { if (!ln.trim()) continue; lines++; if (/your-bot@you/.test(ln)) selfLines++; } }
    landRunReplays.push({ run: d, results_jsonl_lines: lines, self_lines: selfLines, has_frames: exists(P(base, d, 'replays')), replay_files: statOf(P(base, d, 'replays')).length });
  }
}

/* ---------------------------------------------------------------- 打分 */
function scoreOne(a) {
  let absurd = 0, dramaS = 0, plot = 0, film = 0;
  const ab = a.metrics.absurdity, dr = a.metrics.drama;
  if (ab.zero_final) absurd += 30;
  if (ab.last_place) absurd += 18;
  if (a.game === 'ctf' && ab.pick_without_return) absurd += 25;
  if (a.game === 'ctf' && ab.units_pinned_home_max_run >= 12) absurd += 14;
  if (a.game === 'ctf' && ab.carrying_but_frozen_max_turns >= 10) absurd += 10;
  if (a.game === 'bomb' && ab.burned_at_own_feet) absurd += 12;
  if (a.game === 'bomb' && ab.blocked_moves_by_self >= 6) absurd += 8;
  if (a.game === 'land' && ab.longest_frozen_turns >= 8) absurd += 8;
  if (a.game === 'bomb' && ab.shrank_to_death) absurd += 5;

  if (dr.rank_jumps_late_20pct) dramaS += clamp(dr.rank_jumps_late_20pct * 5, 0, 22);
  if (dr.decided_in_last5_turns) dramaS += 12;
  if (dr.lead_changed_late) dramaS += 8;
  if (a.game === 'bomb') {
    if (dr.chain_max_bombs_in_one_turn >= 3) dramaS += 14;
    if (dr.one_for_many_turns) dramaS += 12;
    if (dr.deaths_late_20pct_self) dramaS += 8;
    if (dr.deaths_late_20pct_others >= 3) dramaS += 6;
  }
  if (a.game === 'land' && dr.respawns_late_20pct) dramaS += clamp(dr.respawns_late_20pct * 5, 0, 15);

  for (const h of a.metrics.hooks) plot += h.w;

  // 可录性：按「折算成秒」判，而不是按回合数 —— 圈地 600 回合只要 20 秒，十人炸弹人 600 回合要 120 秒
  const sizeNum = parseInt(String(a.board).split('x')[0], 10) || 0;
  film += sizeNum <= 17 ? 14 : sizeNum <= 25 ? 9 : sizeNum <= 41 ? 4 : 0;
  film += a.players === 2 ? 12 : a.players <= 4 ? 9 : a.players <= 8 ? 4 : 1;
  const sp = a.rec.sec_per_turn || a.rec.sec_per_turn_player_default || 0.2;
  const fullSec = (a.frames || a.turns) * sp;
  film += fullSec >= 15 && fullSec <= 45 ? 16 : fullSec <= 90 ? 8 : 2;
  const w = a.rec.window;
  const winSec = w ? w.frames * sp : 0;
  film += winSec >= 15 && winSec <= 40 ? 10 : 3;
  if (a.game === 'land' && !a.metrics.drama.rank_series_available) film -= 4; // 圈地帧里没有逐回合名次/面积，跳变看不出来

  a.score_breakdown = { absurd: r2(absurd), drama: r2(dramaS), plot: r2(plot), filmability: r2(film), total: r2(absurd + dramaS + plot + film) };
  return a.score_breakdown.total;
}
for (const a of pool) a.raw_score = scoreOne(a);

// 同局多来源去重：保留分最高的一条，其余记入 also_found_at
const seedOf = (a) => (a.game === 'land' ? a.final.seed : a.final.seed);
pool.sort((x, y) => y.raw_score - x.raw_score);
const seenKey = new Map(), dedup = [];
for (const a of pool) {
  const k = `${a.game}|${a.board}|${a.turns}|${seedOf(a)}|${JSON.stringify(a.final.points || a.final.score || a.final.areas)}`;
  if (seenKey.has(k)) { const f = dedup[seenKey.get(k)]; (f.also_found_at ||= []).push(a.path); continue; }
  seenKey.set(k, dedup.length); dedup.push(a);
}

// 节目效果排序：先按剧情点层级（tier 1 = 片子里已写好的桥段，回放能对上就首选），再按总分
dedup.sort((x, y) => ((x.tier ?? 9) - (y.tier ?? 9)) || (y.raw_score - x.raw_score));

/* 一句话看点 */
function highlight(a) {
  const hs = a.metrics.hooks.filter((h) => h.w > 0).map((h) => h.note);
  if (hs.length) return hs[0];
  if (a.game === 'land') return `40 格 600 回合，面积 ${a.final.areas[a.self_index]} vs 冠军 ${Math.max(...a.final.areas)}，第 ${a.final.ranks[a.self_index]} 名`;
  if (a.game === 'bomb') return `终分 ${a.final.points[a.self_index]}、第 ${a.final.ranks[a.self_index]}/${a.players} 名，用掉 ${a.turns} 回合`;
  return `终分 ${a.final.score[a.self_index]}、第 ${a.metrics.absurdity.last_place ? a.players : rankOf(a)}/${a.players} 队`;
}
function rankOf(a) { const s = a.final.score, me = s[a.self_index]; return s.filter((v) => v > me).length + 1; }

const rowify = (a, i) => {
  const sp = a.rec.sec_per_turn || 0.2;
  const caveats = [];
  if (a.game === 'land') caveats.push('land 回放帧只含 pos/moves，没有逐回合面积与墙归属，名次跳变与「围死出口」只能按停留时长间接判断');
  if (a.game === 'land') caveats.push('圈地本人局只有 contestants 下的自测回放；大样本（1128 局）没有 frames，录不出来');
  if (a.game === 'bomb' && /local-unattributed|ten_/.test(String(a.version_label))) caveats.push('版本归属靠文件名与 ITERATION_LOG 的 (seed, 阵亡回合, 终分) 对齐，非直接标注');
  if (a.game === 'bomb' && a.rec.sec_per_turn_real) caveats.push(`该局评测真实耗时 ${a.final.elapsed_seconds}s（${a.rec.sec_per_turn_real}s/回合，7 并发下含排队），录屏请按播放器 0.2s/回合`);
  if (a.game === 'ctf') caveats.push('ctf 回放不含 elapsed_seconds，秒数按 viewer 默认 3× 折算');
  if (a.also_found_at) caveats.push(`同局另见：${a.also_found_at.join(' , ')}`);
  return {
    rank: i + 1, path: a.path, game: a.game, group: a.group, run: a.run, version_label: a.version_label, tier: a.tier ?? 9,
    sides: [`${a.self_name}（本机 27B）`, ...a.opponents.map(String)],
    players: a.players, board: a.board, turns: a.turns, max_turns: a.max_turns, frames: a.frames,
    final_result: a.game === 'ctf' ? `score ${JSON.stringify(a.final.score)}（本人 ${a.final.score[a.self_index]}）`
      : a.game === 'bomb' ? `points ${JSON.stringify(a.final.points)}（本人 ${a.final.points[a.self_index]}），ranks ${JSON.stringify(a.final.ranks)}${a.final.errors[a.self_index] ? `，errors ${JSON.stringify(a.final.errors)}` : ''}`
        : `areas ${JSON.stringify(a.final.areas)}（本人 ${a.final.areas[a.self_index]}），ranks ${JSON.stringify(a.final.ranks)}`,
    highlight: highlight(a),
    score: a.score_breakdown,
    recommended_window: a.rec.window,
    window_seconds_at_player_rate: a.rec.window ? r2(a.rec.window.frames * sp) : null,
    full_game_seconds_at_player_rate: a.rec.full_game_seconds_at_player_rate ?? r2((a.frames || a.turns) * sp),
    timing_basis: a.rec.sec_per_turn_source,
    pages: a.pages,
    hooks: a.metrics.hooks.map((h) => `${h.key}${h.w ? `（+${h.w}）` : '（0，仅备注）'}: ${h.note}`),
    caveats,
  };
};
const top_overall = dedup.slice(0, 12).map(rowify);
// 交付表要三场都有、正赛版与加时版都要有代表、同一种看点不许刷屏：先分桶取额，再按看点去冗
const capKey = (a) => (a.game === 'bomb' ? (a.run === 'contestants' ? 'bomb-手测' : `bomb-${a.version_label}`) : a.game);
const QUOTA = { land: 3, 'bomb-main': 3, 'bomb-ot': 1, 'bomb-手测': 3, 'bomb-pre': 1, ctf: 5 };
const buckets = {};
for (const a of dedup) (buckets[capKey(a)] ||= []).push(a);
let queue = [];
for (const [k, q] of Object.entries(QUOTA)) queue.push(...(buckets[k] || []).slice(0, q));
queue.sort((x, y) => ((x.tier ?? 9) - (y.tier ?? 9)) || (y.raw_score - x.raw_score));
for (const a of dedup) if (!queue.includes(a)) queue.push(a); // 名额没占满时用剩余高分补齐
const vk = (s) => String(s || '').replace(/v\d+[a-z]?/g, 'vN'); // v1/v2/v8 这种迭代号算同一种看点，别刷屏
const leadTag = (a) => `${(a.metrics.hooks.find((h) => h.tier === 1) || a.metrics.hooks[0] || { key: 'none' }).key}@${vk(a.version_label)}`;
const tagCnt = {}, pickedRows = [], perGame = { land: 0, bomb: 0, ctf: 0 };
const take = (a) => {
  if (pickedRows.includes(a) || tagCnt[leadTag(a)]) return false;
  tagCnt[leadTag(a)] = 1; pickedRows.push(a); perGame[a.game]++; return true;
};
// 同一种看点只留一个代表（版本不同算不同看点，好做正赛版/加时版前后对照），并按场次保底配额铺满三场
const FLOOR = { ctf: 5, bomb: 4, land: 3 };
for (const g of ['ctf', 'bomb', 'land']) for (const a of queue) {
  if (perGame[g] >= FLOOR[g] || pickedRows.length >= 12) break;
  if (a.game === g) take(a);
}
for (const a of queue) { if (pickedRows.length >= 12) break; take(a); }
pickedRows.sort((x, y) => ((x.tier ?? 9) - (y.tier ?? 9)) || (y.raw_score - x.raw_score));
const top = pickedRows.map(rowify);

/* ctf 自测局构成（第 16 页「五十四局自测全是两方局」的核对） */
const ctfPool = dedup.filter((a) => a.game === 'ctf');
const ctfByTeams = {};
for (const a of ctfPool) ctfByTeams[a.players] = (ctfByTeams[a.players] || 0) + 1;

/* 火焰截断（memcpy 只拷 625 字节 = 格子序号 0..311）取证 */
const bombAll = dedup.filter((a) => a.game === 'bomb');
const blindHits = bombAll.filter((a) => a.metrics.hooks.some((h) => h.key === 'bomb_flame_blind_zone')).map((a) => ({
  path: a.path, board: a.board, death_turn: a.metrics.absurdity.death_turn, death_cell: a.metrics.absurdity.died_at_cell_index, group: a.group, version_label: a.version_label,
}));
const blindSizes = {};
for (const a of bombAll) { const n = parseInt(a.board, 10); blindSizes[`${n}×${n}=${n * n}格${n * n > 312 ? '（截断可发作）' : '（安全区）'}`] = (blindSizes[`${n}×${n}=${n * n}格${n * n > 312 ? '（截断可发作）' : '（安全区）'}`] || 0) + 1; }

const out = {
  generated_at: new Date().toISOString(),
  script: 'pipeline/clip-mining.mjs',
  source_root: SRC,
  discipline: {
    read_only: true,
    no_evaluate_no_referee_no_compile: true,
    no_gpu_used: true,
    no_network: true,
    official_sample_dirs_listed_only: scan.skipped_foreign_dirs,
  },
  self_identity: SELF_TOKENS,
  scan_stats: { ...scan, pool_after_dedup: dedup.length },
  scoring: {
    weights: {
      absurd: '终场 0 分 +30 / 全场垫底 +18 / 夺旗抢旗零搬回 +25 / 整队钉家 +14 / 抱旗沉底 +10 / 炸弹人脚下雷 +12 / 被自己堵死 +8 / 圈地原地不动 +8 / 缩圈挤死 +5',
      drama: '终盘 20% 名次跳变 每次×5（封顶 22）/ 最后 5 回合定胜负 +12 / 终盘换榜首 +8 / 单回合 ≥3 连爆 +14 / 一回合自拿 2 杀以上 +12 / 本人终盘阵亡 +8',
      plot: '命中片子已写好的桥段，权重量级最高并单独分层（tier 1 优先排）：炸弹人故障局 +60、火焰盲区致死 +55、夺旗零分 +60、圈地被贪心反超 +60、混战垫底 +42、钉在家里 +42、抢旗不搬回 +45、连环爆 +26、自雷炸死 +34、零分垫底 +30',
      filmability: '棋盘尺寸 +14/9/4；2 人 +12、≤4 人 +9、≤8 人 +4、10 人 +1；整局折算秒数落在 15–45 秒 +16（圈地 600 回合 = 20 秒、夺旗 400 回合 = 40 秒、13 格双人炸弹人只有 5 秒要放慢）；推荐窗口 15–40 秒 +10；圈地帧里没有逐回合名次 −4',
    },
    tier_definition: { 1: '片子里已写好的桥段，回放能直接对上（首选）', 2: '强节目效果但不在既定桥段里', 3: '正常对局，仅补充画面', 9: '无桥段命中' },
    window_rule: '滑窗取事件密度最大处；窗长 = 30 秒 ÷ 每回合秒数（炸弹人 0.2s@5 回合每秒、夺旗 0.1s@3×、圈地 0.0333s@30 回合每秒）；窗口必须盖住锚点回合（故障回合 > 盲区阵亡回合 > 最大连锁爆 > 本人阵亡 > 终盘），圈地窗长算下来 ≥600 帧，等于整局一镜到底',
    sort_rule: '先 tier 升序，再总分降序；交付表按场次配额取 12 行（圈地 4 / 炸弹人 5 / 夺旗 4），纯分数前 12 另存在 top_by_score_only',
  },
  candidates: dedup.map((a) => ({
    path: a.path, game: a.game, group: a.group, run: a.run, version_label: a.version_label, tier: a.tier ?? 9,
    self_index: a.self_index, self_name: a.self_name, opponents: a.opponents,
    board: a.board, players: a.players, turns: a.turns, max_turns: a.max_turns, frames: a.frames,
    final: a.final, metrics: a.metrics, score: a.score_breakdown, recommended_window: a.rec.window, timing_basis: a.rec.sec_per_turn_source, pages: a.pages,
  })),
  top,
  top_by_score_only: top_overall,
  bomb_local_replay_attribution: localAttribution,
  playback_driving_notes: {
    bomb_replay_html: '控件：#play（播放/暂停，按钮文案随之变）、#prev、#next、#reset（重播并自动开播）、#seek（type=range，max=frames.length-1，绑定 oninput）、#speed（2/5/10/20 回合每秒，默认 5）、#film（录制模式，切 body.film 隐藏侧栏）、#full（requestFullscreen）、#file（导入任意回放 JSON）。键盘：Space 播放/暂停、← → 单步、f 录制模式、r 重播。数据内嵌在 <script> 里，无 fetch。起始回合可用 URL hash：r11.html#turn=120（load() 里按 frames.findIndex(f=>f.turn>=requested) 定位，但定位后 playing=false，不会自动播）。顶层 let data/index/playing 不挂 window，CDP 只能通过 seek+input 事件或点按钮驱动，可以按回合区间精确录。',
    ctf_viewer_html: '控件：#play、#prev、#next、#seek（range）、#speed（1×/3×/8×/20×，默认 3×，tick 里 300ms/回合 ÷ 倍速）、#keys（「跳到关键回合」下拉，选项由回放事件生成）。无 hash / query 入口，只能靠 DOM 事件驱动。',
    land_viewer_html: '路径 land/workspace/viewer/viewer.html：#play、#prev、#next、#scrub（range）、#speed（5/15/30/60/200 回合每秒，默认 30）、#pick + <input type=file multiple> 与拖拽 drop 导入 JSON，也支持 load(files) 批量。没有 hash 定位，且必须先导入 json 才有内容 —— 无头脚本要先塞文件（或改用它自带的 replays/index.html 那种内嵌 EMBEDDED 的生成页）。',
  },
  ctf_selftest_team_composition: ctfByTeams,
  bomb_challenge_runs: bombRunScan,
  ctf_pinned_home_ranking: dedup.filter((a) => a.game === 'ctf' && a.metrics.absurdity.units_pinned_home_max_run > 0)
    .sort((x, y) => y.metrics.absurdity.units_pinned_home_max_run - x.metrics.absurdity.units_pinned_home_max_run).slice(0, 10)
    .map((a) => ({ path: a.path, teams: a.players, max_all_WAIT_run: a.metrics.absurdity.units_pinned_home_max_run, total_WAIT_frames: a.metrics.absurdity.units_pinned_home_frames, self_score: a.final.score[a.self_index], version_label: a.version_label })),
  flame_truncation_evidence: {
    corrected_condition: '用户描述里的「棋盘边长 >312 格」应为「格子序号 ≥312」：memcpy(R.flame, FL, 625) 拷的是字节数，R.flame 是 int16_t[625]=1250 字节，只拷 625 字节 = 前 312 个格子（索引 0..311）。所以边长 13（169 格）、17（289 格）全在安全区，边长 25（625 格）的后半盘火焰全丢 —— 发作的正是 10 人档，不是「超大棋盘」',
    sizes_seen: blindSizes,
    games_where_self_died_on_a_blind_cell_with_visible_flame: blindHits,
    count: blindHits.length,
  },
  land_challenge_runs_frames_availability: landRunReplays,
  ctf_challenge_runs_replays_availability: ctfRunReplays,
  not_found: [],
};

/* 未找到项，如实记录 */
const landSelfLines = landRunReplays.reduce((a, b) => a + b.self_lines, 0);
const maxPinned = Math.max(0, ...dedup.filter((a) => a.game === 'ctf').map((a) => a.metrics.absurdity.units_pinned_home_max_run));
const nCtf = dedup.filter((a) => a.game === 'ctf').length;
out.not_found.push(
  { item: '圈地大样本里本人局（your-bot@you）的逐回合回放', status: '未找到', checked: ['land/challenge-runs/*/：只有 results.jsonl + ratings.json/md，没有 replays 目录；results.jsonl 每行只有 mode/seed/names/winner/ranks/areas/turns/deaths/kills/timeouts/errors/max_ms，无 frames', 'land/results/games.jsonl.gz：官方他人对局，按纪律未解析', 'land/tournament/make_replay_page.py：写死把 land/replays/*.json（官方示例目录）嵌进 viewer，不产出本人局', 'contestants/runs/land-gui1、land-gui2：没有名为 replays 的目录，本人回放散在 rp/、rp4/、dbg/replay/、dbg/melee_base/'], note: `大样本里带 your-bot@you 的行共 ${landSelfLines} 行（9 轮 run 累计），全是统计没有帧，录不出画面` },
  { item: '夺旗大样本（1016 局）的逐回合回放', status: '未找到', checked: ['ctf/challenge-runs/*/games/：成绩.json / 成绩.md / 结果.jsonl / 赛程.json，无 replays 目录'], note: `夺旗能录的只有 contestants/runs/ctf-gui1/replays 下这 ${nCtf} 局` },
  { item: '圈地「第 6 步长考 34.9 分钟后写出的第一版被官方贪心基准反超」的那一局', status: '那一局本身未找到，同版代码的等价画面找到了', note: '大样本只留统计（duel 12.9 / melee 0 / Elo −313），没有 frames；能录的是 land-gui1/rp（同一版 bot.cpp vs 贪心基准，6 局里 5 局被反超）与 land-gui1/rp4（4 人混战 vs 贪心×3，本人 4 次垫底）' },
  { item: '夺旗加时日志里那句「3 单位钉死本基地 350 回合 0 分」的原始回放', status: maxPinned >= 300 ? '已找到' : `未找到那么长的（实测最长 ${maxPinned} 回合）`, note: (() => {
    const ranked = dedup.filter((a) => a.game === 'ctf' && a.metrics.absurdity.units_pinned_home_max_run > 0).sort((x, y) => y.metrics.absurdity.units_pinned_home_max_run - x.metrics.absurdity.units_pinned_home_max_run);
    const t = ranked[0];
    return t ? `${nCtf} 局可录夺旗回放里，本队 3 个单位整队 WAIT 的最长连续段是 ${maxPinned} 回合（${t.path.replace(SRC, '')}，累计 ${t.metrics.absurdity.units_pinned_home_frames} 帧，终场 ${t.final.score[t.self_index]} 分）。够拍「蹲着不动」这一镜，但撑不起日志里「350 回合」那个数量级 —— 那句是对 v9 多人档的复盘描述，没留下对应回放` : '没有任何一局出现整队 WAIT';
  })() },
  { item: '炸弹人「半张棋盘看不见火」在 2P/4P 档发作的局', status: '不存在（设计如此，不是缺数据）', note: `size=13（169 格）与 17（289 格）都在 312 之前，memcpy 截断伤不到；只有 size=25（625 格）的 10 人档中招。实测命中盲区致死的 ${blindHits.length} 局，见 flame_truncation_evidence` },
);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`扫描 ${scan.seen} 个文件，解析本人局 ${scan.parsed}，去重后 ${dedup.length}，Top ${top.length} 已写入 ${OUT}`);
for (const t of top) console.log(`  #${t.rank} [${t.game}] ${t.score.total} ${t.path.replace(SRC, '')} — ${t.highlight} | 窗口 ${t.recommended_window ? t.recommended_window.turn_start + '–' + t.recommended_window.turn_end : 'n/a'} | 页 ${t.pages.join(',')}`);
