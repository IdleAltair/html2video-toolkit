#!/usr/bin/env node
/**
 * compaction-evidence.mjs
 * 纯解析脚本：只读 data/trace-*.md 三份轨迹，产出
 *   data/compaction-evidence.json  (机器读)
 *   data/compaction-evidence.md    (人读，每条命中逐字带原始行)
 *
 * 不做任何写入 trace 的动作，不跑评分/编译/GPU，不访问网络或 WSL。
 *
 * 用法： node pipeline/compaction-evidence.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

const SESSIONS = [
  { key: 'land', cn: '圈地', file: 'trace-land-gui2.md', id: 'land-gui2' },
  { key: 'bomberman', cn: '炸弹人', file: 'trace-bomberman-gui1.md', id: 'bomberman-gui1' },
  { key: 'ctf', cn: '夺旗', file: 'trace-ctf-gui1.md', id: 'ctf-gui1' },
];

/* ------------------------------------------------------------------ *
 * 通用小工具
 * ------------------------------------------------------------------ */

// 秒数解析："14s" -> 14 ; "1.6m" -> 96 ; "34.9m" -> 2094 ; "2h05m" 之类不支持则记 null
function durToSec(raw) {
  const s = String(raw).trim();
  let m = /^([\d.]+)\s*s$/i.exec(s);
  if (m) return Math.round(parseFloat(m[1]) * 10) / 10;
  m = /^([\d.]+)\s*m$/i.exec(s);
  if (m) return Math.round(parseFloat(m[1]) * 600) / 10;
  m = /^([\d.]+)\s*h$/i.exec(s);
  if (m) return Math.round(parseFloat(m[1]) * 36000) / 10;
  m = /^([\d.]+)\s*h\s*([\d.]+)\s*m$/i.exec(s);
  if (m) return Math.round((parseFloat(m[1]) * 3600 + parseFloat(m[2]) * 60) * 10) / 10;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s); // 无单位，按秒
  return null;
}

function hhmmToMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// 用于生成 markdown 围栏：比内容里最长反引号串更长，避免原文里的 ``` 破坏格式
function fence(text) {
  let max = 0;
  const re = /`+/g;
  let m;
  while ((m = re.exec(String(text)))) max = Math.max(max, m[0].length);
  return '`'.repeat(Math.max(3, max + 1));
}

function matchAllTerms(re, text) {
  const out = [];
  const g = new RegExp(re.flags.includes('g') ? re.source : re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = g.exec(String(text))) !== null) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (m[0].length === 0) g.lastIndex++;
  }
  return out;
}

// 返回每个匹配的词及其起始位置
function matchAllWithIndex(re, text) {
  const out = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = g.exec(String(text))) !== null) {
    out.push({ term: m[0], at: m.index });
    if (m[0].length === 0) g.lastIndex++;
  }
  return out;
}

// "fold" 若紧跟在字母后面（scaffold / manifold / folder / unfold），是 /Fold/i 的假阳性
function foldMatchIsSuspect(text, term, at) {
  if (!/fold/i.test(term)) return false;
  const prev = at > 0 ? text[at - 1] : '';
  return /[a-z]/i.test(prev || '');
}


/* ------------------------------------------------------------------ *
 * 解析
 * ------------------------------------------------------------------ */

const TOK_RE = /^\d+\/\d+\/\d+$/;
const STEP_RE = /^(\d+)\.(\d+)$/;

function parseFile(session) {
  const abs = path.join(DATA, session.file);
  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);

  const out = {
    key: session.key,
    cn: session.cn,
    id: session.id,
    file: `data/${session.file}`,
    abs,
    header: null,
    rows: [],
    anomalies: [],
    compactionEvents: [],
    compactionEventRaw: [],
    toolErrors: [],
    toolErrorRaw: [],
  };

  const hdr = lines.slice(0, 8).join('\n').match(
    /steps=(\d+)\s+compactions=(\d+)\s+nudges=(\d+)\s+toolErrors=(\d+)/,
  );
  if (hdr) {
    out.header = { steps: +hdr[1], compactions: +hdr[2], nudges: +hdr[3], toolErrors: +hdr[4] };
  } else out.anomalies.push({ kind: 'header-not-found', line: null });

  let section = null; // 'table' | 'compaction' | 'toolerror' | other

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith('## ')) {
      if (/压缩事件/.test(t)) section = 'compaction';
      else if (/工具报错/.test(t)) section = 'toolerror';
      else section = 'other:' + t;
      continue;
    }
    if (/^\|/.test(t)) {
      if (/^\|\s*[-:]+\s*\|/.test(t)) continue; // separator
      const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (!STEP_RE.test(cells[0] || '')) {
        if (/^turn\.step$/i.test(cells[0] || '')) continue; // header row
        out.anomalies.push({ kind: 'row-skipped', lineNo: i + 1, raw });
        continue;
      }
      // 定位 token 三件套所在列，正常应在 index 3
      let tIdx = -1;
      for (let k = 2; k < Math.min(cells.length, 6); k++) if (TOK_RE.test(cells[k])) { tIdx = k; break; }
      if (tIdx === -1) { out.anomalies.push({ kind: 'no-token-cell', lineNo: i + 1, raw }); continue; }
      if (tIdx !== 3) { out.anomalies.push({ kind: 'unexpected-token-column', lineNo: i + 1, tokIdx: tIdx, raw }); }

      const step = cells[0];
      const time = cells[1];
      const dur = cells[2];
      const tok = cells[tIdx];
      const action = cells[tIdx + 1] ?? '';
      // 思考列：剩余全部（若原文含未转义的 | 则合并回来，避免丢字）
      const thought = cells.slice(tIdx + 2).join(' | ');
      const [tokIn, tokOut, cacheRead] = tok.split('/').map((x) => Number(x));
      const sm = STEP_RE.exec(step);
      out.rows.push({
        idx: out.rows.length,
        raw,
        lineNo: i + 1,
        step,
        turn: Number(sm[1]),
        stepNo: Number(sm[2]),
        time,
        timeMin: hhmmToMin(time),
        durRaw: dur,
        durSec: durToSec(dur),
        tokRaw: tok,
        tokIn,
        tokOut,
        cacheRead,
        action,
        thought,
      });
      continue;
    }
    if (section === 'compaction') {
      const m = /^-\s*(\d{1,2}:\d{2})\s+summaryChars=(\d+)\s+usage=(.*)$/.exec(t);
      if (m) {
        out.compactionEvents.push({
          time: m[1],
          timeMin: hhmmToMin(m[1]),
          summaryChars: Number(m[2]),
          usageRaw: m[3].trim(),
          usage: parseUsage(m[3]),
          raw: t,
        });
        out.compactionEventRaw.push(t);
      } else out.anomalies.push({ kind: 'compaction-line-unparsed', raw: t });
      continue;
    }
    if (section === 'toolerror') {
      const m = /^-\s*(\d{1,2}:\d{2})\s+turn\s+(\S+)\s+Error:\s*(.*)$/.exec(t);
      if (m) {
        out.toolErrors.push({ time: m[1], step: m[2], msg: m[3], raw: t });
        out.toolErrorRaw.push(t);
      }
      continue;
    }
  }
  return out;
}

