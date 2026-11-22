/* Focus-stacking engine: pure typed-array image math, no DOM.
 * Images are planar Float32Array channels in [0,1], row-major, size w*h.
 * Runs inside a Web Worker in the app, and under Node for tests. */
'use strict';

// ---------- basic filters ----------
function gaussKernel(sigma) {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}

// Separable convolution with clamped borders. dst may be a new array.
function convSep(src, w, h, k, dst, tmp) {
  const r = (k.length - 1) >> 1;
  tmp = tmp || new Float32Array(w * h);
  dst = dst || new Float32Array(w * h);
  // horizontal
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      if (x >= r && x < w - r) {
        const b = o + x - r;
        for (let i = 0; i < k.length; i++) s += k[i] * src[b + i];
      } else {
        for (let i = -r; i <= r; i++) {
          let xx = x + i; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
          s += k[i + r] * src[o + xx];
        }
      }
      tmp[o + x] = s;
    }
  }
  // vertical
  for (let y = 0; y < h; y++) {
    const o = y * w;
    if (y >= r && y < h - r) {
      for (let x = 0; x < w; x++) dst[o + x] = 0;
      for (let i = 0; i < k.length; i++) {
        const ki = k[i], ro = (y + i - r) * w;
        for (let x = 0; x < w; x++) dst[o + x] += ki * tmp[ro + x];
      }
    } else {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let i = -r; i <= r; i++) {
          let yy = y + i; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
          s += k[i + r] * tmp[yy * w + x];
        }
        dst[o + x] = s;
      }
    }
  }
  return dst;
}

function gaussBlur(src, w, h, sigma, dst, tmp) {
  if (sigma <= 0) { dst = dst || new Float32Array(src.length); dst.set(src); return dst; }
  return convSep(src, w, h, gaussKernel(sigma), dst, tmp);
}

const BINOM = new Float32Array([1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]);

// Burt–Adelson REDUCE: binomial 5-tap blur evaluated only at the kept (even) samples.
function pyrDown(src, w, h) {
  const w2 = (w + 1) >> 1, h2 = (h + 1) >> 1;
  const tmp = new Float32Array(w2 * h);
  for (let y = 0; y < h; y++) {
    const o = y * w, t = y * w2;
    for (let x = 0; x < w2; x++) {
      const c = 2 * x;
      const a = c - 2 < 0 ? 0 : c - 2, b = c - 1 < 0 ? 0 : c - 1, d = c + 1 > w - 1 ? w - 1 : c + 1, f = c + 2 > w - 1 ? w - 1 : c + 2;
      tmp[t + x] = 0.0625 * (src[o + a] + src[o + f]) + 0.25 * (src[o + b] + src[o + d]) + 0.375 * src[o + c];
    }
  }
  const out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    const c = 2 * y;
    const ra = (c - 2 < 0 ? 0 : c - 2) * w2, rb = (c - 1 < 0 ? 0 : c - 1) * w2, rc = c * w2,
      rd = (c + 1 > h - 1 ? h - 1 : c + 1) * w2, rf = (c + 2 > h - 1 ? h - 1 : c + 2) * w2, oo = y * w2;
    for (let x = 0; x < w2; x++)
      out[oo + x] = 0.0625 * (tmp[ra + x] + tmp[rf + x]) + 0.25 * (tmp[rb + x] + tmp[rd + x]) + 0.375 * tmp[rc + x];
  }
  return { data: out, w: w2, h: h2 };
}

