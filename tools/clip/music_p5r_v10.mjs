// music_p5r_v10.mjs — P5R 轻快空灵循环 · v10（v1 原样重建：16 小节 A 小调、反解 8 分琶音旋律、奇偶交替；48k 干净合成修毛刺）
// 细节全部来自 v1 音频反解：groove（kick 1/&2/3、snare 2&4、沙锤反拍）、旋律（8 分琶音）、和声（Am/Cadd9）、奇偶小节交替
// 48kHz 干净合成替代 v1 的 22kHz 毛刺；高频保持 v9 的收柔设置
// 108 BPM（v1 的速度感）· 48kHz 真立体声（v1/v7 都是 22k → 高频损失，本版补齐 11-18k 空气带）
// 保留 v7：walking bass 底音、和弦走向、Schroeder 混响、点状延迟 shimmer、无缝循环
// 增强：更密的铃铛旋律线（v1 的驱动感）、八度叠音、段落动态起伏（bar0 轻起 → 全鼓 → 加花）
//   更亮的铃铛泛音（5.4f/8.9f 长尾）、pad 双失谐声像、混响尾提亮、鼓组空气带（48k 下真实）
import fs from "node:fs";
let seed = 880801;
const SR = 48000, BPM = 108.0, BEAT = 60 / BPM, BARS = 16, SWING = 0.55;
const LOOP = BARS * 4 * BEAT;
const N = Math.round(LOOP * SR);
const OUT = process.argv[2] || "./music-loop-v10.wav";

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
  const hp = biquad("hp", 10500, 0.8)(nz);
  const tau = open_ ? 0.1 : 0.012, out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = hp[i] * Math.exp(-i / (SR * tau)) * v;
  return out;
}
function shaker(v = 1) {
  const n = Math.round(0.05 * SR), nz = new Float64Array(n);
  for (let i = 0; i < n; i++) nz[i] = rnd() * 2 - 1;
  const hp = biquad("hp", 8500, 0.9)(nz);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = hp[i] * Math.exp(-i / (SR * 0.013)) * v;
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
  const P = [[1, 0, 0.7], [2, 1.4, 0.3], [2.76, 1.2, 0.16], [5.4, 3.5, 0.09], [8.9, 5.0, 0.05]];
  for (let i = 0; i < n; i++) {
    const s = i / SR;
    let x = 0;
    for (const [r, td, a] of P) x += a * Math.sin(ph[i] * r) * (td > 0 ? Math.exp(-s / td) : 1);
    out[i] = x * (1 - Math.exp(-s / 0.003)) * Math.exp(-s / 0.7) * v;
  }
  return biquad("lp", 10000, 0.7)(out);
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
  const lp = biquad("lp", 9500, 0.7)(ap);
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

/* ---- arrangement（16 小节 A 小调，结构照 v1：4 小节 Cadd9 引子 + 8 小节 Am 主体 + 4 小节变奏） ---- */
const PADCH = [
  [55, 60, 64, 67], [53, 57, 60, 64], [57, 60, 64, 67], [55, 59, 62, 67],   // C/G  Fmaj7/A  Am7  G
  [57, 60, 64, 67], [57, 60, 64, 67], [53, 57, 60, 64], [52, 56, 59, 64],   // Am7  Am7  Fmaj7/A  E
  [57, 60, 64, 67], [57, 60, 62, 64], [53, 57, 60, 64], [55, 59, 62, 67],   // Am7  Am9  Fmaj7/A  G
  [57, 60, 64, 67], [57, 60, 64, 67], [55, 60, 64, 67], [57, 60, 64, 67],   // Am7  Am7  C/G  Am7
];
const COMPCH = PADCH.map((c) => [c[1], c[2], c[3], c[0] + 12]);
const BASS = {
  0: [48, 52, 55, 48], 1: [41, 48], 2: [45, 48, 52, 45], 3: [43, 50],
  4: [45, 48, 52, 45], 5: [45, 52], 6: [41, 45, 48, 41], 7: [40, 47],
  8: [45, 48, 52, 45], 9: [45, 52], 10: [41, 45, 48, 41], 11: [43, 50],
  12: [45, 48, 52, 45], 13: [45, 52], 14: [48, 52, 55, 48], 15: [45, 50],
};
/* 铃铛旋律线 = v1 音频反解的 8 分琶音原样（A 小调、G# 经过音）；引子 4 小节稀疏 */
const LEAD8 = [
  [60, 64], [67, 69], [64, 67], [69],
  [55, 57, 55, 55, 64, 57, 67, 64], [55, 55, 64, 57, 67, 64, 55, 55],
  [64, 57, 67, 64, 55, 55, 55, 55], [67, 64, 55, 55, 55, 55, 60, 57],
  [55, 55, 55, 55, 60, 57, 67, 72], [55, 55, 60, 57, 67, 72, 55, 55],
  [60, 57, 67, 72, 55, 55, 55, 55], [67, 72, 55, 55, 55, 55, 60, 57],
  [55, 55, 55, 55, 60, 57, 67, 72], [55, 55, 60, 57, 67, 72, 55, 55],
  [60, 57, 67, 72, 55, 55, 55, 55], [67, 72, 55, 55, 55, 55, 60, 57],
];

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
for (let b = 0; b < BARS; b++) {
  const intro = b < 4; // 引子 4 小节：无 kick/snare、轻 hat（v1 结构）
  if (!intro) {
    // v1 groove（音频反解）：kick 1 / &2 / 3，snare 2&4 轻刷
    put(kick(1.0), t8(b, 0), 1.4, "kick");
    put(kick(0.5), t8(b, 3), 1.4, "kick");
    put(kick(0.7), t8(b, 4), 1.4, "kick");
    put(snare(0.6), t8(b, 2), 0.38, "snare", 0.1);
    put(snare(0.65), t8(b, 6), 0.38, "snare", 0.1);
    if (b === 7 || b === 11) { put(kick(0.5), t8(b, 6), 1.2, "kick"); put(snare(0.2), t8(b, 7), 0.38, "snare", 0.1); }
    if (b === 15) { put(kick(0.6), t8(b, 6), 1.2, "kick"); put(snare(0.3), t8(b, 7), 0.35, "snare", 0.1); }
  }
  // 轻 hat 8 分 tick（只做轮廓，不抢戏）
  const HAT8 = [0.3, 0.16, 0.24, 0.14, 0.3, 0.18, 0.22, 0.15];
  for (let p = 0; p < 8; p++) put(hat(false, HAT8[p]), t8(b, p), intro ? 0.5 : 0.65, "hat", 0.15);
  // 沙锤：全 8 分、反拍重音（v1 groove 实测）
  const SHK2 = [0.5, 0.9, 0.52, 0.72, 0.48, 0.85, 0.45, 0.9];
  for (let p = 0; p < 8; p++) put(shaker(intro ? SHK2[p] * 0.55 : SHK2[p]), t8(b, p), 1.5, "shaker", -0.25);
  // 贝斯：奇小节全 8 分 walking、偶小节 2 音留白（v1 奇偶交替实测）
  BASS[b].forEach((m, i2) => {
    const pos = BASS[b].length === 4 ? i2 * 2 : (i2 === 0 ? 0 : 6);
    put(bassNote(m, BEAT * 0.5, 1.0), t8(b, pos), intro ? 1.2 : 1.5, "bass");
  });
  // 空气 pad：双失谐 L/R 声像；末小节提前收（缝处留白）
  const pd = b === BARS - 1 ? BEAT * 4 - 1.2 : BEAT * 4;
  put(pad(PADCH[b], pd, intro ? 0.11 : 0.13, -0.002), t8(b, 0), 1, "pad", -0.55);
  put(pad(PADCH[b], pd, intro ? 0.11 : 0.13, 0.003), t8(b, 0), 1, "pad", 0.55);
  // 和声 comp：奇小节和声持续、落 &3（v1 奇偶交替实测）
  if (b % 2 === 1) put(rhodes(COMPCH[b], BEAT * 1.4, intro ? 0.2 : 0.34), t8(b, 4), 1, "rhodes", 0.15);
  else if (b < 8) put(rhodes(COMPCH[b], BEAT * 0.9, intro ? 0.14 : 0.24), t8(b, 7), 1, "rhodes", 0.15);
  // 8 分琶音：和弦音 +12 连续流动（v1 的持续纹理），末 4 小节 16 分
  const ct = PADCH[b].map((m) => m + 12);
  const ap = [0, 1, 2, 3, 2, 1, 0, 1];
  if (b < 12) for (let p = 0; p < 8; p++) put(pluck(ct[ap[p]], 0.5), t8(b, p), intro ? 0.07 : 0.13, "arp", p % 2 === 0 ? -0.8 : 0.8);
  else for (let p = 0; p < 16; p++) put(pluck(ct[ap[p % 8]], 0.45), t16(b, p), 0.11, "arp", p % 2 === 0 ? -0.8 : 0.8);
  // 高位闪层：和弦顶音+2 八度、反拍、L/R 交替（轻点空气带，不刺耳）
  const gbase = intro ? 0.06 : (b >= 12 ? 0.15 : 0.1);
  for (let p = 0; p < 8; p += 2) put(glimmer(PADCH[b][2] + 24, p % 4 === 0 ? 0.8 : 1), t8(b, p + 1), gbase, "glim", p % 4 === 0 ? -0.7 : 0.7);
  // 铃铛旋律线（v1 反解原样）+ 末段八度叠音
  LEAD8[b].forEach((m, i2) => {
    const beats = intro && i2 === 0 ? 1.5 : 0.5;
    const g = intro ? 0.6 : (b >= 12 ? 0.82 : 0.75);
    put(bell(m, beats * BEAT / 2, 1), t8(b, i2), g, "lead");
    if (b >= 12) put(bell(m + 12, beats * BEAT / 2, 1), t8(b, i2), g * 0.28, "lead");
  });
}
put(whoosh(0.5, 0.2), 0.02, 1, "fx", -0.4);
put(whoosh(0.45, 0.16), 4 * 4 * BEAT + 0.02, 1, "fx", 0.4);   // 引子 → 主体
put(whoosh(0.4, 0.14), 12 * 4 * BEAT + 0.02, 1, "fx", -0.3);  // 主体 → 变奏
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
let L = reverb(bufL, 0.3), R = reverb(bufR, 0.3);
L = biquad("hp", 30, 0.7)(L); R = biquad("hp", 30, 0.7)(R);
L = biquad("lp", 15000, 0.7)(L); R = biquad("lp", 15000, 0.7)(R);
for (let i = 0; i < N; i++) { L[i] = Math.tanh(1.05 * L[i]); R[i] = Math.tanh(1.05 * R[i]); }
normBoth(L, R, 0.8);
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