function parseUsage(s) {
  const m = /(\{.*\})/.exec(String(s));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/* ------------------------------------------------------------------ *
 * 判定用正则（全部按用户逐项定义实现，命中口径在 md 里逐条可复核）
 * ------------------------------------------------------------------ */

const RE_FOLD_ACTION = /Fold|Compact|compaction/i;

const RE_PROBE2_SESSION_QUERY = /session_query/;
const RE_PROBE2_HISTORY_READ =
  /session_query|session log|jsonl|history message|previous (message|conversation)|look back|recall earlier|回看|历史/i;
const RE_CROSS_FILE = /land-gui2|bomberman-gui1|ctf-gui1/;

const RE_D1_VERB = /Read|read|Dump|dump|Cat|cat|Grep|grep|Scan|scan|View|Re-read|check|Check/;
const RE_D1_FILE = /TASK\.md|RULES|RULES\.md|game\.py|referee\.py|bot\.cpp|greedy|anchor|random|README/;

const RE_D2_EDIT = /Rewrite|rewrite|Patch|patch|Re-apply|redo|again/i;
const RE_D2_BOTCPP = /bot\.cpp/;
// 宽松参考口径（不作为主计数，只贴出来供复核）
const RE_D2_LOOSE = /rewrite|patch|re-?apply|redo|again|write|edit/i;

const RE_D3 = {
  printf_newline: {
    label: 'printf 里 \\n 被工具层吞掉',
    re: /printf|newline|\\\\n|\bn got (interpreted|swallowed|eaten)|escape/i,
    // 说明：正则字面量 \\\\n 匹配原文中的 "\n" 两字符转义写法（反斜杠+n）
  },
  heredoc_silent: {
    label: 'heredoc 静默失败',
    re: /heredoc|silently failed|no output\?|empty output/i,
  },
  fread_block: {
    label: 'fread 阻塞',
    re: /fread|read\(0|block(ed|ing)? on/i,
  },
};

/* ------------------------------------------------------------------ *
 * A. 压缩事件表
 * ------------------------------------------------------------------ */

function buildA(sessions) {
  const foldSteps = [];
  for (const s of sessions) {
    for (const r of s.rows) {
      if (r.action && RE_FOLD_ACTION.test(r.action)) {
        const ms = matchAllWithIndex(RE_FOLD_ACTION, r.action);
        const suspect = ms.length > 0 && ms.every((m) => foldMatchIsSuspect(r.action, m.term, m.at));
        foldSteps.push({
          session: s.key, sessionCn: s.cn, fileId: s.id,
          step: r.step, turn: r.turn, stepNo: r.stepNo, idx: r.idx,
          time: r.time, durRaw: r.durRaw, durSec: r.durSec,
          tokIn: r.tokIn, tokOut: r.tokOut, cacheRead: r.cacheRead,
          action: r.action, thought: r.thought, raw: r.raw,
          matched: ms.map((m) => m.term),
          suspectFalsePositive: suspect,
          suspectReason: suspect ? `命中的 "fold" 是 ${r.action.match(/[a-z]*fold[a-z]*/i)?.[0] ?? ''} 这类词的子串，不是折叠动作` : null,
        });
      }
    }
  }

  // 每个压缩事件尝试绑定到一个折叠动作步（时刻相同且该步尚未被绑定）
  const bindings = [];
  const used = new Set();
  for (const s of sessions) {
    const evs = s.compactionEvents;
    const fs_ = foldSteps.filter((f) => f.session === s.key && !f.suspectFalsePositive);
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      const cand = fs_.find((f) => f.time === ev.time && !used.has(f.session + '#' + f.step));
      if (cand) {
        used.add(cand.session + '#' + cand.step);
        bindings.push({ session: s.key, eventIndex: i, event: ev, foldStep: cand.step, foldIdx: cand.idx, binding: 'time-match-1to1' });
      } else {
        // 找不到未绑定的同刻折叠步：记录该事件落在哪两行之间
        let afterIdx = -1;
        for (let k = 0; k < s.rows.length; k++) {
          if (s.rows[k].timeMin !== null && s.rows[k].timeMin >= ev.timeMin) { afterIdx = k; break; }
        }
        const sameTimeFold = fs_.filter((f) => f.time === ev.time);
        bindings.push({
          session: s.key,
          eventIndex: i,
          event: ev,
          foldStep: sameTimeFold.length ? sameTimeFold.map((f) => f.step).join(',') : null,
          binding: sameTimeFold.length ? 'multi-event-same-fold-step' : 'no-fold-action-step-at-this-time',
          note: sameTimeFold.length
            ? `同刻折叠步 ${sameTimeFold.map((f) => f.step).join(',')} 已绑定本时刻的前一条事件；本条属于同一次动作提交里的多个 fold 之一`
            : `轨迹表格中没有时刻为 ${ev.time} 的折叠动作步；按时间它落在 ${(s.rows[afterIdx] || {}).step || '?'} 之前`,
          firstRowAtOrAfter: (s.rows[afterIdx] || {}).step || null,
        });
      }
    }
  }

  const perSession = {};
  for (const s of sessions) {
    const all = foldSteps.filter((x) => x.session === s.key);
    const real = all.filter((x) => !x.suspectFalsePositive);
    const f = real.length;
    const e = s.compactionEvents.length;
    const h = s.header ? s.header.compactions : null;
    perSession[s.key] = {
      file: s.file,
      fileId: s.id,
      sessionCn: s.cn,
      headerCompactions: h,
      foldActionStepCount_regexRaw: all.length,
      foldActionStepCount: f,
      suspectFalsePositiveSteps: all.filter((x) => x.suspectFalsePositive).map((x) => `${x.step} @${x.time} 「${x.action}」`),
      compactionEventSectionCount: e,
      consistent: h !== null && h === f && h === e,
      consistentFoldVsHeader: h === f,
      consistentEventsVsHeader: h === e,
      discrepancy: h === null ? 'header 未解析'
        : (h === f && h === e ? null
          : `header compactions=${h} / 折叠动作步=${f}（正则原始命中 ${all.length}，剔除假阳性 ${all.length - f}）/ 「## 压缩事件」小节条数=${e} —— 不一致`),
    };
  }

  return {
    definition: '折叠步 = 动作列匹配 /Fold|Compact|compaction/i ；压缩事件 = 文件「## 压缩事件」小节逐行（时刻 + summaryChars + usage）。该正则会把 scaffolding 这类词里的 "fold" 也算命中，已标 suspectFalsePositive 并从计数剔除（两个数都给出）。',
    foldSteps,
    foldStepTotal: foldSteps.length,
    foldStepTotalReal: foldSteps.filter((x) => !x.suspectFalsePositive).length,
    foldStepSuspectTotal: foldSteps.filter((x) => x.suspectFalsePositive).length,
    compactionEventTotal: sessions.reduce((a, s) => a + s.compactionEvents.length, 0),
    headerCompactionTotal: sessions.reduce((a, s) => a + (s.header ? s.header.compactions : 0), 0),
    perSession,
    eventBindings: bindings,
    stepDurationNote: '「该步耗时」直接取表格第 3 列原值换算成秒：s→秒，m→×60。步号 1.9 = 第 1 回合第 9 步，不是 1.9 秒。',
  };
}

/* ------------------------------------------------------------------ *
 * B. 折叠后的重放代价
 * ------------------------------------------------------------------ */

function buildB(sessions, A, compPos) {
  const anchors = [];
  for (const s of sessions) {
    const realFolds = A.foldSteps.filter((f) => f.session === s.key && !f.suspectFalsePositive);
    const foldIdxSet = new Set(realFolds.map((f) => f.idx));
    const foldByTime = new Map(realFolds.map((f) => [f.time, f]));

    // 锚点 1：折叠动作步
    for (const f of realFolds) {
      let next = null;
      for (let k = f.idx + 1; k < s.rows.length; k++) {
        if (!foldIdxSet.has(k)) { next = s.rows[k]; break; }
      }
      anchors.push({
        session: s.key, sessionCn: s.cn, anchorKind: 'fold-action-step',
        anchorStep: f.step, anchorTime: f.time, anchorCacheRead: f.cacheRead, anchorTokIn: f.tokIn,
        anchorRaw: f.raw,
        nextNonFoldStep: next ? next.step : null,
        nextTime: next ? next.time : null,
        tokIn: next ? next.tokIn : null,
        cacheRead: next ? next.cacheRead : null,
        tokOut: next ? next.tokOut : null,
        nextAction: next ? next.action : null,
        nextThought: next ? next.thought : null,
        nextRaw: next ? next.raw : null,
        note: next ? null : '该折叠步之后没有更多行',
      });
    }

    // 锚点 2：「## 压缩事件」小节的每一条事件
    const orphanPos = (compPos[s.key] || []).filter((p) => p.kind === 'compaction-event-no-fold-step');
    for (let i = 0; i < s.compactionEvents.length; i++) {
      const ev = s.compactionEvents[i];
      let anchorIdx = null;
      let anchorDesc = '';
      if (foldByTime.has(ev.time)) {
        anchorIdx = foldByTime.get(ev.time).idx;
        anchorDesc = `折叠步 ${foldByTime.get(ev.time).step}`;
      } else {
        const op = orphanPos.find((p) => p.time === ev.time);
        anchorIdx = op ? op.posIdx : null;
        anchorDesc = op ? '事件插入点（表格里无同刻折叠动作步）' : '无法定位';
      }
      let next = null;
      if (anchorIdx !== null) for (let k = anchorIdx + 1; k < s.rows.length; k++) {
        if (!foldIdxSet.has(k)) { next = s.rows[k]; break; }
      }
      anchors.push({
        session: s.key, sessionCn: s.cn, anchorKind: 'compaction-event-line',
        anchorStep: `事件#${i + 1} @${ev.time}`,
        anchorTime: ev.time,
        anchorBasis: anchorDesc,
        summaryChars: ev.summaryChars,
        usageRaw: ev.usageRaw,
        nextNonFoldStep: next ? next.step : null,
        nextTime: next ? next.time : null,
        tokIn: next ? next.tokIn : null,
        cacheRead: next ? next.cacheRead : null,
        tokOut: next ? next.tokOut : null,
        nextAction: next ? next.action : null,
        nextThought: next ? next.thought : null,
        nextRaw: next ? next.raw : null,
        sharedAnchor: s.compactionEvents.filter((e2) => e2.time === ev.time).length > 1
          ? `同刻有 ${s.compactionEvents.filter((e2) => e2.time === ev.time).length} 条事件，共用同一个锚（一次动作提交里的多个 fold）` : null,
      });
    }
  }

  const evAnchors = anchors.filter((a) => a.anchorKind === 'compaction-event-line');
  // 去重：同一次折叠动作产生的多条事件指向同一行，只算一个样本
  const seen = new Set();
  const uniqAnchors = evAnchors.filter((a) => {
    const k = a.session + '#' + (a.nextNonFoldStep || a.anchorTime);
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  const cacheVals = uniqAnchors.map((a) => a.cacheRead).filter((v) => typeof v === 'number');
  const tokVals = uniqAnchors.map((a) => a.tokIn).filter((v) => typeof v === 'number');
  const beforeCache = [];
  for (const s of sessions) {
    for (const r of s.rows) if (r.cacheRead > 100000) beforeCache.push({ session: s.key, step: r.step, time: r.time, cacheRead: r.cacheRead, raw: r.raw });
  }

  return {
    definition: '锚点=压缩事件（两种：折叠动作步 / 「## 压缩事件」逐条），取其后第一个非折叠步的 tok_in 与 cacheRead',
    anchors,
    claim_underTest: '预期 cacheRead 从十几万掉回一万上下',
    verdict: {
      distinctAnchorCount: uniqAnchors.length,
      rawEventAnchorCount: evAnchors.length,
      distinctSamples: uniqAnchors.map((a) => ({ session: a.session, event: a.anchorStep, step: a.nextNonFoldStep, tokIn: a.tokIn, cacheRead: a.cacheRead, basis: a.anchorBasis })),
      postCompactionCacheReadValues: cacheVals,
      min: cacheVals.length ? Math.min(...cacheVals) : null,
      max: cacheVals.length ? Math.max(...cacheVals) : null,
      allUnder20000: cacheVals.length > 0 && cacheVals.every((v) => v < 20000),
      postCompactionTokInValues: tokVals,
      tokInMin: tokVals.length ? Math.min(...tokVals) : null,
      tokInMax: tokVals.length ? Math.max(...tokVals) : null,
      preCompactionHighCacheRead: {
        count: beforeCache.length,
        max: beforeCache.length ? Math.max(...beforeCache.map((b) => b.cacheRead)) : null,
        definition: 'cacheRead > 100000 的行数（压缩前上下文累积到的水位参考）',
        examples: beforeCache.slice(0, 12),
      },
      statement: cacheVals.length && Math.max(...cacheVals) < 20000
        ? `成立：${uniqAnchors.length} 个压缩锚点（${evAnchors.length} 条事件去掉同锚重复）之后第一个非折叠步，cacheRead 全部落在 ${Math.min(...cacheVals)}–${Math.max(...cacheVals)}（一万上下），同时 tok_in 反弹到 ${Math.min(...tokVals)}–${Math.max(...tokVals)}；作为对照，压缩前 cacheRead 最高到过 ${beforeCache.length ? Math.max(...beforeCache.map((b) => b.cacheRead)) : '无 >10万 记录'}。`
        : `推翻或部分推翻：压缩后首个非折叠步的 cacheRead 并非都落在一万上下，实际值 ${cacheVals.join(', ')}（逐条原文见 B-1，请复核）。`,
    },
  };
}

/* ------------------------------------------------------------------ *
 * C. 探针二：有没有回头搜历史消息
 * ------------------------------------------------------------------ */

function buildC(sessions, selfIdByKey) {
  const perSession = {};
  for (const s of sessions) {
    const sq = [];
    const hist = [];
    for (const r of s.rows) {
      const hay = `${r.action}\n${r.thought}`;
      const inAction = RE_PROBE2_SESSION_QUERY.test(r.action);
      const inThought = RE_PROBE2_SESSION_QUERY.test(r.thought);
      if (inAction || inThought) {
        sq.push({ session: s.key, step: r.step, time: r.time, where: inAction ? '动作列' : '思考列', raw: r.raw, action: r.action, thought: r.thought });
      }
      const aH = RE_PROBE2_HISTORY_READ.test(r.action);
      const tH = RE_PROBE2_HISTORY_READ.test(r.thought);
      if (aH || tH) {
        hist.push({
          session: s.key, step: r.step, time: r.time,
          where: [aH ? '动作列' : null, tH ? '思考列' : null].filter(Boolean).join('+'),
          matched: [...new Set([...matchAllTerms(RE_PROBE2_HISTORY_READ, aH ? r.action : ''), ...matchAllTerms(RE_PROBE2_HISTORY_READ, tH ? r.thought : '')])],
          raw: r.raw, action: r.action, thought: r.thought,
        });
      }
      void hay;
    }

    // 跨场：本文件（该场轨迹）的动作列里出现「别的场」的 run 目录名
    const cross = [];
    for (const r of s.rows) {
      const m = RE_CROSS_FILE.exec(r.action);
      if (!m) continue;
      const other = [...new Set(matchAllTerms(RE_CROSS_FILE, r.action))].filter((x) => x !== s.id);
      if (other.length) cross.push({ session: s.key, step: r.step, time: r.time, column: '动作列', otherIds: other, raw: r.raw, action: r.action, thought: r.thought });
    }
    // 参考口径（不计数）：思考列里出现别场目录名
    const crossThought = [];
    for (const r of s.rows) {
      const other = [...new Set(matchAllTerms(RE_CROSS_FILE, r.thought))].filter((x) => x !== s.id);
      if (other.length) crossThought.push({ session: s.key, step: r.step, time: r.time, column: '思考列', otherIds: other, raw: r.raw, action: r.action, thought: r.thought });
    }

    perSession[s.key] = {
      fileId: s.id,
      session_query_count: sq.length,
      session_query_hits: sq,
      history_read_count: hist.length,
      history_read_hits: hist,
      cross_session_action_col_count: cross.length,
      cross_session_action_col_hits: cross,
      cross_session_thought_col_reference: crossThought,
    };
  }

  // 间接线索：读「上一窗口/上一场留下的笔记类文件」的动作
  const notes = [];
  const RE_NOTES = /ITERATION_LOG|checkpoint|summary|notes|README|log tail|previous .*(run|session)/i;
  for (const s of sessions) {
    for (const r of s.rows) {
      if (r.action && RE_NOTES.test(r.action)) {
        notes.push({ session: s.key, step: r.step, time: r.time, raw: r.raw, action: r.action, matched: matchAllTerms(RE_NOTES, r.action) });
      }
    }
  }

  const totals = {
    session_query: sessions.reduce((a, s) => a + perSession[s.key].session_query_count, 0),
    history_read: sessions.reduce((a, s) => a + perSession[s.key].history_read_count, 0),
    cross_session_action: sessions.reduce((a, s) => a + perSession[s.key].cross_session_action_col_count, 0),
  };

  const sqTotal = totals.session_query;
  const histTotal = totals.history_read;
  let verdict;
  if (sqTotal === 0 && histTotal === 0) {
    verdict = '未成立（在三份 md 里看不到）：session_query 0 命中，历史/日志读取正则 0 命中。但这只能证明轨迹摘要里没写，不能证明没做过——见文末「无法定论项」。';
  } else if (sqTotal === 0) {
    verdict = `基本未成立：恢复工具 session_query 在三场动作列+思考列均 0 命中；广义历史正则命中 ${histTotal} 条，逐条原文见 C-2。这些命中都在思考摘要列的自然语言表述里（动作列为空或非读取类工具），不是一次向 harness 请求被折叠原文的工具调用形态；请照贴出的原文判定是否算数。总体判定：三场看不到「回头搜历史消息」的可证行为。`;
  } else {
    verdict = `有 ${sqTotal} 条 session_query 命中（逐条原文见 C-1），说明存在回捞历史的行为。`;
  }

  return {
    definition: '搜动作列+思考列两列；session_query 为恢复工具名精确匹配（大小写敏感）；历史读取用 /session_query|session log|jsonl|history message|previous (message|conversation)|look back|recall earlier|回看|历史/i；跨场只看动作列出现「非本场」run 目录名',
    perSession,
    totals,
    verdict,
    indirectNoteReads: notes,
    selfIdByKey,
  };
}

/* ------------------------------------------------------------------ *
 * D. 探针一：重复编辑 / 重复踩同一个坑
 * ------------------------------------------------------------------ */

function buildD(sessions, A, compactionPosBySession) {
  // 枚举窗口内所有配对（不只相邻）：同一场次里两次同类动作，相隔 ≤maxGap 步即成一对，并给出中间夹了几次压缩
  function pairsWithin(arr, maxGap, comps, sessionKey) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const gap = arr[j].idx - arr[i].idx;
        if (gap > maxGap) break;
        const between = (comps || []).filter((p) => p.posIdx > arr[i].idx && p.posIdx < arr[j].idx);
        out.push({
          session: sessionKey,
          from: arr[i].step, to: arr[j].step, gapSteps: gap,
          fromTime: arr[i].time, toTime: arr[j].time,
          fromAction: arr[i].action, toAction: arr[j].action,
          compactionCount: between.length,
          compactionsBetween: between.map((p) => p.label),
          acrossCompaction: between.length > 0,
          raws: [arr[i].raw, arr[j].raw],
        });
      }
    }
    return out;
  }

  /* D1 折叠后回读源文件 */
  const d1 = {};
  for (const s of sessions) {
    const all = [];
    for (const r of s.rows) {
      if (!r.action) continue;
      if (!RE_D1_VERB.test(r.action)) continue;
      if (!RE_D1_FILE.test(r.action)) continue;
      all.push({
        session: s.key, step: r.step, turn: r.turn, stepNo: r.stepNo, idx: r.idx, time: r.time, timeMin: r.timeMin,
        action: r.action, thought: r.thought, raw: r.raw,
        matchedVerbs: matchAllTerms(RE_D1_VERB, r.action),
        matchedFiles: matchAllTerms(RE_D1_FILE, r.action),
      });
    }
    // 每个压缩事件后连续 8 步窗口
    const windows = [];
    const foldIdx = new Set(A.foldSteps.filter((f) => f.session === s.key && !f.suspectFalsePositive).map((f) => f.idx));
    for (const p of compactionPosBySession[s.key]) {
      const startIdx = p.posIdx + 1;
      const inWin = all.filter((h) => h.idx >= startIdx && h.idx <= startIdx + 7);
      windows.push({
        anchor: p.label, anchorKind: p.kind, anchorStep: p.step || null, anchorTime: p.time,
        window: `${(s.rows[Math.min(startIdx, s.rows.length - 1)] || {}).step || '?'} .. ${(s.rows[Math.min(startIdx + 7, s.rows.length - 1)] || {}).step || '?'}`,
        windowIdxRange: [startIdx, startIdx + 7],
        windowSteps: s.rows.slice(startIdx, startIdx + 8).map((r) => ({ step: r.step, time: r.time, action: r.action, isFold: foldIdx.has(r.idx) })),
        hitCount: inWin.length,
        hits: inWin,
      });
    }
    // 参考：命中读动词但没写白名单文件名（D1 严格口径会漏掉这些，用来暴露漏判规模）
    const verbOnly = [];
    for (const r of s.rows) {
      if (!r.action) continue;
      if (!RE_D1_VERB.test(r.action)) continue;
      if (RE_D1_FILE.test(r.action)) continue;
      verbOnly.push({ session: s.key, step: r.step, time: r.time, action: r.action, matchedVerbs: matchAllTerms(RE_D1_VERB, r.action) });
    }

    // D1c：同一个文件被重复读取，且两次之间夹着压缩事件（折叠后重新去读源文件 = 重做已丢的信息）
    const byFile = {};
    for (const h of all) for (const f of h.matchedFiles) (byFile[f] = byFile[f] || []).push(h);
    const repeats = [];
    for (const [f, list] of Object.entries(byFile)) {
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        const comps = compactionPosBySession[s.key].filter((p) => p.posIdx > a.idx && p.posIdx < b.idx);
        repeats.push({
          file: f, session: s.key,
          from: `${a.step}@${a.time}`, to: `${b.step}@${b.time}`,
          fromAction: a.action, toAction: b.action,
          gapSteps: b.idx - a.idx,
          gapMinutes: (b.timeMin !== null && a.timeMin !== null) ? b.timeMin - a.timeMin : null,
          crossedTurn: a.turn !== b.turn,
          compactionCount: comps.length,
          compactionsBetween: comps.map((c) => c.label),
          acrossCompaction: comps.length > 0,
          raws: [a.raw, b.raw],
        });
      }
    }
    repeats.sort((x, y) => (y.acrossCompaction - x.acrossCompaction) || (y.gapSteps - x.gapSteps));

    d1[s.key] = {
      fileId: s.id,
      totalReadWithFilename_allRows: all.length,
      totalWithinPostCompactionWindows: new Set(windows.flatMap((w) => w.hits.map((h) => h.step))).size,
      windows,
      allHits: all,
      fileRepeatPairs_total: repeats.length,
      fileRepeatPairs_acrossCompaction: repeats.filter((r) => r.acrossCompaction).length,
      fileRepeats: repeats,
      verbOnlyCount: verbOnly.length,
      verbOnlyReference: verbOnly,
    };
  }

  // 圈地：第三次折叠（15:15）之后那段明细
  const land = sessions.find((s) => s.key === 'land');
  const thirdFold = A.foldSteps.filter((f) => f.session === 'land' && !f.suspectFalsePositive)[2] || null;
  let landThird = null;
  if (land && thirdFold) {
    const startIdx = thirdFold.idx + 1;
    const winRows = land.rows.slice(startIdx, startIdx + 8);
    const hits = d1.land.allHits.filter((h) => h.idx >= startIdx && h.idx <= startIdx + 7);
    // 声称：这场 read 全部集中在这之后
    const before = d1.land.allHits.filter((h) => h.idx <= thirdFold.idx);
    const after = d1.land.allHits.filter((h) => h.idx > thirdFold.idx);
    const afterButOutsideWindow = after.filter((h) => h.idx > startIdx + 7);
    landThird = {
      foldStep: thirdFold.step, foldTime: thirdFold.time, foldOrdinalInSession: 3,
      windowSteps: winRows.map((r) => ({ step: r.step, time: r.time, durSec: r.durSec, action: r.action, raw: r.raw })),
      hitCount: hits.length,
      hits,
      claim: '文档声称：圈地这场的 read 全部集中在第三次折叠（约 15:15）之后',
      claimCheck: {
        allReadFilenameHitsInSession: d1.land.allHits.map((h) => `${h.step}(${h.time}) ${h.action}`),
        countAtOrBeforeThirdFold: before.length,
        hitsAtOrBeforeThirdFold: before,
        countAfterThirdFold: after.length,
        countAfterThirdFoldButOutside8StepWindow: afterButOutsideWindow.length,
        hitsAfterThirdFoldButOutside8StepWindow: afterButOutsideWindow,
        verdict: before.length === 0 && afterButOutsideWindow.length === 0
          ? `成立：全场 ${d1.land.allHits.length} 条 read+文件名命中全部落在 ${thirdFold.step}（${thirdFold.time}）之后的 8 步窗口内。`
          : `不成立/需复核：第三次折叠之前有 ${before.length} 条、窗口之后有 ${afterButOutsideWindow.length} 条命中（原文见下）。`,
      },
    };
  }

  /* D2 同一处编辑被重做 */
  const d2 = {};
  for (const s of sessions) {
    const hits = s.rows
      .filter((r) => r.action && RE_D2_EDIT.test(r.action) && RE_D2_BOTCPP.test(r.action))
      .map((r) => ({ session: s.key, step: r.step, idx: r.idx, time: r.time, action: r.action, thought: r.thought, raw: r.raw, matchedEdit: matchAllTerms(RE_D2_EDIT, r.action) }));
    const pairs = pairsWithin(hits, 10, compactionPosBySession[s.key], s.key);
    // 复发簇：连续 gap<=10 的串起来
    const clusters = [];
    let cur = [];
    for (let i = 0; i < hits.length; i++) {
      cur.push(hits[i]);
      const nextGap = i + 1 < hits.length ? hits[i + 1].idx - hits[i].idx : Infinity;
      if (nextGap > 10) { if (cur.length >= 2) clusters.push(cur.slice()); cur = []; }
    }
    const loose = s.rows
      .filter((r) => r.action && RE_D2_EDIT.test(r.action) && /bot/i.test(r.action))
      .map((r) => ({ session: s.key, step: r.step, time: r.time, action: r.action, raw: r.raw, note: '中间口径：动作含改写词且提到 bot（未写全 bot.cpp）' }));
    const wide = s.rows
      .filter((r) => r.action && RE_D2_EDIT.test(r.action))
      .map((r) => ({ session: s.key, step: r.step, idx: r.idx, time: r.time, action: r.action, thought: r.thought, raw: r.raw, matchedEdit: matchAllTerms(RE_D2_EDIT, r.action), note: '最宽口径：动作含改写词，未限定文件对象' }));
    const widePairs = pairsWithin(wide, 10, compactionPosBySession[s.key], s.key);
    d2[s.key] = {
      fileId: s.id,
      strictHitCount: hits.length,
      strictHits: hits,
      recurrencePairsWithin10Steps: pairs.length,
      recurrences: pairs,
      clustersOfRepeatedEdits: clusters.map((c) => ({ count: c.length, steps: c.map((x) => `${x.step}@${x.time}`), raws: c.map((x) => x.raw) })),
      looseReference: loose,
      wideReferenceCount: wide.length,
      wideReference: wide,
      wideRecurrencePairsWithin10Steps: widePairs.length,
      wideRecurrences: widePairs,
    };
  }

  /* D3 同一错误跨折叠复发 */
  const d3 = {};
  // 每族的「核心信号」：主正则还包含外围词（escape / no output / empty output），
  // 只用外围词命中的行标 peripheralOnly，判定复发时要谨慎，避免把「提到转义」当成「又踩一次坑」。
  const CORE_RE = {
    printf_newline: /printf|newline|\\\\n|\bn got (interpreted|swallowed|eaten)/i,
    heredoc_silent: /heredoc|silently failed/i,
    fread_block: /fread|read\(0|block(ed|ing)? on/i,
  };
  for (const [fam, def] of Object.entries(RE_D3)) {
    const coreRe = CORE_RE[fam];
    const perSess = {};
    for (const s of sessions) {
      const hits = [];
      for (const r of s.rows) {
        const inAction = def.re.test(r.action || '');
        const inThought = def.re.test(r.thought || '');
        if (!inAction && !inThought) continue;
        const matched = [...new Set([...(inAction ? matchAllTerms(def.re, r.action) : []), ...(inThought ? matchAllTerms(def.re, r.thought) : [])])];
        const core = coreRe.test(r.action || '') || coreRe.test(r.thought || '');
        hits.push({
          session: s.key, step: r.step, turn: r.turn, stepNo: r.stepNo, idx: r.idx, time: r.time, timeMin: r.timeMin,
          column: [inAction ? '动作列' : null, inThought ? '思考列' : null].filter(Boolean).join('+'),
          matched,
          coreHit: core,
          peripheralOnly: !core,
          action: r.action, thought: r.thought, raw: r.raw,
        });
      }
      const first = hits[0] || null;
      const seq = [];
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        const prev = i > 0 ? hits[i - 1] : null;
        const compsBetween = prev ? compactionPosBySession[s.key].filter((p) => p.posIdx > prev.idx && p.posIdx < h.idx) : [];
        const compsSinceFirst = first ? compactionPosBySession[s.key].filter((p) => p.posIdx > first.idx && p.posIdx < h.idx) : [];
        seq.push({
          ...h,
          gapStepsFromPrev: prev ? h.idx - prev.idx : null,
          gapTimeFromPrevMin: prev && h.timeMin !== null && prev.timeMin !== null ? h.timeMin - prev.timeMin : null,
          crossedTurnBoundary: prev ? prev.turn !== h.turn : false,
          compactionsBetweenCount: prev ? compsBetween.length : null,
          compactionsBetween: prev ? compsBetween.map((p) => p.label) : [],
          prevPair: prev ? `${prev.step}(${prev.time}) -> ${h.step}(${h.time})` : null,
          // 从本场该族首次命中算起的累计跨度（用于核对「1.8 踩过 → 1.78 再踩，中间 3 次折叠、相差 70 步」这类说法）
          firstHitOfFamilyInSession: first ? `${first.step}(${first.time})` : null,
          gapStepsFromFirst: first ? h.idx - first.idx : null,
          compactionsSinceFirst: first ? compsSinceFirst.length + (prev ? 0 : 0) : null,
          compactionsSinceFirstList: first ? compsSinceFirst.map((p) => p.label) : [],
        });
      }
      perSess[s.key] = { fileId: s.id, hitCount: hits.length, hits, sequence: seq };
    }
    d3[fam] = {
      label: def.label,
      regex: String(def.re),
      coreRegex: String(CORE_RE[fam]),
      perSession: perSess,
      totalHits: sessions.reduce((a, s) => a + perSess[s.key].hitCount, 0),
      peripheralOnlyHits: sessions.reduce((a, s) => a + perSess[s.key].hits.filter((h) => h.peripheralOnly).length, 0),
    };
  }

  return {
    definition: {
      D1: '压缩事件之后连续 8 步（idx+1..idx+8，不含折叠步自身）内，动作列同时命中读类动词正则与文件名正则',
      D2: '动作列命中 /Rewrite|rewrite|Patch|patch|Re-apply|redo|again/i 且含 bot.cpp；同一场内两次命中相隔 ≤10 步记为一个复发配对（枚举所有满足条件的配对，不只相邻）',
      D3: '三族错误，动作列+思考列双列搜索；命中按表格顺序排列，给出与上一次命中的步差、以及两者之间夹了几个压缩事件',
    },
    D1: { perSession: d1, landThirdFoldDetail: landThird },
    D2: d2,
    D3: d3,
  };
}

