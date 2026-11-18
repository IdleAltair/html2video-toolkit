// music_p5r_v6.mjs — P5R「Beneath the Mask」爵士循环 · v6
// 88 BPM · 58% swing · C 大调 12 小节（≈32.7s，269s 导览 ≈8.2 圈）
// v6 改动：去沙哑（主音改 muted-trumpet 正弦泛音列、去 950Hz 带通；中音去 Q1.8 共振；
//    Rhodes 慢浅颤音；空气垫从 6.4k 嘶声改暖房音）· 节奏更丰富（沙球、鬼音、16 分加花、刷鼓 fill）
//   · 提速 78→88 · 母带改为「先归一化 → 混响 → 轻 tanh」，不再每下底鼓硬饱和
import fs from "node:fs";
let seed = 20260825;
const SR = 22050, BPM = 88.0, BEAT = 60 / BPM, BARS = 12, SWING = 0.58;
const LOOP = BARS * 4 * BEAT;
const N = Math.round(LOOP * SR);
const OUT = process.argv[2] || "./music-loop-v6.wav";

function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const TAU = Math.PI * 2;
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
const t8 = (bar, pos) => (bar * 4 + Math.floor(pos / 2) + (pos % 2) * SWING) * BEAT;            // 摆 8 分（pos 0-7）
const t16 = (bar, pos) => (bar * 4 + Math.floor(pos / 4) + [0, 1 / 3, 0.5, 5 / 6][pos % 4]) * BEAT; // 摆 16 分（pos 0-15）

/* ---- biquad ---- */
function biquad(type, fc, q) {
  const w = TAU * Math.min(fc, SR * 0.45) / SR, cw = Math.cos(w), sw = Math.sin(w);
  let b0, b1, b2, a0, a1, a2;
  if (type === "lp") { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + sw / q; a1 = -2 * cw; a2 = 1 - sw / q; }
  else if (type === "hp") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + sw / q; a1 = -2 * cw; a2 = 1 - sw / q; }
  else { b0 = sw / q; b1 = 0; b2 = -sw / q; a0 = 1 + sw / q; a1 = -2 * cw; a2 = 1 - sw / q; }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  return (x) => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const out = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
      out[i] = y;
    }
    return out;
  };
}

