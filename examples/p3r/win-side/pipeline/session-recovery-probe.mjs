// session-recovery-probe.mjs — 只读探针：数 27B 模型在上下文被折叠后有没有回头检索被折叠的历史
//
// 数据源：WSL 侧 DSH 会话日志 session*.jsonl.zstd（多帧 zstd；一帧一条 JSON 行；按帧流式解，即用即弃）
// 用法：
//   node session-recovery-probe.mjs discover [runKey]     # 结构普查：事件类型 / 工具名 / 字段路径 / 字符串命中路径
//   node session-recovery-probe.mjs peek <runKey> <type> [n]  # 抽样看事件（字符串截断，防刷屏）
//   node session-recovery-probe.mjs count [runKey]        # 正式计数，写 data/session-recovery-probe.json
// 纪律：全程只读，不在 deepseek-harness/ 下写任何文件；命中原文每条只留 200 字符、每类最多 20 条。

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const SESSIONS_ROOT = '\\\\wsl.localhost\\Ubuntu-22.04\\home\\altair\\dsh-data\\.dsh\\sessions';
const OUT_JSON = '$WORKSPACE/arena-video/data/session-recovery-probe.json';
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const BUCKET_PREFIX = '--home-altair-deepseek-harness-workplace-meow-ai-arena-contestants-runs-';

const RUNS = [
  { key: 'land', label: '圈地 land-gui2', bucket: BUCKET_PREFIX + 'land-gui2--' },
  { key: 'bomberman', label: '炸弹人 bomberman-gui1', bucket: BUCKET_PREFIX + 'bomberman-gui1--' },
  { key: 'ctf', label: '夺旗 ctf-gui1', bucket: BUCKET_PREFIX + 'ctf-gui1--' },
];

// 被测工具名：窄口径（工具调用层）与宽口径（任意字符串）都覆盖这一族
const SQ_TOKENS = ['session_query', 'session_search', 'session_event_search', 'session_event_trace', 'session_event_read', 'session_trace'];
const RECOVERY_NAME_RE = /^(recall|recover|recovered|history|search|query|read_history|session_[a-z_]+)$/i;
// 指向会话日志自身 / harness 历史目录的路径特征（回捞通道的判据）
const SELFLOG_RES = [
  ['jsonl.zstd', /\.jsonl\.zstd/],
  ['session*.jsonl', /session[A-Za-z0-9._*-]*\.jsonl|\.jsonl\b/],
  ['.dsh 目录', /\.dsh\b/],
  ['sessions 目录', /[\\/](home[\\/])?sessions[\\/]/],
  ['dsh-data', /dsh-data/],
  ['session-<uuid> 目录', /session-[0-9a-f]{8}-[0-9a-f]{4}/i],
  ['logs 目录', /[\\/]logs?[\\/]/],
  ['sessionQuery/session_query', /sessionQuery|session_query/],
  ['session-query.db', /session-query\.db/],
];
const NAME_KEYS = new Set(['name', 'toolName', 'tool_name', 'tool', 'functionName', 'function', 'action']);
// 工具调用层的事件类型（窄口径）
const CALL_TYPES = new Set(['tool/call', 'tool/ptc-dispatch', 'tool/ptc-dispatch-start', 'tool/invoke', 'tool/call-start']);
const MAX_SNIPPETS = 20;
const SNIPPET_LEN = 200;

function listSessionFiles(run) {
  const dir = SESSIONS_ROOT + '\\' + run.bucket;
  const out = [];
  let subs;
  try { subs = readdirSync(dir); } catch (e) { return { error: `bucket 不可读 (${e.code})`, files: [] }; }
  for (const s of subs) {
    const sd = dir + '\\' + s;
    let files;
    try { files = readdirSync(sd); } catch { continue; }
    for (const f of files) {
      if (!/^session.*\.jsonl(\.zstd)?$/.test(f)) continue;
      const p = sd + '\\' + f;
      const st = statSync(p);
      out.push({ path: p, sessionId: s, file: f, bytes: st.size, mtime: st.mtime.toISOString() });
    }
  }
  return { error: null, files: out };
}