// Box filter (radius r) via running sums, clamped borders; two passes ≈ Gaussian with σ² = 2r(r+1)/3.
function boxBlur(src, w, h, r, dst) {
  const tmp = new Float32Array(w * h); dst = dst || new Float32Array(w * h);
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0;
    for (let i = -r; i <= r; i++) s += src[o + (i < 0 ? 0 : i > w - 1 ? w - 1 : i)];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s * norm;
      const add = x + r + 1, sub = x - r;
      s += src[o + (add > w - 1 ? w - 1 : add)] - src[o + (sub < 0 ? 0 : sub)];
    }
  }
  const col = new Float32Array(w);
  for (let x = 0; x < w; x++) col[x] = 0;
  for (let i = -r; i <= r; i++) { const ro = (i < 0 ? 0 : i > h - 1 ? h - 1 : i) * w; for (let x = 0; x < w; x++) col[x] += tmp[ro + x]; }
  for (let y = 0; y < h; y++) {
    const o = y * w, ra = (y + r + 1 > h - 1 ? h - 1 : y + r + 1) * w, rs = (y - r < 0 ? 0 : y - r) * w;
    for (let x = 0; x < w; x++) { dst[o + x] = col[x] * norm; col[x] += tmp[ra + x] - tmp[rs + x]; }
  }
  return dst;
}
function smoothFast(src, w, h, sigma) {
  const r = Math.max(1, Math.round((Math.sqrt(1 + 6 * sigma * sigma) - 1) / 2));
  return boxBlur(boxBlur(src, w, h, r), w, h, r);
}

// Burt–Adelson EXPAND to size (w,h) from coarse (cw,ch).
function pyrUp(c, cw, ch, w, h) {
  const tmp = new Float32Array(cw * h);
  // vertical expand: rows
  for (let y = 0; y < h; y++) {
    const i = y >> 1;
    const i0 = Math.max(i - 1, 0), i1 = Math.min(i, ch - 1), i2 = Math.min(i + 1, ch - 1);
    const o = y * cw;
    if (y & 1) {
      for (let x = 0; x < cw; x++) tmp[o + x] = 0.5 * (c[i1 * cw + x] + c[i2 * cw + x]);
    } else {
      for (let x = 0; x < cw; x++) tmp[o + x] = 0.125 * c[i0 * cw + x] + 0.75 * c[i1 * cw + x] + 0.125 * c[i2 * cw + x];
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ro = y * cw, oo = y * w;
    for (let x = 0; x < w; x++) {
      const i = x >> 1;
      const i1 = Math.min(i, cw - 1), i2 = Math.min(i + 1, cw - 1);
      if (x & 1) out[oo + x] = 0.5 * (tmp[ro + i1] + tmp[ro + i2]);
      else { const i0 = Math.max(i - 1, 0); out[oo + x] = 0.125 * tmp[ro + i0] + 0.75 * tmp[ro + i1] + 0.125 * tmp[ro + i2]; }
    }
  }
  return out;
}

function luminance(r, g, b) {
  const n = r.length, y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
  return y;
}

// Focus measure: local energy of the Laplacian-of-Gaussian.
// E = G_s * (∇² (G_1 * Y))²   (s = smoothing radius in px)
function focusEnergy(Y, w, h, smooth) {
  const g = convSep(Y, w, h, BINOM); // σ ≈ 1 px
  const lap = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0, yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1, i = y * w + x;
      const v = g[y * w + xm] + g[y * w + xp] + g[ym * w + x] + g[yp * w + x] - 4 * g[i];
      lap[i] = v * v;
    }
  }
  return smoothFast(lap, w, h, smooth);
}

// ---------- geometry ----------
// 3x3 matrices as length-9 arrays, row-major. Maps reference px -> frame px.
const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
          B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
          C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

// Bilinear warp: out(x) = src(M·x), clamped borders. Also returns validity mask if asked.
function warp(src, w, h, M, ow, oh, mask) {
  ow = ow || w; oh = oh || h;
  const out = new Float32Array(ow * oh);
  const [a, b, c, d, e, f] = M;
  for (let y = 0; y < oh; y++) {
    let sx = b * y + c, sy = e * y + f;
    const o = y * ow;
    for (let x = 0; x < ow; x++, sx += a, sy += d) {
      let X = sx, Y = sy, inside = 1;
      if (X < 0) { X = 0; inside = 0; } else if (X > w - 1) { X = w - 1; inside = 0; }
      if (Y < 0) { Y = 0; inside = 0; } else if (Y > h - 1) { Y = h - 1; inside = 0; }
      const x0 = X | 0, y0 = Y | 0;
      const x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
      const fx = X - x0, fy = Y - y0;
      const p = y0 * w, q = y1 * w;
      out[o + x] = (src[p + x0] * (1 - fx) + src[p + x1] * fx) * (1 - fy) + (src[q + x0] * (1 - fx) + src[q + x1] * fx) * fy;
      if (mask) mask[o + x] = inside;
    }
  }
  return out;
}