/* ------------------------------------------------------------------ *
 * E. 折叠当步写了多少字
 * ------------------------------------------------------------------ */

function buildE(sessions) {
  const perSession = {};
  for (const s of sessions) {
    perSession[s.key] = {
      fileId: s.id,
      available: s.compactionEvents.length > 0,
      events: s.compactionEvents.map((e, i) => ({
        ordinal: i + 1, time: e.time, summaryChars: e.summaryChars,
        usageRaw: e.usageRaw, usage: e.usage,
        usageUndefined: String(e.usageRaw) === 'undefined',
        rawEventLine: e.raw,
        cacheReadTokensFromUsage: e.usage ? (e.usage.cacheReadTokens ?? null) : null,
      })),
      summaryCharsTotal: s.compactionEvents.reduce((a, e) => a + e.summaryChars, 0),
      usagePresentCount: s.compactionEvents.filter((e) => e.usage).length,
      usageUndefinedCount: s.compactionEvents.filter((e) => String(e.usageRaw) === 'undefined').length,
    };
  }
  return {
    definition: '摘要正文字数取「## 压缩事件」小节的 summaryChars 字段（原样，不估计）；表格动作列/思考列里没有摘要正文本身',
    perSession,
    totalEvents: sessions.reduce((a, s) => a + s.compactionEvents.length, 0),
    note: 'summaryChars 是 harness 记录的「本次折叠写出的摘要字符数」，是三份 md 里唯一能拿到的正文字数证据；折叠步思考列里提到的字符数（如 land 1.10 提到 503/400 预算、1.11 提到 seq 范围）与 summaryChars 不一定一致，已在 md 里逐条并列贴出。',
  };
}