/* ---- voices ---- */
function kick(v = 1) {
  const n = Math.round(0.17 * SR), t = new Float64Array(n), ph = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / SR, f = 40 + 60 * Math.exp(-s / 0.045);
    ph[i] = i === 0 ? 0 : ph[i - 1] + TAU * f / SR;
    t[i] = Math.sin(ph[i]) * Math.exp(-s / 0.075);
  }
  for (let i = 0; i < 60; i++) t[i] += (rnd() * 2 - 1) * Math.exp(-i / (0.0018 * SR)) * 0.3;
  return biquad("lp", 320, 0.7)(t.map((s) => s * v));
}
/* 刷鼓：单一 2k 带通 + 低频体，去掉 5.4k 刺响 */
function snare(v = 1) {
  const n = Math.round(0.15 * SR), nz = new Float64Array(n);
  for (let i = 0; i < n; i++) nz[i] = rnd() * 2 - 1;
  const n1 = biquad("bp", 2000, 0.8)(nz);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / SR;
    out[i] = (Math.sin(TAU * 175 * s) * Math.exp(-s / 0.045) * 0.35
      + n1[i] * Math.exp(-s / 0.05) * 0.85) * v;
  }
  return out;
}
function hat(open_, v = 1) {
  const dur = open_ ? 0.3 : 0.045, n = Math.round(dur * SR), nz = new Float64Array(n);
  for (let i = 0; i < n; i++) nz[i] = rnd() * 2 - 1;
  const hp = biquad("hp", 7600, 0.8)(nz);
  const tau = open_ ? 0.1 : 0.014, out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = hp[i] * Math.exp(-i / (SR * tau)) * v;
  return out;
}
/* 沙球：更细更轻的 10.5k 噪声点 */
function shaker(v = 1) {
  const n = Math.round(0.05 * SR), nz = new Float64Array(n);
  for (let i = 0; i < n; i++) nz[i] = rnd() * 2 - 1;
  const hp = biquad("hp", 10500, 0.9)(nz);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = hp[i] * Math.exp(-i / (SR * 0.008)) * v;
  return out;
}
function bassNote(m, dur, v = 1) {
  const n = Math.round(dur * SR), f = midiHz(m), out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / SR;
    const g = 0.988 + 0.012 * Math.min(1, s / 0.03);
    const ph = TAU * f * g * s;
    out[i] = (Math.sin(ph) + 0.48 * Math.sin(2 * ph) + 0.16 * Math.sin(3 * ph) + 0.05 * Math.sin(4 * ph))
      * (1 - Math.exp(-s / 0.006)) * Math.exp(-s / 0.17) * v;
  }
  return biquad("lp", 760, 0.8)(out);
}
/* Rhodes：三失谐正弦 + 慢浅颤音（4.3Hz/10% 改 1.3Hz/4.5%），锤击 ping 更轻 */
function rhodes(midis, dur, v = 1) {
  const n = Math.round(dur * SR), out = new Float64Array(n);
  for (const m of midis) {
    const f = midiHz(m);
    for (let i = 0; i < n; i++) {
      const s = i / SR;
      const lfo = 1 + 0.045 * Math.sin(TAU * 1.3 * s + m);
      let x = Math.sin(TAU * f * 0.9975 * s) + Math.sin(TAU * f * s) + Math.sin(TAU * f * 1.004 * s)
        + 0.5 * Math.sin(TAU * 2 * f * s) + 0.18 * Math.sin(TAU * 3 * f * s);
      x = x * lfo + 0.12 * Math.sin(TAU * f * 5.42 * s) * Math.exp(-s / 0.06);
      out[i] += x * (1 - Math.exp(-s / 0.004)) * Math.exp(-s / 0.38);
    }
  }
  const f2 = biquad("lp", 4600, 0.7)(out);
  for (let i = 0; i < n; i++) f2[i] *= v;
  return f2;
}
/* 主音 = 弱音小号：正弦泛音列（1, .5, .22, .09, .04），无带通雕频，14ms 起振 + 慢入气息 */
function lead(m, dur, v = 1) {
  const n = Math.round((dur + 0.14) * SR), f0 = midiHz(m), out = new Float64Array(n);
  const vibT = Math.max(0.12, dur * 0.4), ph = new Float64Array(n);
  const P = [1, 0.5, 0.22, 0.09, 0.04];
  for (let i = 1; i < n; i++) {
    const s = i / SR;
    const vib = 0.009 * Math.sin(TAU * 5.5 * s) * (s < vibT ? s / vibT : 1);
    ph[i] = ph[i - 1] + TAU * f0 * (1 + vib - 0.004 * Math.exp(-s / 0.05)) / SR;
  }
  const nz = new Float64Array(n);
  for (let i = 0; i < n; i++) nz[i] = rnd() * 2 - 1;
  const breath = biquad("bp", 1000, 0.7)(nz);
  for (let i = 0; i < n; i++) {
    const s = i / SR;
    let x = 0;
    for (let k = 0; k < P.length; k++) x += P[k] * Math.sin(ph[i] * (k + 1) + (k + 1) * 0.7);
    x = x * 0.8 + breath[i] * 0.09 * Math.min(1, s / 0.06);   // 气息 60ms 缓入，不“啧”
    const atk = 1 - Math.exp(-s / 0.014);
    const rel = s > dur ? Math.exp(-(s - dur) / 0.09) : 1;
    out[i] = x * atk * rel * v;
  }
  return biquad("lp", 2800, 0.6)(out);
}
/* 铜管：k^-1 泛音 + 低 Q 柔共振（Q1.8→0.9），攻击 8ms、衰减更柔 */
function brass(midis, dur, v = 1) {
  const n = Math.round((dur + 0.1) * SR), out = new Float64Array(n);
  for (const m of midis) {
    const f = midiHz(m);
    for (let i = 0; i < n; i++) {
      const s = i / SR;
      const vib = 0.005 * Math.sin(TAU * 5.8 * s) * Math.min(1, s / (dur * 0.5));
      let x = 0;
      for (let k = 1; k <= 4; k++) x += Math.sin(TAU * f * k * s * (1 + vib)) / k;
      out[i] += x * (1 - Math.exp(-s / 0.008)) * Math.exp(-s / 0.16);
    }
  }
  const lp = biquad("lp", 2200, 0.7)(out), res = biquad("bp", 850, 0.9)(out);
  for (let i = 0; i < n; i++) lp[i] = (lp[i] * 0.85 + res[i] * 0.25) * v;
  return lp;
}
function whoosh(dur, v = 1) {
  const n = Math.round(dur * SR), nz = new Float64Array(n), out = new Float64Array(n);
  for (let i = 0; i < n; i++) nz[i] = rnd() * 2 - 1;
  let a = 0, y = 0;
  for (let i = 0; i < n; i++) {
    const p = i / n, fc = 260 + 2340 * p;
    a = Math.exp(-TAU * fc / SR);
    y = nz[i] + a * (y - nz[i]);
    out[i] = y * Math.sin(Math.PI * p) ** 1.3 * v;
  }
  return out;
}
/* 空气垫：暖房音（lp 950）+ 极轻高频微光（bp 5800）——替代 6.4k 嘶声床 */
function airBed() {
  const nz = new Float64Array(N);
  for (let i = 0; i < N; i++) nz[i] = rnd() * 2 - 1;
  const warm = biquad("lp", 950, 0.7)(nz), sparkle = biquad("bp", 5800, 0.9)(nz);
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const s = i / SR, lfo = 0.85 + 0.25 * Math.sin(TAU * s / LOOP);
    out[i] = (warm[i] * 0.006 + sparkle[i] * 0.003) * lfo;
  }
  return out;
}

