// music_p5r_v8.mjs — P5R 轻快空灵循环 · v8（综合 v1 的轻快明亮 + v7 的底音与制作）
// 108 BPM（v1 的速度感）· 48kHz 真立体声（v1/v7 都是 22k → 高频损失，本版补齐 11-18k 空气带）
// 保留 v7：walking bass 底音、和弦走向、Schroeder 混响、点状延迟 shimmer、无缝循环
// 增强：更密的铃铛旋律线（v1 的驱动感）、八度叠音、段落动态起伏（bar0 轻起 → 全鼓 → 加花）
//   更亮的铃铛泛音（5.4f/8.9f 长尾）、pad 双失谐声像、混响尾提亮、鼓组空气带（48k 下真实）
import fs from "node:fs";
let seed = 880801;
const SR = 48000, BPM = 108.0, BEAT = 60 / BPM, BARS = 12, SWING = 0.52;
const LOOP = BARS * 4 * BEAT;
const N = Math.round(LOOP * SR);
const OUT = process.argv[2] || "./music-loop-v8.wav";

function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const TAU = Math.PI * 2;
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
const t8 = (bar, pos) => (bar * 4 + Math.floor(pos / 2) + (pos % 2) * SWING) * BEAT;
const t16 = (bar, pos) => (bar * 4 + Math.floor(pos / 4) + [0, 1 / 4, 1 / 2, 3 / 4][pos % 4]) * BEAT;

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
  const n = Math.round(0.15 * SR), t = new Float64Array(n), ph = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / SR, f = 42 + 55 * Math.exp(-s / 0.04);
    ph[i] = i === 0 ? 0 : ph[i - 1] + TAU * f / SR;
    t[i] = Math.sin(ph[i]) * Math.exp(-s / 0.07);
  }
  for (let i = 0; i < 48; i++) t[i] += (rnd() * 2 - 1) * Math.exp(-i / (0.0015 * SR)) * 0.2;
  return biquad("lp", 300, 0.7)(t.map((s) => s * v));
}
function snare(v = 1) {
  const n = Math.round(0.13 * SR), nz = new Float64Array(n);
  for (let i = 0; i < n; i++) nz[i] = rnd() * 2 - 1;
  const n1 = biquad("bp", 1900, 0.7)(nz);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / SR;
    out[i] = (Math.sin(TAU * 170 * s) * Math.exp(-s / 0.04) * 0.3 + n1[i] * Math.exp(-s / 0.045) * 0.7) * v;
  }
  return out;
}
function hat(open_, v = 1) {
  const dur = open_ ? 0.28 : 0.04, n = Math.round(dur * SR), nz = new Float64Array(n);
  for (let i = 0; i < n; i++) nz[i] = rnd() * 2 - 1;
  const hp = biquad("hp", 9500, 0.8)(nz);
  const tau = open_ ? 0.12 : 0.012, out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = hp[i] * Math.exp(-i / (SR * tau)) * v;
  return out;
}
function shaker(v = 1) {
  const n = Math.round(0.05 * SR), nz = new Float64Array(n);
  for (let i = 0; i < n; i++) nz[i] = rnd() * 2 - 1;
  const hp = biquad("hp", 11000, 0.9)(nz);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = hp[i] * Math.exp(-i / (SR * 0.011)) * v;
  return out;
}
/* v7 底音原样（用户认可）：sine+2f+3f，快起振、LP750 实体感 */
function bassNote(m, dur, v = 1) {
  const n = Math.round(dur * SR), f = midiHz(m), out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / SR;
    const g = 0.99 + 0.01 * Math.min(1, s / 0.025);
    const ph = TAU * f * g * s;
    out[i] = (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph))
      * (1 - Math.exp(-s / 0.005)) * Math.exp(-s / 0.2) * v;
  }
  return biquad("lp", 750, 0.8)(out);
}
/* 空气 pad：三失谐正弦 + 高八度微光；det 参数做 L/R 独立失谐（立体声宽） */
function pad(midis, dur, v = 1, det = 0) {
  const n = Math.round((dur + 0.6) * SR), out = new Float64Array(n);
  for (const m of midis) {
    const f = midiHz(m) * (1 + det);
    for (let i = 0; i < n; i++) {
      const s = i / SR;
      let x = Math.sin(TAU * f * 0.998 * s) + Math.sin(TAU * f * 1.0 * s) + Math.sin(TAU * f * 1.003 * s)
        + 0.05 * Math.sin(TAU * f * 2 * s) + 0.14 * Math.sin(TAU * f * 4 * s);
      const atk = 1 - Math.exp(-s / 0.12);
      const rel = s > dur ? Math.exp(-(s - dur) / 0.25) : 1;
      out[i] += x * atk * rel;
    }
  }
  const lp = biquad("lp", 5500, 0.7)(out);
  for (let i = 0; i < n; i++) lp[i] *= v;
  return lp;
}
/* 铃铛：48k 下放开高频——5.4f/8.9f 长尾泛音 = 空灵 ping；整体尾 0.7s */
function bell(m, dur, v = 1) {
  const n = Math.round((dur + 0.9) * SR), f0 = midiHz(m), out = new Float64Array(n);
  const ph = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const s = i / SR;
    ph[i] = ph[i - 1] + TAU * f0 * (1 + (s > 0.25 ? 0.008 * Math.sin(TAU * 5 * (s - 0.25)) : 0)) / SR;
  }
  const P = [[1, 0, 0.7], [2, 1.4, 0.3], [2.76, 1.2, 0.16], [5.4, 4.0, 0.11], [8.9, 6.0, 0.07]];
  for (let i = 0; i < n; i++) {
    const s = i / SR;
    let x = 0;
    for (const [r, td, a] of P) x += a * Math.sin(ph[i] * r) * (td > 0 ? Math.exp(-s / td) : 1);
    out[i] = x * (1 - Math.exp(-s / 0.003)) * Math.exp(-s / 0.7) * v;
  }
  return biquad("lp", 12000, 0.7)(out);
}
/* 琶音拨片：加 2.76f 微非谐、尾加长、LP 放开到 13k（48k 空气真实） */
function pluck(m, v = 1) {
  const n = Math.round(0.45 * SR), f0 = midiHz(m), out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / SR;
    const x = Math.sin(TAU * f0 * s) + 0.3 * Math.sin(TAU * f0 * 2 * s) * Math.exp(-s / 0.05)
      + 0.12 * Math.sin(TAU * f0 * 2.76 * s) * Math.exp(-s / 0.08);
    out[i] = x * (1 - Math.exp(-s / 0.002)) * Math.exp(-s / 0.3) * v;
  }
  return biquad("lp", 13000, 0.7)(out);
}
/* 高位闪层：高八度短 ping，2f/5.4f 落 4-14k（空灵空气带） */
function glimmer(m, v = 1) {
  const n = Math.round(0.3 * SR), f0 = midiHz(m), out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / SR;
    const x = Math.sin(TAU * f0 * s) + 0.5 * Math.sin(TAU * f0 * 2 * s) * Math.exp(-s / 0.03)
      + 0.25 * Math.sin(TAU * f0 * 5.4 * s) * Math.exp(-s / 0.05);
    out[i] = x * (1 - Math.exp(-s / 0.0015)) * Math.exp(-s / 0.14) * v;
  }
  return biquad("lp", 16000, 0.7)(out);
}
function rhodes(midis, dur, v = 1) {
  const n = Math.round(dur * SR), out = new Float64Array(n);
  for (const m of midis) {
    const f = midiHz(m);
    for (let i = 0; i < n; i++) {
      const s = i / SR;
      const lfo = 1 + 0.04 * Math.sin(TAU * 1.3 * s + m);
      let x = Math.sin(TAU * f * 0.9975 * s) + Math.sin(TAU * f * s) + Math.sin(TAU * f * 1.004 * s)
        + 0.45 * Math.sin(TAU * 2 * f * s) + 0.16 * Math.sin(TAU * 3 * f * s);
      x = x * lfo + 0.1 * Math.sin(TAU * f * 5.42 * s) * Math.exp(-s / 0.06);
      out[i] += x * (1 - Math.exp(-s / 0.004)) * Math.exp(-s / 0.4);
    }
  }
  const f2 = biquad("lp", 7000, 0.7)(out);
  for (let i = 0; i < n; i++) f2[i] *= v;
  return f2;
}
function whoosh(dur, v = 1) {
  const n = Math.round(dur * SR), nz = new Float64Array(n), out = new Float64Array(n);
  for (let i = 0; i < n; i++) nz[i] = rnd() * 2 - 1;
  let a = 0, y = 0;
  for (let i = 0; i < n; i++) {
    const p = i / n, fc = 300 + 2600 * p;
    a = Math.exp(-TAU * fc / SR);
    y = nz[i] + a * (y - nz[i]);
    out[i] = y * Math.sin(Math.PI * p) ** 1.3 * v;
  }
  return out;
}
function airBed() {
  const nz = new Float64Array(N);
  for (let i = 0; i < N; i++) nz[i] = rnd() * 2 - 1;
  const warm = biquad("lp", 900, 0.7)(nz), sparkle = biquad("bp", 7500, 0.9)(nz);
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const s = i / SR, lfo = 0.85 + 0.25 * Math.sin(TAU * s / LOOP);
    out[i] = (warm[i] * 0.005 + sparkle[i] * 0.006) * lfo;
  }
  return out;
}