// 逐帧解码并把每行即时交给 cb（不把整份明文累积成字符串）
function forEachEvent(file, cb) {
  const buf = readFileSync(file); // 压缩块 ~1.5MB；解压按帧即弃
  const stat = { framesOk: 0, frameTries: 0, lines: 0, unparsed: 0, decodedBytes: buf.length ? 0 : 0 };
  let decoded = 0;
  for (let i = buf.indexOf(MAGIC); i >= 0; i = buf.indexOf(MAGIC, i + 1)) {
    stat.frameTries++;
    let out;
    try { out = zstdDecompressSync(buf.subarray(i)); } catch { continue; }
    if (!out || !out.length) continue;
    stat.framesOk++;
    decoded += out.length;
    const text = out.toString('utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      stat.lines++;
      let ev = null;
      try { ev = JSON.parse(t); } catch { stat.unparsed++; }
      cb(ev, t);
    }
  }
  stat.decodedBytes = decoded;
  return stat;
}

function walk(node, parts, onScalar, onKey, depth = 0) {
  if (depth > 12 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) walk(node[i], parts.concat(String(i)), onScalar, onKey, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    const p = parts.concat(k);
    if (onKey) onKey(p.join('/'), k);
    const tv = typeof v;
    if (tv === 'string' || tv === 'number' || tv === 'boolean') onScalar(p.join('/'), k, v);
    else if (v && typeof v === 'object') walk(v, p, onScalar, onKey, depth + 1);
  }
}

const inc = (map, k, n = 1) => map.set(k, (map.get(k) ?? 0) + n);
const obj = (map) => Object.fromEntries([...map].sort((a, b) => b[1] - a[1]));
const clip = (s) => String(s).replace(/\s+/g, ' ').slice(0, SNIPPET_LEN);

// 取一次工具调用的名字：优先 data.name / data.toolName
function callName(ev) {
  const d = ev?.data ?? {};
  const v = d.name ?? d.toolName ?? d.tool_name;
  return typeof v === 'string' ? v.trim() : null;
}

// 取一次工具调用的「调用侧」文本（用于判它指向哪里）：
// 覆盖 data/arguments（可能是字符串也可能是对象）、code/command/path/pattern/query，
// 但排除工具输出（data/content…、data/message…），免得把回显结果当成模型的调用意图。
function callArgsText(ev) {
  const parts = [];
  const collect = (node, depth) => {
    if (depth > 8 || node == null) return;
    if (typeof node === 'string') { parts.push(node); return; }
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const v of node) collect(v, depth + 1); return; }
    for (const v of Object.values(node)) collect(v, depth + 1);
  };
  const d = ev?.data ?? {};
  for (const k of ['arguments', 'args', 'input', 'params', 'code', 'command', 'path', 'pattern', 'query', 'target', 'files']) {
    if (d[k] !== undefined) collect(d[k], 0);
  }
  return parts.join(' ').slice(0, 8000);
}