/* ---- light Schroeder reverb ---- */
function allpass(x, d, g) {
  const out = new Float64Array(x.length);
  const xd = new Float64Array(d), yd = new Float64Array(d);
  let idx = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i], yi = -g * xi + xd[idx] + g * yd[idx];
    xd[idx] = xi; yd[idx] = yi; idx = (idx + 1) % d;
    out[i] = yi;
  }
  return out;
}
function reverb(x, wet) {
  const sum = new Float64Array(x.length);
  for (const [d, fb] of [[2425, 0.34], [3042, 0.38], [3660, 0.32], [4277, 0.36]]) {
    const buf = new Float64Array(d);
    let idx = 0;
    for (let i = 0; i < x.length; i++) {
      const y = x[i] + fb * buf[idx];
      buf[idx] = y; idx = (idx + 1) % d;
      sum[i] += y;
    }
  }
  const ap = allpass(allpass(sum, 17, 0.5), 29, 0.5);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + ap[i] * wet;
  return out;
}

/* ---- arrangement (12 bars, C major) — 旋律/和声沿用 v5 设计 ---- */
const CH = {
  1: [57, 64, 71, 74], 2: [55, 62, 66, 71], 3: [57, 60, 64, 67], 4: [58, 62, 65, 69],
  5: [57, 64, 67, 71], "6a": [52, 55, 59, 62], "6b": [55, 62, 66, 69], 7: [57, 60, 64, 67], 8: [58, 62, 65, 69],
  9: [60, 64, 67, 71], "10a": [55, 57, 60, 64], "10b": [53, 57, 60, 64], 11: [58, 61, 65, 68], 12: [60, 64, 67, 71],
};
const chordOf = (bar) => bar === 5 ? CH["6a"] : bar === 9 ? CH["10a"] : CH[bar + 1];
const chordB = (bar) => bar === 5 ? CH["6b"] : bar === 9 ? CH["10b"] : null;
const BASS = {
  0: { 0: 36, 2: 40, 4: 43, 6: 47 }, 1: { 0: 45, 2: 47, 4: 50, 6: 52 }, 2: { 0: 50, 2: 52, 3: 49, 4: 50, 6: 53 },
  3: { 0: 43, 2: 46, 4: 50, 6: 53 }, 4: { 0: 41, 2: 44, 4: 48, 6: 50 }, 5: { 0: 40, 2: 43, 4: 47, 6: 48 },
  6: { 0: 50, 2: 49, 4: 50, 6: 52 }, 7: { 0: 43, 2: 46, 4: 47, 6: 48 }, 8: { 0: 36, 2: 40, 4: 43, 6: 45 },
  9: { 0: 45, 2: 47, 4: 50, 6: 48 }, 10: { 0: 43, 2: 41, 4: 43, 6: 46 }, 11: { 0: 36, 2: 43, 4: 40, 6: 47 },
};
const LEAD = [
  [0, 3, [74, 2]], [0, 5, [72, 1]],
  [1, 0, [76, 1]], [1, 2, [79, 2]], [1, 4, [76, 2]],
  [2, 0, [77, 2]], [2, 3, [79, 1]], [2, 4, [76, 3]],
  [3, 4, [74, 2]],
  [4, 0, [72, 1]], [4, 1, [74, 1]], [4, 2, [77, 2]],
  [5, 0, [76, 3]], [5, 4, [74, 1]], [5, 5, [72, 1]],
  [6, 2, [71, 1]], [6, 3, [72, 1]], [6, 4, [74, 2]], [6, 6, [76, 1]],
  [7, 0, [79, 4]],
  [8, 0, [76, 2]], [8, 3, [74, 1]], [8, 4, [72, 2]],
  [9, 2, [71, 2]], [9, 4, [74, 2]],
  [10, 0, [77, 2]], [10, 3, [79, 1]], [10, 4, [76, 2]],
];
const BRASS = [
  [1, 6, [62, 66]], [5, 0, [45]], [5, 7, [55, 62]], [7, 6, [58, 65]],
  [9, 6, [57, 64]], [10, 7, [62, 69]], [11, 6, [60, 64, 67]],
];
const HAT_V = [0.8, 0.5, 0.75, 0.45, 0.8, 0.5, 0.6, 0.35];