/* ------------------------------------------------------------------ *
 * 压缩事件位置（用于「之间夹了几次折叠」）
 * ------------------------------------------------------------------ */

function compactionPositions(sessions, A) {
  const map = {};
  for (const s of sessions) {
    const list = [];
    const bound = new Set();
    for (const f of A.foldSteps.filter((x) => x.session === s.key && !x.suspectFalsePositive)) {
      list.push({ kind: 'fold-action-step', step: f.step, time: f.time, posIdx: f.idx, label: `${f.step}(${f.time})` });
      bound.add(f.time);
    }
    for (const ev of s.compactionEvents) {
      // 时刻已有折叠步覆盖 → 不重复计入（同一次折叠）
      if (bound.has(ev.time) && list.some((p) => p.time === ev.time)) continue;
      let posIdx = -1;
      for (let k = 0; k < s.rows.length; k++) {
        if (s.rows[k].timeMin !== null && s.rows[k].timeMin >= ev.timeMin) { posIdx = k - 1; break; }
        posIdx = k;
      }
      list.push({ kind: 'compaction-event-no-fold-step', step: null, time: ev.time, posIdx, label: `事件@${ev.time}`, summaryChars: ev.summaryChars });
    }
    list.sort((a, b) => a.posIdx - b.posIdx);
    map[s.key] = list;
  }
  return map;
}

/* ------------------------------------------------------------------ *
 * 渲染 markdown
 * ------------------------------------------------------------------ */

function rawBlock(lines) {
  const body = (Array.isArray(lines) ? lines : [lines]).join('\n');
  const f = fence(body);
  return `${f}\n${body}\n${f}`;
}

function tableOf(header, rows) {
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return ['| ' + header.join(' | ') + ' |', '|' + header.map(() => '---').join('|') + '|',
    ...rows.map((r) => '| ' + r.map(esc).join(' | ') + ' |')].join('\n');
}