/* ---- 混响（Schroeder；尾提亮到 10.5k） ---- */
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
  for (const [d, fb] of [[2210, 0.36], [2790, 0.40], [3480, 0.34], [4160, 0.38], [5030, 0.30]]) {
    const buf = new Float64Array(d);
    let idx = 0;
    for (let i = 0; i < x.length; i++) {
      const y = x[i] + fb * buf[idx];
      buf[idx] = y; idx = (idx + 1) % d;
      sum[i] += y;
    }
  }
  const ap = allpass(allpass(sum, 19, 0.5), 31, 0.5);
  const lp = biquad("lp", 10500, 0.7)(ap);
  const out = new Float64Array(x.length);
  for (let i = 0; i < N; i++) out[i] = x[i] + lp[i] * wet;
  return out;
}
function shimmer(x, wet) {
  const D = Math.round(0.75 * BEAT * SR);
  const buf = new Float64Array(D);
  let idx = 0;
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const fb = buf[idx] * 0.26;
    out[i] = x[i] + fb * wet;
    buf[idx] = x[i] * 0.9 + fb;
    idx = (idx + 1) % D;
  }
  return out;
}

/* ---- arrangement（12 小节 C 大调：I V6 vi IV / I V6 vi V / IV V6 vi V） ---- */
const PADCH = [
  [60, 64, 67], [59, 62, 66], [57, 60, 64], [57, 60, 65],
  [60, 64, 67], [59, 62, 66], [57, 60, 64], [58, 62, 65],
  [57, 60, 65], [59, 62, 66], [57, 60, 64], [58, 62, 68],
];
const COMPCH = [
  [60, 64, 67, 71], [59, 62, 66, 70], [57, 60, 64, 67], [57, 60, 65, 69],
  [60, 64, 67, 71], [59, 62, 66, 70], [57, 60, 64, 67], [58, 62, 65, 68],
  [57, 60, 65, 69], [59, 62, 66, 70], [57, 60, 64, 67], [58, 62, 68, 71],
];
const BASS = { // v7 原样
  0: [36, 40, 43, 47], 1: [33, 35, 38, 40], 2: [33, 36, 40, 43], 3: [29, 35, 37, 40],
  4: [36, 43, 47, 45], 5: [33, 35, 38, 40], 6: [33, 36, 40, 43], 7: [43, 45, 48, 50],
  8: [29, 35, 37, 40], 9: [33, 35, 38, 40], 10: [33, 40, 43, 45], 11: [43, 45, 47],
};
/* 铃铛旋律线（v8 新写：8 分驱动 + 16 分加花；bar0 轻柔起、bar8-11 高位收，末音 C5 与下轮首音同音无缝）
   [bar, pos16, midi, beats] */