/* ---- mix ---- */
const buf = new Float64Array(N);
const buses = {};
function put(sig, startS, gain, name) {
  const i = Math.round(startS * SR);
  if (i < 0 || i >= N) return;
  const j = Math.min(N, i + sig.length);
  const bus = name ? (buses[name] ||= new Float64Array(N)) : null;
  for (let kk = i; kk < j; kk++) {
    const v = sig[kk - i] * gain;
    buf[kk] += v;
    if (bus) bus[kk] += v;
  }
}
for (let b = 0; b < BARS; b++) {
  put(kick(1.0), t8(b, 0), 1.45, "kick");
  put(kick(0.85), t8(b, 5), 1.45, "kick");
  if (b === 4 || b === 8) put(kick(0.75), t8(b, 3), 1.45, "kick");
  if (b === 10) put(kick(0.6), t8(b, 7), 1.45, "kick");
  put(snare(b === 11 ? 0.55 : 0.8), t8(b, 2), 0.52, "snare");
  put(snare(0.85), t8(b, 6), 0.52, "snare");
  // 鬼音（刷感）：偶数小节 3&，奇数小节 4&
  if (b % 2 === 1) put(snare(0.16), t8(b, 5), 0.52, "snare");
  else put(snare(0.12), t8(b, 7), 0.52, "snare");
  if (b >= 8 && b % 2 === 0) put(snare(0.14), t8(b, 3), 0.52, "snare");
  // 刷鼓 fill：第 8 小节 4 拍内两记
  if (b === 7) { put(snare(0.3), t8(b, 6), 0.52, "snare"); put(snare(0.38), t8(b, 7), 0.52, "snare"); }
  if (b === 11) { for (const p of [0, 2, 4, 6]) put(hat(false, 0.5), t8(b, p), 0.62, "hat"); put(hat(false, 0.35), t8(b, 7), 0.62, "hat"); }
  else {
    for (let p = 0; p < 8; p++) put(hat(false, HAT_V[p]), t8(b, p), 0.62, "hat");
    if (b === 3 || b === 7) put(hat(true, 0.5), t8(b, 7), 0.45, "hat");
    // 16 分 hi-hat 加花：第 4、8 小节整小节滚奏
    if (b === 3 || b === 7) for (let p = 8; p < 16; p++) put(hat(false, 0.3 + 0.02 * (p - 8)), t16(b, p), 0.62, "hat");
    if (b === 11) for (const p of [8, 12]) put(hat(false, 0.3), t16(b, p), 0.62, "hat");
  }
  // 沙球：全程 8 分 + 加花小节 16 分
  for (let p = 0; p < 8; p++) put(shaker(0.55 + 0.25 * HAT_V[p]), t8(b, p), 1, "shaker");
  if (b === 3 || b === 7 || b === 11) for (const p of [8, 10, 12, 14]) put(shaker(0.4), t16(b, p), 1, "shaker");
  for (const [p, m] of Object.entries(BASS[b])) put(bassNote(m, (BEAT / 2) * 0.75, 1.0), t8(b, +p), 1.35, "bass");
  if (b === 5 || b === 9) {
    put(rhodes(chordOf(b), BEAT * 0.9, 0.5), t8(b, 0), 1, "rhodes");
    put(rhodes(chordB(b), BEAT * 0.9, 0.5), t8(b, 4), 1, "rhodes");
  } else if (b === 11) {
    put(rhodes(chordOf(b), BEAT * 1.1, 0.45), t8(b, 0), 1, "rhodes");
    put(rhodes(chordOf(b), BEAT * 0.9, 0.4), t8(b, 4), 1, "rhodes");
  } else {
    put(rhodes(chordOf(b), BEAT * 0.9, 0.46), t8(b, 7), 1, "rhodes");
    if (b === 0 || b === 4 || b === 8) put(rhodes(chordOf(b), BEAT * 0.7, 0.3), t8(b, 3), 1, "rhodes");
    if (b === 10) put(rhodes(chordOf(b), BEAT * 0.7, 0.3), t8(b, 3), 1, "rhodes");
  }
  for (const e of LEAD) if (e[0] === b) put(lead(e[2][0], e[2][1] * BEAT / 2, 0.6), t8(b, e[1]), 1, "lead");
  for (const e of BRASS) if (e[0] === b) put(brass(e[2], 0.3, 0.5), t8(b, e[1]), 1, "brass");
}
put(whoosh(0.55, 0.22), 0.02, 1, "fx");
put(whoosh(0.5, 0.16), 8 * 4 * BEAT + 0.02, 1, "fx");
put(airBed(), 0, 1, "air");