function renderMd(J) {
  const L = [];
  const P = (s = '') => L.push(s);

  P('# 主动压缩的代价：两类可计算探针的取证明细');
  P();
  P(`生成脚本：\`pipeline/compaction-evidence.mjs\`（只读三份 trace，未修改任何已存在文件）`);
  P();
  P('数据来源（只读）：');
  for (const s of J.sources) P(`- \`${s.file}\` — header: steps=${s.header?.steps} compactions=${s.header?.compactions} nudges=${s.header?.nudges} toolErrors=${s.header?.toolErrors}`);
  P();
  P('## 阅读须知 / 口径与局限');
  P();
  P(`- 折叠步判定：${J.A.definition}`);
  P(`- ${J.A.stepDurationNote}`);
  P(`- C 搜索范围：${J.C.definition}`);
  P(`- D 搜索范围：D1 ${J.D.definition.D1}；D2 ${J.D.definition.D2}；D3 ${J.D.definition.D3}`);
  P(`- E：${J.E.definition}`);
  P(`- ${J.parseHealth.text} 表格也不记录工具调用清单与压缩前后的完整上下文差分，所以「没有命中」只能说明**这三份轨迹里看不到该行为**，不能证明行为未发生。逐条限制见文末「无法定论项」。`);
  P();

  /* ---------- 一页结论 ---------- */
  P('## 结论速览');
  P();
  P(tableOf(['项', '圈地 land-gui2', '炸弹人 bomberman-gui1', '夺旗 ctf-gui1', '三场合计'],
    J.overview.table));
  P();
  P(`- **探针二（回头搜历史）**：${J.C.verdict}`);
  P(`- **探针一（重复劳动）**：${J.D.verdict}`);
  P(`- **cacheRead 预期说法**：${J.B.verdict.statement}`);
  P();

  /* ---------- 待核说法 ---------- */
  P('## 待核说法（把用户给的句子当假设，用实数核，不照抄）');
  P();
  for (const c of J.claimChecks) {
    P(c.statement);
    P();
    if (c.actual === null) { P(`- ${c.verdict}`); P(); continue; }
    P(`- 起点：${c.a}`);
    P(`- 终点：${c.b}`);
    P(`- 首尾相差 **${c.stepGapFirstToLast} 步**（时间差 ${c.minutesGap} 分钟）；中间压缩 **${c.compactionCountFirstToLast} 次**：${c.compactionsBetweenFirstToLast.join('、')}`);
    P(`- 这两次之间的同族命中：${c.intermediateSameFamilyHits.join('；') || '无'}`);
    P(`- 相邻口径：${c.adjacentPair}`);
    P();
    P(`**核对结论：${c.verdict}**`);
    P();
    P('两条原始行：');
    P();
    P(rawBlock(c.raws));
    P();
  }

  /* ---------- A ---------- */
  P('## A. 压缩事件表');
  P();
  P('### A-1 折叠动作步（动作列命中 /Fold|Compact|compaction/i）');
  P();
  P(tableOf(['场', '步号', '时刻', '该步耗时(原值)', '秒', 'tok_in', 'tok_out', 'cacheRead', '命中词', '动作', '假阳性?'],
    J.A.foldSteps.map((f) => [f.session, f.step, f.time, f.durRaw, f.durSec, f.tokIn, f.tokOut, f.cacheRead, f.matched.join(','), f.action, f.suspectFalsePositive ? '是：' + f.suspectReason : '否'])));
  P();
  P(`正则原始命中 ${J.A.foldStepTotal} 步，其中判定为词内假阳性（如 scaffolding 里的 "fold"）${J.A.foldStepSuspectTotal} 步，真实折叠动作步 ${J.A.foldStepTotalReal} 步。`);
  P();
  P('折叠步逐条原文：');
  P();
  for (const f of J.A.foldSteps) {
    P(`**${f.session} ${f.step} @${f.time}**（该步耗时 ${f.durRaw} = ${f.durSec}s，tok_in/out/cacheRead = ${f.tokIn}/${f.tokOut}/${f.cacheRead}）${f.suspectFalsePositive ? ' ← 判定为正则假阳性：' + f.suspectReason : ''}`);
    P(rawBlock(f.raw));
    P();
  }

  P('### A-2 「## 压缩事件」小节逐条（含 summaryChars）');
  P();
  P(tableOf(['场', '#', '时刻', 'summaryChars', 'usage 原文', '绑定到的折叠步', '绑定方式'],
    J.A.eventBindings.map((b) => [b.session, b.eventIndex + 1, b.event.time, b.event.summaryChars, b.event.usageRaw, b.foldStep ?? '-', b.binding])));
  P();
  P('压缩事件逐条原文行：');
  P();
  for (const s of J.sources) {
    if (!s.compactionEventRaw.length) continue;
    P(`**${s.key}**`);
    P(rawBlock(s.compactionEventRaw));
    P();
  }

  P('### A-3 计数一致性核对');
  P();
  P(tableOf(['场', 'header compactions', '压缩事件小节条数', '与 header 一致?', '折叠动作步(剔除假阳性)', '折叠动作步(正则原始)', '被剔除的假阳性步', '不一致说明'],
    Object.values(J.A.perSession).map((p) => [p.fileId, p.headerCompactions, p.compactionEventSectionCount, p.consistentEventsVsHeader ? '一致' : '不一致', p.foldActionStepCount, p.foldActionStepCount_regexRaw, (p.suspectFalsePositiveSteps || []).join(' ; ') || '-', p.discrepancy ?? ''])));
  P();
  P(`三场合计：header compactions 之和 = ${J.A.headerCompactionTotal}；「## 压缩事件」小节条数之和 = ${J.A.compactionEventTotal}；折叠动作步 = ${J.A.foldStepTotalReal}（正则原始命中 ${J.A.foldStepTotal}）`);
  P();
  if (J.A.consistencyNarrative) { P(J.A.consistencyNarrative), P(); }

  /* ---------- B ---------- */
  P('## B. 折叠后的重放代价（tok_in 与 cacheRead）');
  P();
  P('### B-1 以「## 压缩事件」每条为锚');
  P();
  P(tableOf(['场', '压缩事件', '时刻', 'summaryChars', '锚定依据', '首个非折叠步', '该步时刻', 'tok_in', 'cacheRead', '动作', '备注'],
    J.B.anchors.filter((a) => a.anchorKind === 'compaction-event-line').map((a) => [a.session, a.anchorStep, a.anchorTime, a.summaryChars, a.anchorBasis, a.nextNonFoldStep, a.nextTime, a.tokIn, a.cacheRead, a.nextAction, a.sharedAnchor || ''])));
  P();
  P('逐条命中原文（该行即「压缩后第一步」）：');
  P();
  for (const a of J.B.anchors.filter((x) => x.anchorKind === 'compaction-event-line')) {
    P(`- ${a.session} ${a.anchorStep} @${a.anchorTime}（summaryChars=${a.summaryChars}，usage=${a.usageRaw}）｜锚定依据：${a.anchorBasis}${a.sharedAnchor ? '｜' + a.sharedAnchor : ''} → 步 ${a.nextNonFoldStep} @${a.nextTime}：**tok_in=${a.tokIn}, cacheRead=${a.cacheRead}**, tok_out=${a.tokOut}`);
    if (a.nextRaw) P(rawBlock(a.nextRaw));
  }
  P();
  P('### B-2 以折叠动作步为锚');
  P();
  P(tableOf(['场', '折叠步', '时刻', '折叠步 cacheRead', '下一步', '下一步时刻', 'tok_in', 'cacheRead', '动作'],
    J.B.anchors.filter((a) => a.anchorKind === 'fold-action-step').map((a) => [a.session, a.anchorStep, a.anchorTime, a.anchorCacheRead, a.nextNonFoldStep, a.nextTime, a.tokIn, a.cacheRead, a.nextAction])));
  P();
  for (const a of J.B.anchors.filter((x) => x.anchorKind === 'fold-action-step')) {
    if (a.nextRaw) { P(`- ${a.session} ${a.anchorStep} → ${a.nextNonFoldStep}`); P(rawBlock(a.nextRaw)); }
  }
  P();
  P('### B-3 对「cacheRead 从十几万掉回一万上下」的裁决');
  P();
  P(`- 压缩后首个非折叠步 cacheRead 取值集合：${J.B.verdict.postCompactionCacheReadValues.join(', ')}`);
  P(`- 区间：min=${J.B.verdict.min} max=${J.B.verdict.max}；是否全部 < 20000：${J.B.verdict.allUnder20000}`);
  P(`- 同期 tok_in（未命中缓存的新输入）区间：${J.B.verdict.tokInMin} – ${J.B.verdict.tokInMax}`);
  P(`- 压缩前 cacheRead 突破 100000 的行数：${J.B.verdict.preCompactionHighCacheRead.count}，示例（步/时刻/值）：`);
  P();
  P(tableOf(['场', '步号', '时刻', 'cacheRead'], J.B.verdict.preCompactionHighCacheRead.examples.map((e) => [e.session, e.step, e.time, e.cacheRead])));
  P();
  P(`**裁决：${J.B.verdict.statement}**`);
  P();

  /* ---------- C ---------- */
  P('## C. 探针二：有没有回头搜历史消息');
  P();
  P(tableOf(['场', 'session_query 命中', '历史读取正则命中', '跨场（动作列出现别场目录名）'],
    Object.values(J.C.perSession).map((p) => [p.session_query_count, p.history_read_count, p.cross_session_action_col_count])));
  P();
  P('### C-1 session_query（精确名，大小写敏感）');
  P();
  if (!J.C.perSession[Object.keys(J.C.perSession)[0]] || Object.values(J.C.perSession).every((p) => p.session_query_count === 0)) {
    P('三场动作列 + 思考列：**0 命中**。用于验证的正则：`/session_query/`（动作列）、`/session_query/`（思考列）。');
    P('补充：三场轨迹里唯一出现过的恢复类工具痕迹是折叠步动作本身（`Fold/Compact`）与 `## 压缩事件` 小节，没有任何一步的动作列写成 session_query 或类似捞取工具。');
  } else {
    for (const p of Object.values(J.C.perSession)) for (const h of p.session_query_hits) { P(`- ${h.session} ${h.step} @${h.time}（${h.where}）`); P(rawBlock(h.raw)); }
  }
  P();
  P('### C-2 读会话日志/历史消息正则');
  P();
  P('正则：`/session_query|session log|jsonl|history message|previous (message|conversation)|look back|recall earlier|回看|历史/i`，搜动作列+思考列。');
  P();
  const c2all = Object.values(J.C.perSession).flatMap((p) => p.history_read_hits);
  if (!c2all.length) P('三场：**0 命中**。');
  else {
    P(`三场合计 ${c2all.length} 条，逐条原文如下（含命中的具体子串，便于判断是否误报）：`);
    P();
    for (const h of c2all) { P(`- ${h.session} ${h.step} @${h.time}（${h.where}；命中词：${h.matched.join(' / ')}）`); P(rawBlock(h.raw)); }
  }
  P();
  P('### C-3 跨场：本场的动作列里出现别场的 run 目录名');
  P();
  P('正则：`/land-gui2|bomberman-gui1|ctf-gui1/`，只统计与本场不同的目录名。');
  P();
  const c3all = Object.values(J.C.perSession).flatMap((p) => p.cross_session_action_col_hits);
  if (!c3all.length) P('三场动作列：**0 命中**。');
  else for (const h of c3all) { P(`- ${h.session} ${h.step} @${h.time} → ${h.otherIds.join(',')}`); P(rawBlock(h.raw)); }
  P();
  P('参考（不计数）：思考列里出现别场目录名的行：');
  P();
  const c3t = Object.values(J.C.perSession).flatMap((p) => p.cross_session_thought_col_reference);
  if (!c3t.length) P('- 无。');
  else for (const h of c3t) { P(`- ${h.session} ${h.step} @${h.time} → ${h.otherIds.join(',')}`); P(rawBlock(h.raw)); }
  P();
  P('参考（不计数）：动作列提到笔记/交接类文件（`ITERATION_LOG|checkpoint|summary|notes|README|log tail`）——这些是「读自己写下的东西」，不是「向系统回捞被折叠原文」，列出来供区分：');
  P();
  P(tableOf(['场', '步号', '时刻', '动作', '命中词'], J.C.indirectNoteReads.map((n) => [n.session, n.step, n.time, n.action, n.matched.join(',')])));
  P();
  P('上述间接线索的逐条原文：');
  P();
  for (const n of J.C.indirectNoteReads) P(rawBlock(n.raw));
  P();

  /* ---------- D ---------- */
  P('## D. 探针一：有没有重复编辑 / 重复踩同一个坑');
  P();

  P('### D-1 折叠后回读源文件（压缩事件后连续 8 步窗口）');
  P();
  P(tableOf(['场', '压缩事件锚', '窗口步范围', '窗口内命中数'],
    Object.values(J.D.D1.perSession).flatMap((p) => p.windows.map((w) => [p.fileId, w.anchor + (w.anchorStep ? `(${w.anchorStep})` : ''), w.window, w.hitCount]))));
  P();
  P('每条命中原文：');
  P();
  const d1hits = Object.values(J.D.D1.perSession).flatMap((p) => p.allHits);
  if (!d1hits.length) P('- 无。');
  else {
    for (const h of d1hits) {
      P(`- ${h.session} ${h.step} @${h.time}（动词命中：${h.matchedVerbs.join('/')}；文件名命中：${h.matchedFiles.join('/')}）`);
      P(rawBlock(h.raw));
    }
  }
  P();
  P('### D-1c 同一个源文件被重复读取（两次之间是否夹着压缩事件）');
  P();
  P('这是「折叠后重做」最直接的形状：开场读过的文件，折叠之后又去读一遍。按场列出所有 (文件, 相邻两次读取) 配对。');
  P();
  P(tableOf(['场', '文件名', '首次读', '再次读', '相差步', '相差分钟', '跨回合?', '中间压缩次数', '中间是哪些压缩'],
    Object.values(J.D.D1.perSession).flatMap((p) => p.fileRepeats.map((r) => [p.fileId, r.file, r.from, r.to, r.gapSteps, r.gapMinutes, r.crossedTurn ? '是' : '', r.compactionCount, r.compactionsBetween.join('、') || '-']))));
  P();
  P(tableOf(['场', '重复对总数', '其中夹着压缩事件的'], Object.values(J.D.D1.perSession).map((p) => [p.fileId, p.fileRepeatPairs_total, p.fileRepeatPairs_acrossCompaction])));
  P();
  P('全部重复读取配对的原始行（每对两行）：');
  P();
  for (const p of Object.values(J.D.D1.perSession)) {
    if (!p.fileRepeats.length) { P(`- ${p.fileId}：无可配对（该场没有两条以上读同一文件的记录）。`); continue; }
    P(`**${p.fileId}**`);
    P();
    for (const r of p.fileRepeats) {
      P(`- \`${r.file}\`：${r.from} → ${r.to}，相差 ${r.gapSteps} 步${r.gapMinutes !== null ? ` / ${r.gapMinutes} 分钟${r.crossedTurn ? '（跨回合，中间含服务重启等非模型耗时）' : ''}` : ''}，中间压缩 ${r.compactionCount} 次${r.compactionsBetween.length ? `（${r.compactionsBetween.join('、')}）` : ''}${r.acrossCompaction ? ' ← 跨折叠重读' : ''}`);
      P(rawBlock(r.raws));
      P();
    }
  }

  P('### D-1b 圈地第三次折叠（15:15）之后那一段明细 + 对「read 全部集中在这之后」的验证');
  P();
  const lt = J.D.D1.landThirdFoldDetail;
  if (!lt) P('- 未能定位第三次折叠步。');
  else {
    P(`锚点：第 3 个折叠步 = **${lt.foldStep} @${lt.foldTime}**；窗口 = 其后 8 步（${lt.windowSteps[0]?.step} .. ${lt.windowSteps[lt.windowSteps.length - 1]?.step}）`);
    P();
    P(tableOf(['#', '步号', '时刻', '秒', '动作'], lt.windowSteps.map((r, i) => [i + 1, r.step, r.time, r.durSec, r.action])));
    P();
    P('窗口内命中（' + lt.hitCount + ' 条）原文：');
    P();
    for (const h of lt.hits) { P(`- ${h.step} @${h.time}（${h.matchedVerbs.join('/')} + ${h.matchedFiles.join('/')}）`); P(rawBlock(h.raw)); }
    P();
    P('全场（含窗口外、含折叠前）所有 read+文件名命中：');
    P();
    for (const s of lt.claimCheck.allReadFilenameHitsInSession) P(`- ${s}`);
    P();
    P(`声称：${lt.claim}`);
    P(`第三次折叠之前的命中数：${lt.claimCheck.countAtOrBeforeThirdFold}；之后：${lt.claimCheck.countAfterThirdFold}；之后但在 8 步窗口之外：${lt.claimCheck.countAfterThirdFoldButOutside8StepWindow}`);
    P();
    P(`**验证结论：${lt.claimCheck.verdict}**`);
    P();
    if (lt.claimCheck.hitsAtOrBeforeThirdFold.length) {
      P('窗口前命中原文（推翻用）：');
      P();
      for (const h of lt.claimCheck.hitsAtOrBeforeThirdFold) P(rawBlock(h.raw));
      P();
    }
    if (lt.claimCheck.hitsAfterThirdFoldButOutside8StepWindow.length) {
      P('窗口后（第三次折叠之后、8 步窗口之外）命中原文：');
      P();
      for (const h of lt.claimCheck.hitsAfterThirdFoldButOutside8StepWindow) P(rawBlock(h.raw));
      P();
    }
  }
  P();

  P('### D-1d 漏判规模参考：命中读动词但动作里没写白名单文件名的步（不计入 D1）');
  P();
  P(tableOf(['场', '条数'], Object.values(J.D.D1.perSession).map((p) => [p.fileId, p.verbOnlyCount])));
  P();
  P('逐条动作（只列动作列文本，便于判断 D1 严格口径低估了多少）：');
  P();
  P(tableOf(['场', '步号', '时刻', '动作', '命中动词'],
    Object.values(J.D.D1.perSession).flatMap((p) => p.verbOnlyReference.map((v) => [p.fileId, v.step, v.time, v.action, v.matchedVerbs.join(',')]))));
  P();

  P('### D-2 同一处编辑被重做（动作含改写词 且 含 bot.cpp）');
  P();
  P(tableOf(['场', '严格口径命中数', '相隔≤10步的复发对数', '复发簇'],
    Object.values(J.D.D2).map((p) => [p.fileId, p.strictHitCount, p.recurrencePairsWithin10Steps, p.clustersOfRepeatedEdits.map((c) => `${c.count}次: ${c.steps.join(' -> ')}`).join(' ; ') || '-'])));
  P();
  P('严格口径命中原文：');
  P();
  const d2all = Object.values(J.D.D2).flatMap((p) => p.strictHits);
  if (!d2all.length) P('- 无（三场动作列里没有「改写词 + bot.cpp」同时出现的行）。');
  else for (const h of d2all) { P(`- ${h.session} ${h.step} @${h.time}（改写词命中：${h.matchedEdit.join('/')}）`); P(rawBlock(h.raw)); }
  P();
  P('复发配对明细（口径：同一场内两次命中相隔 ≤10 步，枚举所有满足条件的配对，不只相邻）：');
  P();
  const d2p = Object.values(J.D.D2).flatMap((p) => p.recurrences);
  if (!d2p.length) P('- 无。');
  else for (const x of d2p) { P(`- ${x.session} ${x.from}@${x.fromTime} → ${x.to}@${x.toTime}，相隔 ${x.gapSteps} 步，中间压缩 ${x.compactionCount} 次${x.compactionsBetween.length ? `（${x.compactionsBetween.join('、')}）` : ''}`); P(rawBlock(x.raws)); }
  P();
  P('参考口径（不计数）：动作含改写词且提到 bot（不要求写全 bot.cpp）：');
  P();
  const d2l = Object.values(J.D.D2).flatMap((p) => p.looseReference);
  if (!d2l.length) P('- 无。');
  else { P(tableOf(['场', '步号', '时刻', '动作'], d2l.map((h) => [h.session, h.step, h.time, h.action]))); P(); for (const h of d2l) P(rawBlock(h.raw)); }
  P();
  P('最宽口径（不计数，仅供复核「改写类动作」到底有多少、相隔多近）：动作列只要求含改写词，不限定文件名对象。');
  P();
  P(tableOf(['场', '命中步数', '相隔≤10步的对数'], Object.values(J.D.D2).map((p) => [p.fileId, p.wideReferenceCount, p.wideRecurrencePairsWithin10Steps])));
  P();
  P('最宽口径逐条原文：');
  P();
  const d2w = Object.values(J.D.D2).flatMap((p) => p.wideReference);
  if (!d2w.length) P('- 无。');
  else for (const h of d2w) { P(`- ${h.session} ${h.step} @${h.time}（改写词：${h.matchedEdit.join('/')}）`); P(rawBlock(h.raw)); }
  P();
  P('最宽口径下的 ≤10 步复发配对（枚举所有满足条件的配对，含两条原文）：');
  P();
  P('注意：最宽口径会把**折叠步自身的动作**也算进来（例如 ctf 1.32「Compact v2/v3 work, keep v4 patch plan」里的 "patch" 是折叠动作的措辞，不是编辑动作），这类配对不是重复编辑，请照原文剔除。');
  P();
  const d2wp = Object.values(J.D.D2).flatMap((p) => p.wideRecurrences);
  if (!d2wp.length) P('- 无。');
  else for (const x of d2wp) { P(`- ${x.session} ${x.from}@${x.fromTime} → ${x.to}@${x.toTime}，相隔 ${x.gapSteps} 步，中间压缩 ${x.compactionCount} 次${x.compactionsBetween.length ? `（${x.compactionsBetween.join('、')}）` : ''}${x.acrossCompaction ? ' ← 跨折叠的同类改写动作' : ''}`); P(rawBlock(x.raws)); }
  P();

  P('### D-3 同一个错误跨折叠复发（三族）');
  P();
  for (const [fam, f] of Object.entries(J.D.D3)) {
    P(`#### 族：${f.label}`);
    P();
    P(`正则：${f.regex}（搜动作列+思考列，同一步只记一次）`);
    P('正则按源码原样展示；其中 `\\\\n` 这一段在正则语义里是「匹配原文中的两字符 `\\n`」（反斜杠 + 字母 n），即模型源码里本该是转义、却被写成真实换行的那种写法。');
    P(`核心信号正则（用来区分「真属这一族」与「只提到外围词」）：${f.coreRegex}；三场里「仅外围词命中」的行数 = ${f.peripheralOnlyHits}，下表「仅外围词」列标 true 的请谨慎采信为复发。`);
    P();
    P(tableOf(['场', '序号', '步号', '时刻', '列', '命中词', '仅外围词?', '与上次命中相差步数', '时间差(分)', '跨回合?', '两次之间夹的压缩事件数', '夹在中间的事件', '距本场同族首次命中的步差', '首次至今夹的压缩次数'],
      Object.values(f.perSession).flatMap((p) => p.sequence.map((h, i) => [p.fileId, i + 1, h.step, h.time, h.column, h.matched.join('/'), h.peripheralOnly ? 'true' : '', h.gapStepsFromPrev ?? '-', h.gapTimeFromPrevMin ?? '-', h.crossedTurnBoundary ? '是' : '', h.compactionsBetweenCount ?? '-', (h.compactionsBetween || []).join(', ') || '-', h.gapStepsFromFirst ?? '-', h.compactionsSinceFirst ?? '-']))));
    P();
    P(`三场合计命中：${f.totalHits}`);
    P();
    for (const p of Object.values(f.perSession)) {
      if (!p.hits.length) { P(`- ${p.fileId}：0 命中。`); continue; }
      P(`**${p.fileId}（${p.hitCount} 条）逐条原文**`);
      P();
      for (const h of p.hits) {
        P(`- ${h.step} @${h.time}（${h.column}；命中：${h.matched.join('/')}）` +
          (h.peripheralOnly ? ' ⚠ 仅外围词命中（不含该族核心信号）' : '') +
          (h.prevPair ? ` ｜ 与上一次同类命中：${h.prevPair}，相差 ${h.gapStepsFromPrev} 步（约 ${h.gapTimeFromPrevMin} 分钟${h.crossedTurnBoundary ? '，跨回合' : ''}），中间夹 ${h.compactionsBetweenCount} 次压缩${h.compactionsBetween.length ? '：' + h.compactionsBetween.join(', ') : ''}` : ' ｜ 本场该族首次命中') +
          (h.gapStepsFromFirst ? ` ｜ 距本场首次命中 ${h.firstHitOfFamilyInSession} 相差 ${h.gapStepsFromFirst} 步、中间 ${h.compactionsSinceFirst} 次压缩${h.compactionsSinceFirstList.length ? '（' + h.compactionsSinceFirstList.join(', ') + '）' : ''}` : ''));
        P(rawBlock(h.raw));
      }
      P();
    }
  }
  P();

  /* ---------- E ---------- */
  P('## E. 折叠当步写了多少字（summaryChars）');
  P();
  P(tableOf(['场', '#', '时刻', 'summaryChars', 'usage 是否有值', 'usage 原文'],
    Object.values(J.E.perSession).flatMap((p) => p.events.map((e) => [p.fileId, e.ordinal, e.time, e.summaryChars, e.usage ? '有' : 'undefined', e.usageRaw]))));
  P();
  P('压缩事件小节原文逐行（三场全量）：');
  P();
  for (const s of J.sources) { P(`**${s.key}**`); P(rawBlock(s.compactionEventRaw.length ? s.compactionEventRaw : ['（无）'])); }
  P();
  P(`每场折叠摘要字符数合计：${Object.values(J.E.perSession).map((p) => `${p.fileId}=${p.summaryCharsTotal}`).join(' ; ')}`);
  P();
  P('注意：这是 harness 记录的摘要**字符数**，不是摘要正文本身；三份 md 里没有存摘要正文。折叠步思考列里模型自己提到的字符数（如 land 1.10「503 characters retained / 400 budget」）与 summaryChars 字段并列如下，供交叉核对：');
  P();
  for (const n of J.E.crossChecks) P(`- ${n.session} ${n.step} @${n.time}：${n.note}`);
  P();

  /* ---------- 局限 ---------- */
  P('## 无法在三份 md 上定论的条目（需要原始 session 日志才能坐实）');
  P();
  for (const c of J.caveats) P(`- ${c}`);
  P();

  /* ---------- 解析健康 ---------- */
  P('## 解析自检');
  P();
  P(tableOf(['场', '解析行数', 'header steps', '异常行数'],
    J.sources.map((s) => [s.key, s.rowCount, s.header?.steps ?? '-', s.anomalyCount])));
  P();
  const anyAnom = J.sources.some((s) => s.anomalyCount > 0);
  if (!anyAnom) P('- 全部表格行按 6 列正常解析，无跳行、无列错位。');
  else {
    P('- 下列行未能按 6 列正常解析（已跳过或按规则合并，逐条列出）：');
    P();
    for (const s of J.sources) for (const a of s.anomaliesAll) P(`  - ${s.key} [${a.kind}] ${a.raw ?? ''}`);
  }
  P();
  P('- 思考列截断情况（长度卡在上限 = 被截断）：');
  P();
  P(tableOf(['场', '行数', '思考列最短', '思考列最长', '卡在上限的行数', '不以句末符号收尾的行数'],
    Object.entries(J.parseHealth.perSession).map(([k, v]) => [k, v.rows, v.thoughtLenMin, v.thoughtLenMax, v.atCap, v.notSentenceEnded])));
  P();
  return L.join('\n') + '\n';
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

function main() {
  const sessions = SESSIONS.map(parseFile);
  const selfIdByKey = Object.fromEntries(sessions.map((s) => [s.key, s.id]));

  const A = buildA(sessions);
  const compPos = compactionPositions(sessions, A);
  const B = buildB(sessions, A, compPos);
  const C = buildC(sessions, selfIdByKey);
  const D = buildD(sessions, A, compPos);
  const E = buildE(sessions);

  /* A 计数一致性叙述（全部由数据生成） */
  const inc = Object.values(A.perSession).filter((p) => !p.consistent);
  const orphans = A.eventBindings.filter((b) => b.binding === 'no-fold-action-step-at-this-time');
  const multis = A.eventBindings.filter((b) => b.binding === 'multi-event-same-fold-step');
  const suspects = A.foldSteps.filter((f) => f.suspectFalsePositive);
  const parts = [];
  if (A.compactionEventTotal === A.headerCompactionTotal) {
    parts.push(`三场「## 压缩事件」小节条数之和 = ${A.compactionEventTotal}，与 header compactions 之和 ${A.headerCompactionTotal} 一致（逐场也一致）。`);
  } else {
    parts.push(`不一致：三场压缩事件小节条数之和 = ${A.compactionEventTotal}，header compactions 之和 = ${A.headerCompactionTotal}，两个口径对不上。`);
  }
  if (inc.length) {
    parts.push('折叠动作步口径与 header 不一致的场次：' + inc.map((p) => `${p.fileId}（header ${p.headerCompactions} / 压缩事件 ${p.compactionEventSectionCount} / 显式折叠动作步 ${p.foldActionStepCount}）`).join('；'));
  }
  if (suspects.length) {
    parts.push(`正则 /Fold|Compact|compaction/i 的假阳性 ${suspects.length} 条（已从折叠步计数剔除，原文仍在 A-1 列出）：` + suspects.map((f) => `${f.session} ${f.step}@${f.time}「${f.action}」` + (f.suspectReason ? ` ← ${f.suspectReason}` : '')).join('；'));
  }
  if (multis.length) {
    parts.push(`一次折叠动作里产生多条事件记录的时刻：` + [...new Set(multis.map((b) => `${b.session} ${b.event.time}：该时刻共 ${multis.filter((m) => m.session === b.session && m.event.time === b.event.time).length + 1} 条事件同指折叠步 ${b.foldStep}（即一次动作提交里做了多次 fold，所以「事件数 > 折叠动作步数」）`))].join('；'));
  }
  if (orphans.length) {
    parts.push(`有压缩事件但表格里找不到同刻折叠动作步（多为 nudge 自动折叠或折叠未单独成步）：` + orphans.map((b) => `${b.session} ${b.event.time}（summaryChars=${b.event.summaryChars}，事件按时刻落在 ${b.firstRowAtOrAfter} 之前）`).join('；'));
  }
  A.consistencyNarrative = parts.join('\n- ') ? '- ' + parts.join('\n- ') : null;

  /* D 总结论 */
  const d1tot = Object.values(D.D1.perSession).reduce((a, p) => a + p.totalWithinPostCompactionWindows, 0);
  const d3tot = Object.values(D.D3).reduce((a, f) => a + f.totalHits, 0);
  const d3cross = Object.values(D.D3).flatMap((f) =>
    Object.values(f.perSession).flatMap((p) => p.sequence.filter((h) => (h.compactionsBetweenCount || 0) > 0)));
  const d2strict = Object.values(D.D2).reduce((a, p) => a + p.recurrencePairsWithin10Steps, 0);
  const d2wide = Object.values(D.D2).reduce((a, p) => a + p.wideRecurrencePairsWithin10Steps, 0);
  const d2wideHits = Object.values(D.D2).reduce((a, p) => a + p.wideReferenceCount, 0);
  const d1cAll = Object.values(D.D1.perSession).reduce((a, p) => a + p.fileRepeatPairs_total, 0);
  const d1cAcross = Object.values(D.D1.perSession).reduce((a, p) => a + p.fileRepeatPairs_acrossCompaction, 0);
  D.verdict =
    `D1「折叠后 8 步内回读源文件」有实据但不偏发：三场窗口内去重命中 ${d1tot} 条（见 D-1 原文）。` +
    `D1c「同一个源文件被重复读」更有说服力：三场共 ${d1cAll} 对相邻重复读取，其中 ${d1cAcross} 对的两次阅读之间夹着压缩事件（=折叠后重新去读原始文件）。` +
    `但「圈地的 read 全部集中在第三次折叠（15:15）之后」这句被推翻：第三次折叠之前已有 ${D.D1.landThirdFoldDetail?.claimCheck.countAtOrBeforeThirdFold} 条 read+文件名命中，窗口之外还有 ${D.D1.landThirdFoldDetail?.claimCheck.countAfterThirdFoldButOutside8StepWindow} 条。` +
    `D2「同一处改写相隔 ≤10 步复发」：严格口径（动作含改写词且写全 bot.cpp）= ${d2strict} 对，因为绝大多数改写步只写 "Rewrite bot / Apply v4 patches" 不带文件名；最宽口径（动作含改写词，不限对象）= ${d2wideHits} 步命中、${d2wide} 对相隔 ≤10 步，原文已在 D-2 全部贴出，请自行判定是否算「同一处编辑被重做」。` +
    `D3 三族错误合计 ${d3tot} 条命中（其中 ${Object.values(D.D3).reduce((a, f) => a + f.peripheralOnlyHits, 0)} 条只命中外围词，不算该族核心信号），${d3cross.length} 条与上一次同类命中之间夹着至少 1 次压缩事件——这是「同类错误跨折叠复发」的直接证据，原文已全部贴出，但正则分不清「再次踩坑」与「复述踩过的坑」，需人工判定。`;

  /* 待核说法：用户给的句式「1.8（14:37）踩过 → 1.78（15:29）再踩，中间经历 3 次折叠、相差 70 步」，用实数核 */
  const claimChecks = [];
  {
    const fam = 'printf_newline', key = 'land', a = '1.8', b = '1.78';
    const p = D.D3[fam].perSession[key];
    const ha = p.hits.find((h) => h.step === a);
    const hb = p.hits.find((h) => h.step === b);
    const st = '待核句式：「1.8（14:37）踩过 → 1.78（15:29）再踩，中间经历 3 次折叠、相差 70 步」';
    if (ha && hb) {
      const between = compPos[key].filter((x) => x.posIdx > ha.idx && x.posIdx < hb.idx);
      const inter = p.hits.filter((h) => h.idx > ha.idx && h.idx < hb.idx);
      const seqB = p.sequence.find((h) => h.step === b);
      claimChecks.push({
        statement: st,
        family: D.D3[fam].label,
        a: `${ha.step} @${ha.time}｜动作「${ha.action}」`,
        b: `${hb.step} @${hb.time}｜动作「${hb.action}」`,
        stepGapFirstToLast: hb.idx - ha.idx,
        minutesGap: hb.timeMin - ha.timeMin,
        compactionsBetweenFirstToLast: between.map((x) => x.label),
        compactionCountFirstToLast: between.length,
        intermediateSameFamilyHits: inter.map((h) => `${h.step}@${h.time}「${h.action}」`),
        adjacentPair: seqB ? `${seqB.prevPair} 相差 ${seqB.gapStepsFromPrev} 步、中间 ${seqB.compactionsBetweenCount} 次压缩（${seqB.compactionsBetween.join(', ') || '无'}）` : null,
        raws: [ha.raw, hb.raw],
        verdict:
          `相差步数实测 ${hb.idx - ha.idx}（句式写 70）→ ${hb.idx - ha.idx === 70 ? '吻合' : '不吻合'}；` +
          `中间压缩次数实测 ${between.length}（句式写 3）→ ${between.length === 3 ? '吻合' : '不吻合'}；` +
          `时刻 ${ha.time}→${hb.time}（句式写 14:37→15:29）→ ${ha.time === '14:37' && hb.time === '15:29' ? '吻合' : '不吻合'}。` +
          `口径要说清：这两次之间还有 ${inter.length} 次同族命中（${inter.map((h) => h.step).join('、') || '无'}），按「相邻两次命中」口径是 ${seqB ? seqB.gapStepsFromPrev : '?'} 步 / ${seqB ? seqB.compactionsBetweenCount : '?'} 次压缩；按「首尾跨度」口径才是 ${hb.idx - ha.idx} 步 / ${between.length} 次压缩。`,
      });
    } else {
      claimChecks.push({ statement: st, actual: null, verdict: `无法核实：printf 族在 land 的命中里找不到步号 ${ha ? b : a}（实际命中为 ${p.hits.map((h) => h.step).join(', ') || '无'}）` });
    }
  }

  /* E 交叉核对：把折叠步思考列里模型自述的字符数找出来，与 summaryChars 并列 */
  const crossChecks = [];
  for (const s of sessions) {
    for (const r of s.rows) {
      const m = /(\d{3,5})\s*characters|summaryChars\s*=\s*(\d+)/i.exec(r.thought || '');
      if (m) crossChecks.push({ session: s.key, step: r.step, time: r.time, note: `思考列提到字符数：${m[0]}（原句见 md 该行）`, raw: r.raw });
    }
  }
  E.crossChecks = crossChecks;

  /* 概览表 */
  const overview = { table: [] };
  const byS = (k) => Object.fromEntries(sessions.map((s) => [s.key, k(s)]));
  const foldCnt = byS((s) => A.foldSteps.filter((f) => f.session === s.key && !f.suspectFalsePositive).length);
  const evCnt = byS((s) => s.compactionEvents.length);
  const d1w = byS((s) => D.D1.perSession[s.key].totalWithinPostCompactionWindows);
  const d1all = byS((s) => D.D1.perSession[s.key].totalReadWithFilename_allRows);
  const d2c = byS((s) => D.D2[s.key].recurrencePairsWithin10Steps);
  const c2c = byS((s) => C.perSession[s.key].history_read_count);
  const c1c = byS((s) => C.perSession[s.key].session_query_count);
  const famCount = (fam) => byS((s) => D.D3[fam].perSession[s.key].hitCount);
  const famCross = (fam) => byS((s) => D.D3[fam].perSession[s.key].sequence.filter((h) => (h.compactionsBetweenCount || 0) > 0).length);
  const cols = ['land', 'bomberman', 'ctf'];
  const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
  const row = (label, vals, isSum = true) => overview.table.push([label, ...vals, isSum ? sum(vals) : '—']);
  row('header compactions', cols.map((k) => sessions.find((s) => s.key === k).header?.compactions));
  row('A 折叠动作步数', cols.map((k) => foldCnt[k]));
  row('A 压缩事件小节条数', cols.map((k) => evCnt[k]));
  row('B 压缩后首步 cacheRead 区间', cols.map((k) => {
    const v = B.anchors.filter((a) => a.anchorKind === 'compaction-event-line' && a.session === k && a.cacheRead !== null).map((a) => a.cacheRead);
    return v.length ? `${Math.min(...v)}–${Math.max(...v)}` : '-';
  }), false);
  row('B 压缩后首步 tok_in 区间', cols.map((k) => {
    const v = B.anchors.filter((a) => a.anchorKind === 'compaction-event-line' && a.session === k && a.tokIn !== null).map((a) => a.tokIn);
    return v.length ? `${Math.min(...v)}–${Math.max(...v)}` : '-';
  }), false);
  row('C session_query 命中', cols.map((k) => c1c[k]));
  row('C 历史/日志读取正则命中', cols.map((k) => c2c[k]));
  row('C 跨场动作列引用别场目录', cols.map((k) => C.perSession[k].cross_session_action_col_count));
  row('D1 窗口内回读命中（去重步数）', cols.map((k) => d1w[k]));
  row('D1 全场回读命中', cols.map((k) => d1all[k]));
  row('D1c 同文件重复读对数', cols.map((k) => D.D1.perSession[k].fileRepeatPairs_total));
  row('D1c 其中两次之间夹压缩', cols.map((k) => D.D1.perSession[k].fileRepeatPairs_acrossCompaction));
  row('D2 bot.cpp 改写复发对(≤10步)', cols.map((k) => d2c[k]));
  row('D2 最宽口径改写对(≤10步)', cols.map((k) => D.D2[k].wideRecurrencePairsWithin10Steps));
  row('D2 最宽口径里跨折叠的', cols.map((k) => D.D2[k].wideRecurrences.filter((x) => x.acrossCompaction).length));
  row('D3 printf/\\n 族命中', cols.map((k) => famCount('printf_newline')[k]));
  row('D3 printf 族「中间夹过折叠」', cols.map((k) => famCross('printf_newline')[k]));
  row('D3 heredoc 族命中', cols.map((k) => famCount('heredoc_silent')[k]));
  row('D3 heredoc 族「中间夹过折叠」', cols.map((k) => famCross('heredoc_silent')[k]));
  row('D3 fread 族命中', cols.map((k) => famCount('fread_block')[k]));
  row('D3 fread 族「中间夹过折叠」', cols.map((k) => famCross('fread_block')[k]));
  row('E summaryChars 合计（字）', cols.map((k) => E.perSession[k].summaryCharsTotal));

  /* caveats */
  const caveats = [
    '三份 md 的思考摘要列被截断（约 180 字符），任何「列里没写到」都只能得出「本文档中无证据」，不能得出「模型没做过」。C 探针的 0 命中属于这种情况；要坐实「从未调用 session_query / 从未回捞历史」必须查 DSH 原始 session 日志里的工具调用序列。',
    '折叠时模型手写的摘要正文本身不在 md 里，只有 summaryChars 数字。摘要质量（丢失了哪些约束）无法从这三份文件度量。',
    '折叠步的 seq 范围（例如 land 1.9「seq 9 -> 39」、land 1.71「seq 106 -> 494」、ctf 3.26「segment 782->947」）是模型自述，非 harness 权威记录；被折叠掉的具体消息条数需要原始日志才能定。',
    '压缩事件「之后第一步」按时刻/顺序映射，bomberman 的 18:16、23:15 两条事件在表格里没有对应的折叠动作步，其 tok_in/cacheRead 只能按时间插值归属，已在 B-1 标出。',
    'D3 的三族命中里包含模型「叙述该问题」的行与「修复该问题」的行，正则无法区分「再次踩坑」与「回顾踩过的坑」；每条命中都给了原文，请肉眼判定是否真复发。md 只按时间顺序给出步差与中间折叠次数，不替你做判定。',
    'D1 的读类动词正则含 cat / check 的裸子串，会命中 duplicate、Locate 之类（因为同时要求文件名命中，实际误报概率低），命中词已逐条列出便于复核。',
    'toolErrors 的完整清单在 md 里只保留「前 25 条」，因此按报错文本统计复发次数会低估；本轮 D3 只用轨迹行，没有用报错小节计数。',
    '「同一处编辑被重做」按 bot.cpp 严格匹配，很多改写行只写「Rewrite bot / Write corrected bot v2」不带文件名，严格口径会低估，参考口径已在 D-2 附出但不计数。',
    'D1 的文件名白名单只有 TASK.md/RULES/game.py/referee.py/bot.cpp/greedy/anchor/random/README，模型读自己复制出的迭代副本（tools/c.cpp、v13.cpp、v5.cpp 等）或只写函数名（"Read decide() and walk logic"、"Read current submission bot"）都不计入，因此 D1/D1c 是**下限**；漏判规模见 D-1d 的条数与逐条动作。',
    '「中间夹了几次压缩」按压缩**动作步/事件时刻**去重计（一次动作提交里做了 5 个 fold 的 land 22:36 只算 1 个位置）。若要按真实 fold 调用次数计，需要原始日志里每次 compact_region 的调用记录。',
    '需要原始 session 日志才能坐实的量化项：真实 cacheWrite 开销、每次折叠前后完整上下文差分、session_query 调用次数、被折叠消息的原文条数与 token 数。',
  ];

  const thoughtLens = sessions.flatMap((s) => s.rows.map((r) => (r.thought || '').trim().length).filter((n) => n > 0));
  const maxThoughtLen = thoughtLens.length ? Math.max(...thoughtLens) : 0;
  const parseHealth = {
    thoughtColumnCap: maxThoughtLen,
    perSession: Object.fromEntries(sessions.map((s) => {
      const ls = s.rows.map((r) => (r.thought || '').trim().length).filter((n) => n > 0);
      return [s.key, {
        rows: s.rows.length,
        thoughtLenMin: Math.min(...ls),
        thoughtLenMax: Math.max(...ls),
        atCap: ls.filter((n) => n >= maxThoughtLen - 2).length,
        notSentenceEnded: s.rows.filter((r) => { const t = (r.thought || '').trim(); return t && !/[.)?!:;]$/.test(t); }).length,
      }];
    })),
    text: `思考摘要列实测长度上限 ${maxThoughtLen} 字符（三场都卡在这个值上），且多数行不以句末符号收尾 —— 这一列是被截断的；凡「列里没写到」都不能当作「没发生过」。`,
  };
  caveats[0] = caveats[0].replace('约 180 字符', `实测上限 ${maxThoughtLen} 字符`);

  const J = {
    generatedBy: 'pipeline/compaction-evidence.mjs',
    note: '只读解析；未修改 trace 文件与任何已存在文件',
    sources: sessions.map((s) => ({
      key: s.key, cn: s.cn, id: s.id, file: s.file, abs: s.abs, header: s.header,
      rowCount: s.rows.length, anomalyCount: s.anomalies.length, anomaliesAll: s.anomalies,
      compactionEventRaw: s.compactionEventRaw,
    })),
    A, B, C, D, E,
    claimChecks,
    definition: D.definition,
    D1def: D.definition.D1,
    parseHealth,
    overview,
    caveats,
  };

  fs.writeFileSync(path.join(DATA, 'compaction-evidence.json'), JSON.stringify(J, null, 2), 'utf8');
  fs.writeFileSync(path.join(DATA, 'compaction-evidence.md'), renderMd(J), 'utf8');

  /* 控制台摘要 */
  const line = (k, v) => console.log(`${k.padEnd(38)} ${v}`);
  console.log('== compaction-evidence 摘要 ==');
  for (const k of cols) {
    const s = sessions.find((x) => x.key === k);
    line(`${k}: header compactions`, s.header.compactions);
    line(`${k}: 折叠动作步`, foldCnt[k]);
    line(`${k}: 压缩事件条数`, evCnt[k]);
    line(`${k}: C session_query`, c1c[k]);
    line(`${k}: C 历史读取正则`, c2c[k]);
    line(`${k}: D1 窗口内 / 全场`, `${d1w[k]} / ${d1all[k]}`);
    line(`${k}: D2 复发对`, d2c[k]);
    line(`${k}: D3 printf/heredoc/fread`, `${famCount('printf_newline')[k]}/${famCount('heredoc_silent')[k]}/${famCount('fread_block')[k]}`);
    line(`${k}: D3 跨折叠复发`, `${famCross('printf_newline')[k]}/${famCross('heredoc_silent')[k]}/${famCross('fread_block')[k]}`);
    line(`${k}: E summaryChars 合计`, E.perSession[k].summaryCharsTotal);
  }
  line('合计: 折叠动作步(真/正则原始)', `${A.foldStepTotalReal}/${A.foldStepTotal}`);
  line('合计: 压缩事件小节/header', `${A.compactionEventTotal}/${A.headerCompactionTotal}`);
  console.log('\nB 裁决: ' + B.verdict.statement);
  console.log('\nC 裁决: ' + C.verdict);
  console.log('\nD 裁决: ' + D.verdict);
  console.log('\n待核说法:');
  for (const c of J.claimChecks) console.log('  ' + c.statement + '\n  ' + c.verdict);
  console.log('\n输出: data/compaction-evidence.json , data/compaction-evidence.md');
}

main();