const LEAD = [
  [0, 0, 72, 0.5], [0, 4, 74, 0.5], [0, 8, 76, 0.5], [0, 12, 74, 0.5],
  [1, 0, 72, 0.5], [1, 4, 71, 0.5], [1, 8, 72, 0.5], [1, 12, 74, 0.5],
  [2, 0, 72, 0.5], [2, 4, 71, 0.5], [2, 8, 72, 0.5], [2, 12, 69, 0.5],
  [3, 0, 72, 1.0], [3, 8, 69, 0.5], [3, 12, 65, 0.5],
  [4, 0, 76, 0.5], [4, 4, 79, 0.5], [4, 8, 76, 0.5], [4, 12, 74, 0.5],
  [5, 0, 74, 0.5], [5, 4, 72, 0.5], [5, 8, 74, 0.5], [5, 12, 71, 0.5],
  [6, 0, 72, 0.5], [6, 4, 71, 0.5], [6, 8, 72, 0.5], [6, 12, 74, 0.5],
  [7, 0, 74, 1.0], [7, 8, 71, 0.5], [7, 12, 67, 0.5],
  [8, 0, 77, 0.25], [8, 2, 79, 0.25], [8, 4, 81, 0.25], [8, 6, 79, 0.25], [8, 8, 77, 0.5], [8, 12, 74, 0.5],
  [9, 0, 76, 0.5], [9, 4, 77, 0.5], [9, 8, 79, 0.5], [9, 12, 77, 0.5],
  [10, 0, 81, 0.5], [10, 4, 79, 0.5], [10, 8, 77, 0.5], [10, 12, 76, 0.5],
  [11, 0, 74, 0.5], [11, 4, 71, 0.5], [11, 8, 72, 1.5],
];
const HAT_V = [0.7, 0.4, 0.6, 0.35, 0.7, 0.45, 0.5, 0.3];