/* ---- master：先归一化 → 混响 → 轻软削峰（v5 的每拍硬 tanh 是“涩”的主因） ---- */
let x = biquad("hp", 32, 0.7)(buf);
x = biquad("lp", 12500, 0.7)(x);
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(x[i]));
for (let i = 0; i < N; i++) x[i] *= 0.92 / peak;
x = reverb(x, 0.15);
for (let i = 0; i < N; i++) x[i] = Math.tanh(1.15 * x[i]);
peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(x[i]));
const k = 0.78 / peak;
const out = new Float64Array(N);
for (let i = 0; i < N; i++) out[i] = x[i] * k;
let mean = 0;
for (let i = 0; i < N; i++) mean += out[i];
mean /= N;
for (let i = 0; i < N; i++) out[i] -= mean;
const fd = Math.round(0.03 * SR);
for (let i = 0; i < fd; i++) out[N - fd + i] *= 1 - i / fd;

/* ---- write wav + report ---- */
const pcm = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i])) * 32767), i * 2);
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVE", 8);
hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(OUT, Buffer.concat([hdr, pcm]));
const rms = (a, o, l) => { let s = 0; for (let i = o; i < o + l; i++) s += a[i] * a[i]; return Math.sqrt(s / l); };
const pk = (a, o, l) => { let m = 0; for (let i = o; i < o + l; i++) m = Math.max(m, Math.abs(a[i])); return m; };
console.log("wrote " + OUT + "  " + N + " samples = " + (N / SR).toFixed(3) + " s (" + BARS + " bars @ " + BPM + " BPM, swing " + SWING + ")");
console.log("master rms " + rms(out, 0, N).toFixed(4) + "  peak " + pk(out, 0, N).toFixed(3) + "  dc " + (out.reduce((a, b2) => a + b2, 0) / N).toExponential(2));
console.log("seam tail(60ms) peak " + pk(out, N - Math.round(0.06 * SR), Math.round(0.06 * SR)).toExponential(2) + "  head(10ms) peak " + pk(out, 0, Math.round(0.01 * SR)).toFixed(3));
for (let bbar = 0; bbar < BARS; bbar++) {
  const o = Math.round(bbar * 4 * BEAT * SR), l = Math.round(4 * BEAT * SR);
  console.log("  bar " + String(bbar + 1).padStart(2) + " rms " + rms(out, o, l).toFixed(4) + "  peak " + pk(out, o, l).toFixed(3));
}
for (const name of Object.keys(buses)) console.log("  bus " + name.padEnd(7) + " rms " + rms(buses[name], 0, N).toFixed(4) + "  peak " + pk(buses[name], 0, N).toFixed(3));