function solve(A, bv) { // Gaussian elimination with partial pivoting, n<=6
  const n = bv.length, M = A.map((r, i) => [...r, bv[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// params -> centered linear map. model: 'translation' (tx,ty) | 'similarity' (a,b,tx,ty)
function paramsToCentered(p, model) {
  if (model === 'translation') return [1, 0, p[0], 0, 1, p[1]];
  return [1 + p[0], -p[1], p[2], p[1], 1 + p[0], p[3]];
}
// centered map (about image centre cx,cy) -> pixel-coordinate 3x3
function centeredToPixel(L, cx, cy) {
  const [a, b, tx, d, e, ty] = L;
  return [a, b, tx + cx - a * cx - b * cy, d, e, ty + cy - d * cx - e * cy, 0, 0, 1];
}

/* Estimate M (template px -> moving px) such that I(M x) ≈ T(x).
 * Coarse-to-fine Gauss–Newton on zero-mean, unit-variance intensities
 * (an ECC-style criterion: invariant to brightness/contrast changes). */
function estimateMotion(T, I, w, h, model, init) {
  const np = model === 'translation' ? 2 : 4;
  const pyr = [{ T, I, w, h }];
  while (pyr.length < 6) {
    const l = pyr[pyr.length - 1];
    if (Math.min(l.w, l.h) < 80) break;
    const t = pyrDown(l.T, l.w, l.h), i = pyrDown(l.I, l.w, l.h);
    pyr.push({ T: t.data, I: i.data, w: t.w, h: t.h });
  }
  let p = init ? init.slice() : new Array(np).fill(0);
  // scale translation to coarsest level
  const tIdx = model === 'translation' ? [0, 1] : [2, 3];
  const L = pyr.length - 1;
  for (const k of tIdx) p[k] /= 2 ** L;
  let lastErr = Infinity;
  for (let lev = L; lev >= 0; lev--) {
    const { T: Tl, I: Il, w: wl, h: hl } = pyr[lev];
    const cx = (wl - 1) / 2, cy = (hl - 1) / 2;
    // template stats & gradients are not needed (forward additive); normalise T once
    let mT = 0; for (let i = 0; i < Tl.length; i++) mT += Tl[i]; mT /= Tl.length;
    const iters = lev === 0 ? 15 : 30;
    const mask = new Uint8Array(wl * hl);
    for (let it = 0; it < iters; it++) {
      const M = centeredToPixel(paramsToCentered(p, model), cx, cy);
      const Iw = warp(Il, wl, hl, M, wl, hl, mask);
      // stats over valid overlap (with a 2px margin)
      let n = 0, sT = 0, sI = 0, sTT = 0, sII = 0;
      for (let y = 2; y < hl - 2; y++) for (let x = 2; x < wl - 2; x++) {
        const i = y * wl + x; if (!mask[i]) continue;
        const t = Tl[i], v = Iw[i]; n++; sT += t; sI += v; sTT += t * t; sII += v * v;
      }
      if (n < 100) break;
      const muT = sT / n, muI = sI / n;
      const sdT = Math.sqrt(Math.max(sTT / n - muT * muT, 1e-12)), sdI = Math.sqrt(Math.max(sII / n - muI * muI, 1e-12));
      const H = Array.from({ length: np }, () => new Array(np).fill(0));
      const g = new Array(np).fill(0);
      const J = new Array(np);
      let err = 0;
      for (let y = 2; y < hl - 2; y++) {
        const yc = y - cy;
        for (let x = 2; x < wl - 2; x++) {
          const i = y * wl + x; if (!mask[i]) continue;
          const gx = (Iw[i + 1] - Iw[i - 1]) * 0.5 / sdI, gy = (Iw[i + wl] - Iw[i - wl]) * 0.5 / sdI;
          const xc = x - cx;
          const e = (Tl[i] - muT) / sdT - (Iw[i] - muI) / sdI;
          err += e * e;
          if (np === 2) { J[0] = gx; J[1] = gy; }
          else { J[0] = gx * xc + gy * yc; J[1] = -gx * yc + gy * xc; J[2] = gx; J[3] = gy; }
          for (let r = 0; r < np; r++) { g[r] += J[r] * e; const Jr = J[r]; for (let c = r; c < np; c++) H[r][c] += Jr * J[c]; }
        }
      }
      for (let r = 0; r < np; r++) for (let c = 0; c < r; c++) H[r][c] = H[c][r];
      lastErr = err / n;
      const dp = solve(H, g);
      if (!dp) break;
      for (let k = 0; k < np; k++) p[k] += dp[k];
      const dt = Math.hypot(dp[tIdx[0]], dp[tIdx[1]]);
      const ds = np === 4 ? Math.hypot(dp[0], dp[1]) * Math.max(wl, hl) / 2 : 0;
      if (dt + ds < 0.01) break;
    }
    if (lev > 0) for (const k of tIdx) p[k] *= 2;
  }
  return { params: p, M: centeredToPixel(paramsToCentered(p, model), (w - 1) / 2, (h - 1) / 2), err: lastErr };
}

/* Align a whole stack from small grayscale proxies.
 * grays: array of Float32Array (w*h each). Neighbour-to-neighbour chaining
 * outward from the reference frame, since adjacent focus slices look most alike.
 * Returns matrices mapping reference px -> frame px, in proxy coordinates. */
function alignStack(grays, w, h, model, ref, onProgress) {
  const n = grays.length;
  const Ms = new Array(n); Ms[ref] = I3();
  const errs = new Array(n).fill(0);
  if (model === 'none') { for (let i = 0; i < n; i++) Ms[i] = I3(); return { Ms, errs }; }
  const sm = grays.map(g => gaussBlur(g, w, h, 1.0));
  let done = 0;
  for (const dir of [1, -1]) {
    for (let i = ref + dir; i >= 0 && i < n; i += dir) {
      const prev = i - dir;
      const r = estimateMotion(sm[prev], sm[i], w, h, model);
      errs[i] = r.err;
      Ms[i] = mul3(r.M, Ms[prev]); // ref -> prev -> i
      done++; if (onProgress) onProgress(done, n - 1);
    }
  }
  return { Ms, errs };
}

// Scale a proxy-coordinate matrix to full-resolution pixel coordinates (factor s = full/proxy).
function scaleMatrix(M, s) {
  const S = [s, 0, 0, 0, s, 0, 0, 0, 1], Si = [1 / s, 0, 0, 0, 1 / s, 0, 0, 0, 1];
  return mul3(S, mul3(M, Si));
}

// Largest axis-aligned rectangle of reference coords that every frame covers (small-rotation approximation).
function commonRect(Ms, w, h) {
  let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
  for (const M of Ms) {
    const Mi = inv3(M);
    const P = (x, y) => [Mi[0] * x + Mi[1] * y + Mi[2], Mi[3] * x + Mi[4] * y + Mi[5]];
    const tl = P(0, 0), tr = P(w - 1, 0), bl = P(0, h - 1), br = P(w - 1, h - 1);
    x0 = Math.max(x0, tl[0], bl[0]); x1 = Math.min(x1, tr[0], br[0]);
    y0 = Math.max(y0, tl[1], tr[1]); y1 = Math.min(y1, bl[1], br[1]);
  }
  x0 = Math.ceil(x0); y0 = Math.ceil(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
  if (x1 - x0 < 16 || y1 - y0 < 16) return { x: 0, y: 0, w, h };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* ---------- fusion ----------
 * Streaming: frames are fed one at a time, so memory does not grow with N.
 * Two methods:
 *  'pyramid' — Laplacian-pyramid fusion: at each band keep the coefficient
 *              of the frame with the highest local band energy; the coarsest
 *              Gaussian level is averaged. Few halos, best detail.
 *  'depthmap' — per pixel, take the colour of the frame with the highest
 *               smoothed LoG energy (hard selection). Faithful colours, can
 *               show seams at depth edges.
 * Both also record the depth (index of sharpest frame) and its energy. */
class Fuser {
  constructor(w, h, n, opts) {
    this.w = w; this.h = h; this.n = n; this.count = 0;
    this.method = opts.method || 'pyramid';
    this.smooth = opts.smooth || 3;
    this.bestE = new Float32Array(w * h).fill(-1);
    this.secondE = new Float32Array(w * h);
    this.depth = new Uint16Array(w * h);
    if (this.method === 'depthmap') {
      this.out = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
    } else {
      let lw = w, lh = h; this.levels = [];
      while (this.levels.length < 12 && Math.min(lw, lh) > 16) {
        this.levels.push({ w: lw, h: lh, best: new Float32Array(lw * lh).fill(-1), L: [new Float32Array(lw * lh), new Float32Array(lw * lh), new Float32Array(lw * lh)] });
        lw = (lw + 1) >> 1; lh = (lh + 1) >> 1;
      }
      this.top = { w: lw, h: lh, sum: [new Float32Array(lw * lh), new Float32Array(lw * lh), new Float32Array(lw * lh)] };
    }
  }
  add(rgb, index) {
    const { w, h } = this, n = w * h;
    const Y = luminance(rgb[0], rgb[1], rgb[2]);
    const E = focusEnergy(Y, w, h, this.smooth);
    const sel = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const e = E[i];
      if (e > this.bestE[i]) { this.secondE[i] = Math.max(this.bestE[i], 0); this.bestE[i] = e; this.depth[i] = index; sel[i] = 1; }
      else if (e > this.secondE[i]) this.secondE[i] = e;
    }
    if (this.method === 'depthmap') {
      for (let c = 0; c < 3; c++) { const o = this.out[c], s = rgb[c]; for (let i = 0; i < n; i++) if (sel[i]) o[i] = s[i]; }
    } else {
      let G = [rgb[0], rgb[1], rgb[2], Y];
      for (let l = 0; l < this.levels.length; l++) {
        const lev = this.levels[l], lw = lev.w, lh = lev.h, m = lw * lh;
        const Gn = G.map(ch => pyrDown(ch, lw, lh));
        const nw = Gn[0].w, nh = Gn[0].h;
        const Lc = G.map((ch, c) => { const up = pyrUp(Gn[c].data, nw, nh, lw, lh); for (let i = 0; i < m; i++) up[i] = ch[i] - up[i]; return up; });
        // band energy from luminance band, smoothed over ~5x5 neighbourhood
        const e2 = new Float32Array(m); const LY = Lc[3];
        for (let i = 0; i < m; i++) e2[i] = LY[i] * LY[i];
        const eb = boxBlur(e2, lw, lh, 2);
        const best = lev.best;
        for (let i = 0; i < m; i++) if (eb[i] > best[i]) {
          best[i] = eb[i]; lev.L[0][i] = Lc[0][i]; lev.L[1][i] = Lc[1][i]; lev.L[2][i] = Lc[2][i];
        }
        G = Gn.map(o => o.data);
      }
      for (let c = 0; c < 3; c++) { const s = this.top.sum[c]; const g = G[c]; for (let i = 0; i < s.length; i++) s[i] += g[i]; }
    }
    this.count++;
  }
  result() {
    if (this.method === 'depthmap') return this.out;
    const out = [];
    for (let c = 0; c < 3; c++) {
      let G = this.top.sum[c].map(v => v / this.count), gw = this.top.w, gh = this.top.h;
      for (let l = this.levels.length - 1; l >= 0; l--) {
        const lev = this.levels[l];
        const up = pyrUp(G, gw, gh, lev.w, lev.h), Lb = lev.L[c];
        for (let i = 0; i < up.length; i++) up[i] += Lb[i];
        G = up; gw = lev.w; gh = lev.h;
      }
      for (let i = 0; i < G.length; i++) G[i] = G[i] < 0 ? 0 : G[i] > 1 ? 1 : G[i];
      out.push(G);
    }
    return out;
  }
}

const Engine = { boxBlur, smoothFast, gaussBlur, gaussKernel, pyrDown, pyrUp, luminance, focusEnergy, warp, mul3, inv3, estimateMotion, alignStack, scaleMatrix, commonRect, Fuser, I3 };
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