/* ---- stereo mix ---- */
const bufL = new Float64Array(N), bufR = new Float64Array(N);
const buses = {};
function put(sig, startS, gain, name, pan = 0) {
  const i = Math.round(startS * SR);
  if (i < 0 || i >= N) return;
  const j = Math.min(N, i + sig.length);
  const p = Math.max(-1, Math.min(1, pan));
  const gl = gain * Math.cos((p + 1) * Math.PI / 4);
  const gr = gain * Math.sin((p + 1) * Math.PI / 4);
  const bus = name ? (buses[name] ||= new Float64Array(N)) : null;
  for (let kk = i; kk < j; kk++) {
    const v = sig[kk - i];
    bufL[kk] += v * gl;
    bufR[kk] += v * gr;
    if (bus) bus[kk] += v * gain;
  }
}
const SHK = [0.7, 0.52, 0.65, 0.45, 0.7, 0.55, 0.58, 0.38];
for (let b = 0; b < BARS; b++) {
  const intro = b === 0; // bar0 轻起（循环缝后的呼吸）：无 kick/snare、轻 hat
  if (!intro) {
    put(kick(1.0), t8(b, 0), 1.5, "kick");
    put(kick(0.9), t8(b, 4), 1.5, "kick");
    if (b === 3 || b === 7 || b === 11) put(kick(0.7), t8(b, 6), 1.5, "kick");
    put(snare(0.75), t8(b, 2), 0.42, "snare", 0.1);
    put(snare(0.8), t8(b, 6), 0.42, "snare", 0.1);
    if (b % 2 === 1) put(snare(0.14), t8(b, 5), 0.42, "snare", 0.1);
    else put(snare(0.11), t8(b, 7), 0.42, "snare", 0.1);
    if (b === 7) { put(snare(0.28), t8(b, 6), 0.42, "snare", 0.1); put(snare(0.36), t8(b, 7), 0.42, "snare", 0.1); }
  }
  if (b === 11) {
    for (const p of [0, 2, 4, 6]) put(hat(false, 0.45), t8(b, p), 0.95, "hat", 0.15);
    put(hat(false, 0.3), t8(b, 7), 0.95, "hat", 0.15);
    for (const p of [8, 12]) put(hat(false, 0.3), t16(b, p), 0.95, "hat", 0.15);
  } else if (intro) {
    for (let p = 0; p < 8; p++) put(hat(false, HAT_V[p] * 0.6), t8(b, p), 0.95, "hat", 0.15);
  } else {
    for (let p = 0; p < 8; p++) put(hat(false, HAT_V[p]), t8(b, p), 0.95, "hat", 0.15);
    if (b === 3 || b === 7) put(hat(true, 0.55), t8(b, 7), 0.6, "hat", 0.2);
    if (b === 3 || b === 7 || b === 10) for (let p = 8; p < 16; p++) put(hat(false, 0.36 + 0.02 * (p - 8)), t16(b, p), 0.95, "hat", 0.15);
  }
  // 沙球：8 分驱动（48k 下 11k 空气带真实）
  for (let p = 0; p < 8; p++) put(shaker(intro ? SHK[p] * 0.55 : SHK[p]), t8(b, p), 1.9, "shaker", -0.25);
  if (b === 3 || b === 7 || b === 11) for (const p of [8, 10, 12, 14]) put(shaker(0.48), t16(b, p), 1.9, "shaker", -0.25);
  // 贝斯（v7 底音；intro 稍轻）
  BASS[b].forEach((m, i2) => put(bassNote(m, BEAT * 0.5, 1.0), t8(b, i2 * 2), intro ? 1.3 : 1.6, "bass"));
  // 空气 pad：双失谐 L/R 声像；末小节提前收（缝处留白）
  const pd = b === BARS - 1 ? BEAT * 4 - 1.2 : BEAT * 4;
  put(pad(PADCH[b], pd, 0.13, -0.002), t8(b, 0), 1, "pad", -0.55);
  put(pad(PADCH[b], pd, 0.13, 0.003), t8(b, 0), 1, "pad", 0.55);
  // 和声 comp
  if (b % 4 === 3) {
    put(rhodes(COMPCH[b], BEAT * 1.4, 0.42), t8(b, 4), 1, "rhodes", 0.15);
  } else {
    put(rhodes(COMPCH[b], BEAT * 0.9, 0.36), t8(b, 7), 1, "rhodes", 0.15);
    if (b === 0 || b === 4) put(rhodes(COMPCH[b], BEAT * 0.7, 0.26), t8(b, 3), 1, "rhodes", 0.15);
  }
  // 琶音：8 分 → 后段 16 分，交替 L/R（更宽）
  const arp = [12, 16, 19, 23];
  const root = PADCH[b][0] + 12;
  if (b < 8) {
    for (let p = 0; p < 8; p++) put(pluck(root + arp[p % 4], 0.5), t8(b, p), intro ? 0.14 : 0.26, "arp", p % 2 === 0 ? -0.8 : 0.8);
  } else {
    for (let p = 0; p < 16; p++) put(pluck(root + arp[p % 4], 0.45), t16(b, p), 0.23, "arp", p % 2 === 0 ? -0.8 : 0.8);
  }
  // 高位闪层：和弦顶音+2 八度、全 8 分对位、L/R 交替（补 4-14k 空灵带）
  const GLV = [1, 0.6, 0.8, 0.5, 1, 0.6, 0.7, 0.45];
  const gbase = intro ? 0.12 : (b >= 8 ? 0.26 : 0.18);
  for (let p = 0; p < 8; p++) put(glimmer(PADCH[b][2] + 24, GLV[p]), t8(b, p), gbase, "glim", p % 2 === 0 ? -0.7 : 0.7);
  if (b >= 8) for (let p = 0; p < 8; p += 2) put(glimmer(PADCH[b][2] + 36, GLV[p] * 0.5), t8(b, p), gbase, "glim", p % 4 === 0 ? 0.8 : -0.8);
  // 铃铛旋律线 + 高位八度叠音
  for (const e of LEAD) if (e[0] === b) {
    const g = intro ? 0.7 : (b >= 8 ? 0.95 : 0.9);
    put(bell(e[2], e[3] * BEAT / 2, 1), t16(b, e[1]), g, "lead");
    if (b >= 4) put(bell(e[2] + 12, e[3] * BEAT / 2, 1), t16(b, e[1]), b >= 8 ? g * 0.42 : g * 0.22, "lead");
  }
}
put(whoosh(0.5, 0.2), 0.02, 1, "fx", -0.4);
put(whoosh(0.45, 0.16), 8 * 4 * BEAT + 0.02, 1, "fx", 0.4);
put(airBed(), 0, 1, "air");

