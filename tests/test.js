// Synthetic focus-stack benchmark for engine.js (run: node test.js)
'use strict';
const E = require('../src/engine.js');
const W = 640, H = 480, N = 8, REF = Math.floor((N - 1) / 2);

// deterministic RNG
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// Scene: multi-scale texture + hard edges, 3 colour channels
function scene() {
  const ch = [0, 1, 2].map(() => new Float32Array(W * H));
  const noise = [2, 6, 20].map(s => { const a = new Float32Array(W * H); for (let i = 0; i < a.length; i++) a[i] = rnd(); return E.gaussBlur(a, W, H, s * 0.4); });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const stripes = ((Math.floor(x / 12) + Math.floor(y / 12)) & 1) ? 0.15 : -0.15;
    const ring = Math.abs(Math.hypot(x - 420, y - 200) - 80) < 3 ? 0.3 : 0;
    const base = 0.5 + 1.6 * (noise[0][i] - 0.5) + 2.0 * (noise[1][i] - 0.5) + stripes * 0.6 + ring;
    ch[0][i] = Math.min(1, Math.max(0, base * 1.0 + 0.6 * (noise[2][i] - 0.5)));
    ch[1][i] = Math.min(1, Math.max(0, base * 0.85));
    ch[2][i] = Math.min(1, Math.max(0, base * 0.7 - 0.6 * (noise[2][i] - 0.5)));
  }
  return ch;
}
// Depth in [0,1]: tilted plane + a dome (a "bead")
const depth = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const r = Math.hypot(x - 200, y - 300);
  depth[y * W + x] = Math.min(1, Math.max(0, 0.9 * x / W + 0.05 + (r < 90 ? 0.45 * Math.sqrt(1 - (r / 90) ** 2) : 0)));
}

const sharp = scene();
const SIG = [0, 0.5, 1, 1.5, 2, 3, 4, 5.5, 7];
const blurredBank = sharp.map(c => SIG.map(s => E.gaussBlur(c, W, H, s)));
function defocus(c, f) { // spatially varying blur, sigma = 9 * |depth - f|
  const out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) {
    const s = Math.min(SIG[SIG.length - 1], 9 * Math.abs(depth[i] - f));
    let k = 0; while (k < SIG.length - 2 && SIG[k + 1] < s) k++;
    const t = (s - SIG[k]) / (SIG[k + 1] - SIG[k]);
    out[i] = blurredBank[c][k][i] * (1 - t) + blurredBank[c][k + 1][i] * t;
  }
  return out;
}
// ground-truth motion (focus breathing + shake): ref px -> frame px
function trueM(i) {
  const d = i - REF, s = 1 + 0.006 * d, th = 0.0015 * d, tx = 1.7 * d + 0.6 * Math.sin(i), ty = -1.1 * d;
  const cx = (W - 1) / 2, cy = (H - 1) / 2, a = s * Math.cos(th), b = -s * Math.sin(th);
  return [a, b, tx + cx - a * cx - b * cy, -b, a, ty + cy + b * cx - a * cy, 0, 0, 1];
}
const frames = [];
for (let i = 0; i < N; i++) {
  const f = i / (N - 1), Mi = E.inv3(trueM(i));
  frames.push([0, 1, 2].map(c => E.warp(defocus(c, f), W, H, Mi)));
}

function psnr(a, b, rect) {
  let se = 0, n = 0;
  for (let c = 0; c < 3; c++) for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const i = y * W + x, d = a[c][i] - b[c][i]; se += d * d; n++;
  }
  return 10 * Math.log10(1 / (se / n));
}

const t0 = Date.now();
const grays = frames.map(f => E.luminance(f[0], f[1], f[2]));
const { Ms } = E.alignStack(grays, W, H, 'similarity', REF);
const tAlign = Date.now() - t0;
let maxErr = 0;
for (let i = 0; i < N; i++) {
  const T = trueM(i);
  for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) {
    const ex = Ms[i][0] * x + Ms[i][1] * y + Ms[i][2] - (T[0] * x + T[1] * y + T[2]);
    const ey = Ms[i][3] * x + Ms[i][4] * y + Ms[i][5] - (T[3] * x + T[4] * y + T[5]);
    maxErr = Math.max(maxErr, Math.hypot(ex, ey));
  }
}
const rect = E.commonRect(Ms, W, H);
const inner = { x: rect.x + 4, y: rect.y + 4, w: rect.w - 8, h: rect.h - 8 };
console.log(`alignment: worst corner error ${maxErr.toFixed(3)} px over ${N} frames (${tAlign} ms); common rect ${rect.w}x${rect.h}`);

const aligned = frames.map((f, i) => f.map(c => E.warp(c, W, H, Ms[i])));
for (let i = 0; i < N; i++) console.log(`  frame ${i}: PSNR vs truth ${psnr(aligned[i], sharp, inner).toFixed(2)} dB`);
const avg = [0, 1, 2].map(c => { const o = new Float32Array(W * H); for (const f of aligned) for (let i = 0; i < o.length; i++) o[i] += f[c][i] / N; return o; });
console.log(`  plain average: ${psnr(avg, sharp, inner).toFixed(2)} dB`);

for (const method of ['depthmap', 'pyramid']) {
  const t1 = Date.now();
  const F = new E.Fuser(W, H, N, { method, smooth: 3 });
  aligned.forEach((f, i) => F.add(f, i));
  const out = F.result();
  // depth accuracy: sharpest index should be round(depth*(N-1)) where texture exists
  let ok = 0, cnt = 0;
  for (let y = inner.y; y < inner.y + inner.h; y++) for (let x = inner.x; x < inner.x + inner.w; x++) {
    const i = y * W + x; cnt++; if (Math.abs(F.depth[i] - depth[i] * (N - 1)) <= 1) ok++;
  }
  console.log(`${method}: PSNR ${psnr(out, sharp, inner).toFixed(2)} dB, depth within ±1 slice ${(100 * ok / cnt).toFixed(1)}% (${Date.now() - t1} ms)`);
}
// without alignment, to show why it matters
const F2 = new E.Fuser(W, H, N, { method: 'pyramid', smooth: 3 });
frames.forEach((f, i) => F2.add(f, i));
console.log(`pyramid WITHOUT alignment: PSNR ${psnr(F2.result(), sharp, inner).toFixed(2)} dB`);
// oracle: per pixel take the aligned frame whose focus is truly nearest (upper bound for hard selection)
const orc = [0, 1, 2].map(c => { const o = new Float32Array(W * H); for (let i = 0; i < o.length; i++) o[i] = aligned[Math.round(depth[i] * (N - 1))][c][i]; return o; });
console.log(`oracle (true depth) selection: ${psnr(orc, sharp, inner).toFixed(2)} dB`);