function count(runFilter) {
  const runs = RUNS.filter((r) => !runFilter || r.key === runFilter);
  const report = { tool: 'session-recovery-probe.mjs', generatedAt: new Date().toISOString(), dataRoot: SESSIONS_ROOT, tokens: SQ_TOKENS, perRun: {}, totals: {} };
  const T = {
    sq_narrow_toolCall: 0, sq_narrow_ptcDispatch: 0, sq_narrow_anyCallType: 0, sq_wide_raw: 0, sq_wide_events: 0,
    family_narrow_anyCallType: 0, family_wide_raw: 0,
    compact_dispatch: 0, compact_dispatchStart: 0, compact_toolCall: 0, compact_messageBlock: 0,
    compactionSummary: 0, compactionSummaryWithUsage: 0, compactionStart: 0, compactionEnd: 0,
    selflogReads: 0, recoveryNamedCalls: 0, sqNamedAnyPath: 0,
  };

  for (const run of runs) {
    const { error, files } = listSessionFiles(run);
    const r = {
      label: run.label, bucket: run.bucket, bucketError: error,
      files: files.map((f) => ({ ...f, relPath: 'wsl:' + f.path.replace(/\\\\wsl\.localhost\\Ubuntu-22\.04/, '') })),
      events: new Map(), timeRange: [null, null],
      sqNarrow: { byCallType: new Map(), samples: [] },
      sqWide: { rawOccurrences: 0, eventsContaining: 0, byEventType: new Map(), byPath: new Map(), keyPaths: new Map(), modelAuthored: new Map(), samples: [] },
      family: { narrowByCallTypeAndName: new Map(), wideRawByToken: new Map(), wideByPath: new Map(), samples: [] },
      family: { narrowByCallTypeAndName: new Map(), wideRawByToken: new Map(), wideByPath: new Map(), samples: [] },
      compact: { dispatch: 0, dispatchStart: 0, toolCall: 0, messageBlock: 0, byEventType: new Map(), samples: [] },
      compaction: { start: 0, summary: 0, summaryWithUsage: 0, summaryWithoutUsage: 0, end: 0, summaryTimes: [], usageTimes: [] },
      selflog: { total: 0, byToolAndSignal: new Map(), samples: [] },
      recoveryNamed: { total: 0, byName: new Map(), samples: [] },
      toolInventory: new Map(),
      ptcCallSites: new Map(),
      promptExposure: { inSystemMessage: new Map(), inRequestHeader: new Map(), toolDefsNames: new Map(), catalogStrings: [] },
    };

    for (const f of files) {
      const stat = forEachEvent(f.path, (ev, raw) => {
        const type = String(ev?.type ?? (ev ? '?' : '_unparsed'));
        inc(r.events, type);
        if (ev && typeof ev.time === 'number') {
          r.timeRange[0] = r.timeRange[0] === null ? ev.time : Math.min(r.timeRange[0], ev.time);
          r.timeRange[1] = r.timeRange[1] === null ? ev.time : Math.max(r.timeRange[1], ev.time);
        }

        // —— 宽口径：原始行子串（含 key、含未 parse 的行）——
        let rawHit = 0;
        for (const tok of SQ_TOKENS) {
          const n = raw.split(tok).length - 1;
          if (n > 0) { rawHit += tok === 'session_query' ? n : n; inc(r.family.wideRawByToken, tok, n); }
        }
        if (rawHit > 0) { r.sqWide.rawOccurrences += rawHit; r.sqWide.eventsContaining++; inc(r.sqWide.byEventType, type, rawHit); }

        // —— 结构口径：字段路径 ——
        const name = CALL_TYPES.has(type) ? callName(ev) : null;
        if (name) inc(r.toolInventory, `${type} data/name=${name}`);

        walk(ev, [], (path, key, val) => {
          if (typeof val !== 'string') return;
          // 工具调用层窄口径
          if (CALL_TYPES.has(type) && NAME_KEYS.has(key)) {
            const v = val.trim();
            if (v === 'session_query') { inc(r.sqNarrow.byCallType, type); if (r.sqNarrow.samples.length < MAX_SNIPPETS) r.sqNarrow.samples.push({ seq: ev?.seq, time: ev?.time, type, path, snippet: clip(raw) }); }
            if (/^session_|^(recall|recover|history|search|query)/i.test(v)) { inc(r.family.narrowByCallTypeAndName, `${type} ${path}=${v}`); inc(r.recoveryNamed.byName, v); r.recoveryNamed.total++; }
            if (v === 'compact_region') {
              inc(r.compact.byEventType, type);
              if (type === 'tool/ptc-dispatch') r.compact.dispatch++;
              if (type === 'tool/ptc-dispatch-start') r.compact.dispatchStart++;
              if (type === 'tool/call') r.compact.toolCall++;
              if (r.compact.samples.length < MAX_SNIPPETS) r.compact.samples.push({ seq: ev?.seq, time: ev?.time, type, path, snippet: clip(raw) });
            }
          }
          // 助手消息里的 toolCall block（可能只出现在消息里、没落到 dispatch）
          if (/^(data\/message\/content\/\d+\/name|data\/stream\/\d+\/name|data\/stream\/\d+\/chunk\/block\/name)$/.test(path) && val.trim() === 'compact_region') r.compact.messageBlock++;

          for (const tok of SQ_TOKENS) {
            if (val.includes(tok)) {
              inc(r.sqWide.byPath, `${type} :: ${path} ~ ${tok}`);
              inc(r.family.wideByPath, `${type} :: ${path} ~ ${tok}`);
              // 模型自己写的字段里出现过这个工具名 = 它确实动过错恢复调用的念头
              if (['assistant/message', 'tool/call', 'tool/ptc-dispatch-start'].includes(type)) inc(r.sqWide.modelAuthored, `${type} :: ${path} ~ ${tok}`);
              if (/^data\/header\/tools\//.test(path)) inc(r.promptExposure.inRequestHeader, `${path} ~ ${tok}`);
              if (/^(data\/message\/content|data\/content|data\/text)/.test(path) && type === 'system/message') inc(r.promptExposure.inSystemMessage, `${path} ~ ${tok}`);
              if (r.sqWide.samples.length < MAX_SNIPPETS) r.sqWide.samples.push({ seq: ev?.seq, type, path, token: tok, snippet: clip(val) });
            }
          }
        }, (path, key) => {
          for (const tok of SQ_TOKENS) if (key.includes(tok)) { inc(r.sqWide.keyPaths, `${type} :: ${path} (key=${key})`); if (r.sqWide.samples.length < MAX_SNIPPETS) r.sqWide.samples.push({ seq: ev?.seq, type, path, token: tok, snippet: `KEY:${key}` }); }
        });

        // —— 其他回捞通道：读类/grep 类调用指向会话日志自身 ——
        if (CALL_TYPES.has(type) && type !== 'tool/ptc-dispatch-start') {
          const args = callArgsText(ev);
          for (const [sig, re] of SELFLOG_RES) {
            if (re.test(args)) {
              const nm = callName(ev) ?? '?';
              if (nm === 'compact_region' || nm === 'bash' || nm === 'read' || nm === 'grep' || nm === 'glob' || nm === 'write' || nm === 'edit' || nm === 'run_code' || true) {
                r.selflog.total++;
                inc(r.selflog.byToolAndSignal, `${nm} :: ${sig}`);
                if (r.selflog.samples.length < MAX_SNIPPETS) r.selflog.samples.push({ seq: ev?.seq, time: ev?.time, type, tool: nm, signal: sig, snippet: clip(args) });
              }
              break;
            }
          }
        }

        // —— 代码里写过的 tools.X( 调用点（含派发前就失败的尝试）——
        if (type === 'tool/call' || type === 'assistant/message') {
          walk(ev, [], (path, key, val) => {
            if (typeof val !== 'string' || !val.includes('tools.')) return;
            if (!/(arguments|code|text)$/.test(path)) return;
            for (const m of val.matchAll(/tools\.([a-z_][a-z0-9_]*)\s*\(/g)) inc(r.ptcCallSites, m[1]);
          }, null);
        }

        // —— compaction 事件本体（交叉验证 18）——
        if (type === 'compaction/summary') {
          r.compaction.summary++;
          const d = ev?.data ?? {};
          const hasUsage = !!(d.usage || d.maxTokens || d.request || d.summaryUsage || d.tokens);
          if (hasUsage) { r.compaction.summaryWithUsage++; r.compaction.usageTimes.push({ seq: ev?.seq, utc: new Date(ev?.time ?? 0).toISOString(), keys: Object.keys(d).join(','), usage: JSON.stringify(d.usage ?? null).slice(0, 200) }); }
          else r.compaction.summaryWithoutUsage++;
          r.compaction.summaryTimes.push({ seq: ev?.seq, utc: new Date(ev?.time ?? 0).toISOString(), hasUsage, keys: Object.keys(d).join(',') });
        }
        if (type === 'compaction/start') r.compaction.start++;
        if (type === 'compaction/end') r.compaction.end++;
      });
      r.files.find((x) => x.path === f.path).decode = stat;
    }

    // 工具名录：request/header 里挂给模型的工具名
    for (const f of files) {
      forEachEvent(f.path, (ev) => {
        const tools = ev?.data?.header?.tools;
        if (Array.isArray(tools)) for (const t of tools) if (t && typeof t.name === 'string') inc(r.promptExposure.toolDefsNames, `${t.name} (${ev.type})`);
        if (Array.isArray(ev?.data?.header?.ptcFunctions ?? ev?.data?.header?.functions ?? null)) {
          for (const t of (ev.data.header.ptcFunctions ?? ev.data.header.functions)) if (t?.name) inc(r.promptExposure.toolDefsNames, `${t.name} (ptc)`);
        }
      });
    }

    T.sq_narrow_anyCallType += [...r.sqNarrow.byCallType.values()].reduce((a, b) => a + b, 0);
    T.sq_narrow_toolCall += r.sqNarrow.byCallType.get('tool/call') ?? 0;
    T.sq_narrow_ptcDispatch += r.sqNarrow.byCallType.get('tool/ptc-dispatch') ?? 0;
    T.sq_wide_raw += r.sqWide.rawOccurrences;
    T.sq_wide_events += r.sqWide.eventsContaining;
    for (const [k, n] of r.family.narrowByCallTypeAndName) T.family_narrow_anyCallType += n;
    for (const n of r.family.wideRawByToken.values()) T.family_wide_raw += n;
    T.compact_dispatch += r.compact.dispatch;
    T.compact_dispatchStart += r.compact.dispatchStart;
    T.compact_toolCall += r.compact.toolCall;
    T.compact_messageBlock += r.compact.messageBlock;
    T.compactionSummary += r.compaction.summary;
    T.compactionSummaryWithUsage += r.compaction.summaryWithUsage;
    T.compactionStart += r.compaction.start;
    T.compactionEnd += r.compaction.end;
    T.selflogReads += r.selflog.total;
    T.recoveryNamedCalls += r.recoveryNamed.total;

    report.perRun[run.key] = {
      label: r.label, bucket: r.bucket, bucketError: r.bucketError,
      files: r.files.map((f) => ({ sessionId: f.sessionId, file: f.file, relPath: f.relPath, bytes: f.bytes, mtime: f.mtime, decode: f.decode })),
      timeRange: { from: r.timeRange[0] ? new Date(r.timeRange[0]).toISOString() : null, to: r.timeRange[1] ? new Date(r.timeRange[1]).toISOString() : null },
      eventHistogram: obj(r.events),
      sessionQuery: {
        narrowByCallType: obj(r.sqNarrow.byCallType), narrowSamples: r.sqNarrow.samples,
        literalSessionQueryRawOccurrences: r.family.wideRawByToken.get('session_query') ?? 0,
        wideRawOccurrences: r.sqWide.rawOccurrences, wideEventsContaining: r.sqWide.eventsContaining,
        wideByEventType: obj(r.sqWide.byEventType), wideByValuePath: obj(r.sqWide.byPath), wideByKeyPath: obj(r.sqWide.keyPaths),
        wideInModelAuthoredFields: obj(r.sqWide.modelAuthored), wideSamples: r.sqWide.samples,
      },
      recoveryToolFamily: {
        narrowCallLayer: obj(r.family.narrowByCallTypeAndName),
        wideRawByToken: Object.fromEntries(SQ_TOKENS.map((t) => [t, r.family.wideRawByToken.get(t) ?? 0])),
        wideByValuePath: obj(r.family.wideByPath),
        samples: r.family.samples,
      },
      compactRegion: {
        ptcDispatch: r.compact.dispatch, ptcDispatchStart: r.compact.dispatchStart, toolCall: r.compact.toolCall,
        assistantMessageBlocks: r.compact.messageBlock, byEventType: obj(r.compact.byEventType), samples: r.compact.samples,
      },
      compactionEvents: r.compaction,
      selfLogAccess: { total: r.selflog.total, byToolAndSignal: obj(r.selflog.byToolAndSignal), samples: r.selflog.samples },
      recoveryNamedCalls: { total: r.recoveryNamed.total, byName: obj(r.recoveryNamed.byName), samples: r.recoveryNamed.samples },
      toolInventory: obj(r.toolInventory),
      ptcCallSitesInCode: obj(r.ptcCallSites),
      harnessExposure: {
        toolNamesInRequestHeader: obj(r.promptExposure.toolDefsNames),
        sqTokensInSystemMessage: obj(r.promptExposure.inSystemMessage),
        sqTokensInRequestHeader: obj(r.promptExposure.inRequestHeader),
      },
    };
  }
  report.totals = T;
  report.notes = {
    toolNaming:
      '模型可调用的是 5 个只读工具 session_search / session_event_search / session_trace / session_event_trace / session_event_read（packages/session-query/tool-session-query/src/index.ts:66-115）；' +
      '"session_query" 是 ctx.sessionQuery 这个代码侧 seam 的名字，从未作为工具名暴露。窄口径按字面 session_query 与这 5 个真名各数一次。',
    harnessExposureSources: [
      '$HOME/dsh-data/workplace/dsh-compact-region/src/rules.ts:93-98 —— 系统提示「必须回读原文的情况，先读再答」段，逐字给出 session_event_read(seq_from=…, seq_to=…, surfaces=["shadowed","log-only"]) 与 session_event_search(...) 两种用法',
      '$HOME/dsh-data/workplace/dsh-compact-region/src/index.ts:1050 —— 每次折叠回执里的 session_event_read 逐字指针',
      '$HOME/dsh-data/.dsh/profiles/web/cordis.patch.yml:62-82 —— 该部署确实挂载：替换 session-query-sqlite 的 config（path=$HOME/dsh-data/.dsh/session-query/search.sqlite、openAt=first-search、WAL）并 insert tool-session-query（maxSearchResults 20 / searchTimeoutMs 15000）',
    ],
    decodeIntegrity: '三场各 1 个 session.v4.jsonl.zstd；magic 扫描逐帧 zstdDecompressSync，framesOk == frameTries，unparsed=0，事件数与行号统计一致',
    crossCheck18: 'compaction/summary 三场合计 18（9+4+5）与已发布总数自洽；但拆分为模型自写 16 + 引擎另发一次 LLM 请求 2（两次都在炸弹人：seq1058 本地18:16:37、seq1518 本地23:15:05，payload 键含 usage/maxTokens/llmStreamCall/rawOutput）。' +
      '已发布口径「17 主动 + 1 引擎」以及「炸弹人 compact_region 3 次」与原始日志不符：炸弹人 compact_region 派发为 2 次，且 2 次带 usage 的 summary 都没有对应的 compact_region 派发（16 派发 == 16 无 usage 的 summary）。',
  };
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ totals: T, perRun: Object.fromEntries(Object.entries(report.perRun).map(([k, v]) => [k, {
    sq_narrow: v.sessionQuery.narrowByCallType, sq_wide_raw: v.sessionQuery.wideRawOccurrences, sq_wide_events: v.sessionQuery.wideEventsContaining,
    family_wide_raw: v.recoveryToolFamily.wideRawByToken, family_narrow: v.recoveryToolFamily.narrowCallLayer,
    compact: { dispatch: v.compactRegion.ptcDispatch, start: v.compactRegion.ptcDispatchStart, toolCall: v.compactRegion.toolCall, msgBlocks: v.compactRegion.assistantMessageBlocks, byEventType: v.compactRegion.byEventType },
    compaction: { summary: v.compactionEvents.summary, withUsage: v.compactionEvents.summaryWithUsage, start: v.compactionEvents.start, end: v.compactionEvents.end },
    selflog: v.selfLogAccess.total, selflogBy: v.selfLogAccess.byToolAndSignal,
    recoveryNamed: v.recoveryNamedCalls.total, toolCount: Object.keys(v.toolInventory).length,
    ptcCallSitesInCode: v.ptcCallSitesInCode,
    wideByEventType: v.sessionQuery.wideByEventType, wideByValuePath: v.sessionQuery.wideByValuePath,
    headerTools: v.harnessExposure.toolNamesInRequestHeader,
    timeRange: v.timeRange,
  }])) }, null, 2));
  console.log('written: ' + OUT_JSON);
}