/* ---- master（48k 立体声：归一化 → shimmer(lead) → 混响 0.3 → HP30/LP17k → 软削峰 → 归一化） ---- */
const leadB = buses["lead"];
const leadWet = shimmer(leadB, 0.3);
for (let i = 0; i < N; i++) {
  const d = leadWet[i] - leadB[i];
  bufL[i] += d * 0.7; bufR[i] += d * 0.7;
}
function normBoth(a, b, k) { let p = 0; for (let i = 0; i < N; i++) p = Math.max(p, Math.abs(a[i]), Math.abs(b[i])); for (let i = 0; i < N; i++) { a[i] *= k / p; b[i] *= k / p; } }
normBoth(bufL, bufR, 0.9);
let L = reverb(bufL, 0.32), R = reverb(bufR, 0.32);
L = biquad("hp", 30, 0.7)(L); R = biquad("hp", 30, 0.7)(R);
// 空气提升：9k 宽带 resonant 叠加 ~+2-3dB（4-16k 空灵感）
function airLift(x, k) { const bp = biquad("peaking", 9000, 0.7)(x); const out = new Float64Array(x.length); for (let i = 0; i < x.length; i++) out[i] = x[i] + bp[i] * k; return out; }
L = airLift(L, 0.35); R = airLift(R, 0.35);
L = biquad("lp", 17000, 0.7)(L); R = biquad("lp", 17000, 0.7)(R);
for (let i = 0; i < N; i++) { L[i] = Math.tanh(1.15 * L[i]); R[i] = Math.tanh(1.15 * R[i]); }
normBoth(L, R, 0.85);
for (const ch of [L, R]) {
  let mean = 0;
  for (let i = 0; i < N; i++) mean += ch[i];
  mean /= N;
  for (let i = 0; i < N; i++) ch[i] -= mean;
  const fd = Math.round(0.08 * SR), fh = Math.round(0.008 * SR); // 缝尾 80ms 渐弱 + 头 8ms 渐入
  for (let i = 0; i < fd; i++) ch[N - fd + i] *= 1 - i / fd;
  for (let i = 0; i < fh; i++) ch[i] *= i / fh;
}

/* ---- write wav (stereo) + report ---- */
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), i * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), i * 4 + 2);
}
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVE", 8);
hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(OUT, Buffer.concat([hdr, pcm]));
const rms = (a, o, l) => { let s = 0; for (let i = o; i < o + l; i++) s += a[i] * a[i]; return Math.sqrt(s / l); };
const pk = (a, o, l) => { let m = 0; for (let i = o; i < o + l; i++) m = Math.max(m, Math.abs(a[i])); return m; };
let sd = 0, sm = 0;
for (let i = 0; i < N; i += 8) { const d = L[i] - R[i], m = L[i] + R[i]; sd += d * d; sm += m * m; }
console.log("wrote " + OUT + "  " + (N / SR).toFixed(3) + " s (" + BARS + " bars @ " + BPM + " BPM) stereo " + SR + "Hz");
console.log("master rms L " + rms(L, 0, N).toFixed(4) + " R " + rms(R, 0, N).toFixed(4) + "  peak L " + pk(L, 0, N).toFixed(3) + " R " + pk(R, 0, N).toFixed(3) + "  width " + (Math.sqrt(sd) / Math.sqrt(sm)).toFixed(2));
console.log("seam tail(60ms) peak L " + pk(L, N - Math.round(0.06 * SR), Math.round(0.06 * SR)).toExponential(2) + " R " + pk(R, N - Math.round(0.06 * SR), Math.round(0.06 * SR)).toExponential(2));
for (let bbar = 0; bbar < BARS; bbar++) {
  const o = Math.round(bbar * 4 * BEAT * SR), l = Math.round(4 * BEAT * SR);
  console.log("  bar " + String(bbar + 1).padStart(2) + " rms L " + rms(L, o, l).toFixed(4) + "  R " + rms(R, o, l).toFixed(4) + "  peak " + Math.max(pk(L, o, l), pk(R, o, l)).toFixed(3));
}