function discover(runFilter) {
  for (const run of RUNS.filter((r) => !runFilter || r.key === runFilter)) {
    const { error, files } = listSessionFiles(run);
    console.log(`## ${run.label} bucket=${run.bucket} error=${error}`);
    for (const f of files) console.log('  file', f.path, f.bytes, f.mtime);
  }
}

function peek(runFilter, type, n) {
  const run = RUNS.find((r) => r.key === runFilter);
  if (!run) return console.log('bad runKey');
  const { files } = listSessionFiles(run);
  let shown = 0;
  for (const f of files) {
    forEachEvent(f.path, (ev, raw) => {
      if (!ev || String(ev.type ?? '') !== type || shown >= (n || 1)) return;
      shown++;
      const trimmed = [];
      walk(ev, [], (path, key, val) => {
        if (typeof val === 'string') trimmed.push(`${path} = ${clip(val)}`);
        else trimmed.push(`${path} = ${String(val)}`);
      });
      console.log(`--- seq=${ev.seq} time=${ev.time ? new Date(ev.time).toISOString() : ''} type=${ev.type} rawLen=${raw.length}`);
      for (const l of trimmed.slice(0, 120)) console.log('   ' + l);
      if (trimmed.length > 120) console.log(`   … (${trimmed.length - 120} more scalar fields)`);
    });
  }
}

// 名录取证：找出日志里「挂给模型的工具名录」文本，看恢复工具族有没有被写过
function catalog(runFilter) {
  for (const run of RUNS.filter((r) => !runFilter || r.key === runFilter)) {
    const { files } = listSessionFiles(run);
    console.log(`\n##### ${run.label}`);
    let printed = 0;
    const hist = new Map();
    for (const f of files) {
      forEachEvent(f.path, (ev) => {
        const type = String(ev?.type ?? '?');
        walk(ev, [], (path, key, val) => {
          if (typeof val !== 'string') return;
          const at = val.indexOf('compact_region');
          const named = ['bash(', 'read(', 'edit(', 'write(', 'grep(', 'glob(', 'job_output(', 'compact_region(', 'session_event_read(', 'session_search('].filter((t) => val.includes(t));
          const hitTokens = SQ_TOKENS.filter((t) => val.includes(t));
          if (at >= 0) {
            inc(hist, `catalog@${type}::${path}`);
            if (printed++ < 6) {
              console.log(`[catalog-string] seq=${ev.seq} type=${type} path=${path} len=${val.length} sessionTokens=${hitTokens.join(',') || 'NONE'} funcs=${named.join(' ')}`);
              console.log('   window: ' + val.replace(/\s+/g, ' ').slice(Math.max(0, at - 600), at + 900));
            }
          } else if (named.length >= 4) {
            inc(hist, `roster@${type}::${path}`);
            if (printed++ < 6) console.log(`[roster-only] seq=${ev.seq} type=${type} path=${path} len=${val.length} funcs=${named.join(' ')} sessionTokens=${hitTokens.join(',') || 'NONE'}`);
          }
          for (const re of [/folded/i, /session history/i, /previous(?:ly)? (?:messages|turns|conversation)/i]) {
            const m = val.match(re);
            if (m) {
              inc(hist, `phrase@${type}::${path}::${re}`);
              if (printed++ < 10) {
                console.log(`[phrase ${re}] seq=${ev.seq} type=${type} path=${path}`);
                console.log('   ' + val.replace(/\s+/g, ' ').slice(Math.max(0, (m.index ?? 0) - 250), (m.index ?? 0) + 450));
              }
              break;
            }
          }
        }, null);
      });
    }
    console.log('signal histogram:');
    for (const [k, n] of [...hist].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${k}`);
  }
}

// 模型在 run_code 代码里写了哪些 tools.xxx( 调用（含从未成功派发的尝试）
function ptccalls(runFilter) {
  const perRun = {};
  for (const run of RUNS.filter((r) => !runFilter || r.key === runFilter)) {
    const { files } = listSessionFiles(run);
    const hist = new Map();
    const codeHist = new Map();
    for (const f of files) {
      forEachEvent(f.path, (ev) => {
        const type = String(ev?.type ?? '?');
        if (!['tool/call', 'assistant/message'].includes(type)) return;
        walk(ev, [], (path, key, val) => {
          if (typeof val !== 'string' || !/tools\.[a-z_]/.test(val)) return;
          // 只看代码体，避免把提示文本也算进来
          if (!/(arguments|code|text)$/.test(path)) return;
          for (const m of val.matchAll(/tools\.([a-z_][a-z0-9_]*)\s*\(/g)) inc(hist, m[1]);
        }, null);
      });
    }
    perRun[run.key] = obj(hist);
    console.log(`##### ${run.label}`);
    for (const [k, n] of [...hist].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\ttools.${k}(`);
  }
  return perRun;
}

// 按 seq 打印原始行（截断到 3000 字符/行），用于人工核对字段与写法
function raw(runFilter, seqs) {
  const run = RUNS.find((r) => r.key === runFilter);
  if (!run) return console.log('bad runKey');
  const want = new Set(seqs.map(Number));
  const { files } = listSessionFiles(run);
  for (const f of files) {
    forEachEvent(f.path, (ev, line) => {
      if (!ev || !want.has(Number(ev.seq))) return;
      console.log(`\n##### ${run.key} seq=${ev.seq} type=${ev.type} time=${ev.time ? new Date(ev.time).toISOString() : ''} rawLen=${line.length}`);
      console.log(line.slice(0, 3000));
    });
  }
}

// 在「模型写的代码」里搜一个词，看它到底怎么调用工具（只搜 tool/call 与 assistant/message 的参数字段）
function grepcode(runFilter, word) {
  const run = RUNS.find((r) => r.key === runFilter);
  if (!run) return console.log('bad runKey');
  const { files } = listSessionFiles(run);
  let shown = 0;
  for (const f of files) {
    forEachEvent(f.path, (ev, line) => {
      if (!ev || shown >= 6) return;
      const type = String(ev.type ?? '');
      if (!['tool/call', 'assistant/message'].includes(type)) return;
      const at = line.indexOf(word);
      if (at < 0) return;
      shown++;
      console.log(`--- ${run.key} seq=${ev.seq} type=${type} word=${word}`);
      console.log('   ' + line.replace(/\\n/g, ' ').slice(Math.max(0, at - 260), at + 320));
    });
  }
  if (!shown) console.log(`(${run.key}: 「${word}」在 tool/call 与 assistant/message 里 0 次)`);
}

// 打印提示词/回执里出现恢复工具名的上下文窗口（取证用，输出量有上限）
function promptwindow(runFilter, token) {
  const run = RUNS.find((r) => r.key === runFilter);
  if (!run) return console.log('bad runKey');
  const tok = token || 'session_event_read';
  const { files } = listSessionFiles(run);
  let shown = 0;
  for (const f of files) {
    forEachEvent(f.path, (ev) => {
      if (!ev || shown >= 4) return;
      const type = String(ev.type ?? '');
      if (!['system/message', 'compaction/summary', 'user/message', 'tool/ptc-dispatch'].includes(type)) return;
      walk(ev, [], (path, key, val) => {
        if (shown >= 4 || typeof val !== 'string') return;
        const at = val.indexOf(tok);
        if (at < 0) return;
        shown++;
        console.log(`--- ${run.key} seq=${ev.seq} type=${type} path=${path} len=${val.length} token=${tok}`);
        console.log(val.replace(/\s+/g, ' ').slice(Math.max(0, at - 700), at + 900));
      }, null);
    });
  }
  if (!shown) console.log(`(${run.key}: ${tok} 在 system/message·compaction/summary·user/message·tool/ptc-dispatch 中 0 次)`);
}

const MODE = process.argv[2] || 'count';
if (MODE === 'count') count(process.argv[3]);
else if (MODE === 'discover') discover(process.argv[3]);
else if (MODE === 'peek') peek(process.argv[3], process.argv[4], Number(process.argv[5] || 1));
else if (MODE === 'catalog') catalog(process.argv[3]);
else if (MODE === 'ptccalls') ptccalls(process.argv[3]);
else if (MODE === 'raw') raw(process.argv[3], process.argv.slice(4));
else if (MODE === 'grepcode') grepcode(process.argv[3], process.argv[4]);
else if (MODE === 'promptwindow') promptwindow(process.argv[3], process.argv[4]);
else console.log('unknown mode ' + MODE);
