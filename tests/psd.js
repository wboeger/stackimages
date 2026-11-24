// PSD writer check (run: node tests/psd.js [out.psd]). Verifies PackBits round-trips and writes a 3-layer file
// that tests/psd_check.py reads back with psd-tools when it is installed.
'use strict';
const PSD = require('../src/psd.js');
const fs = require('fs');
function unpack(buf, n) { const out = []; let i = 0; while (out.length < n) { const b = buf[i++]; if (b < 128) { for (let k = 0; k <= b; k++) out.push(buf[i++]); } else if (b > 128) { const v = buf[i++]; for (let k = 0; k < 257 - b; k++) out.push(v); } } return { out, used: i }; }
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
// PackBits round trip on adversarial rows
let fails = 0;
for (let t = 0; t < 2000; t++) {
  const n = 1 + Math.floor(rnd() * 700), src = new Uint8Array(n);
  const mode = t % 4;
  for (let i = 0; i < n; i++) src[i] = mode === 0 ? rnd() * 256 : mode === 1 ? (rnd() < 0.9 ? 0 : rnd() * 256) : mode === 2 ? (i >> 3) & 1 : (rnd() < 0.5 ? src[i - 1] || 0 : rnd() * 3);
  const out = new Uint8Array(n + Math.ceil(n / 128) + 2), m = PSD.packRow(src, 0, 1, n, out);
  const u = unpack(out, n);
  if (u.used !== m || u.out.some((v, i) => v !== src[i]) || m > n + Math.ceil(n / 128)) fails++;
}
console.log(`PackBits round trip: ${2000 - fails}/2000 rows exact`);
// layered file: gradient background, white paper, sparse drawing with soft alpha
const w = 301, h = 203, N = w * h;
const bgL = new Uint8ClampedArray(N * 4), ink = new Uint8ClampedArray(N * 4), paper = new Uint8ClampedArray(N * 4).fill(255), comp = new Uint8ClampedArray(N * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * 4;
  bgL.set([x * 255 / w, y * 255 / h, (x ^ y) & 255, 255], i);
  const d = Math.abs(Math.hypot(x - 150, y - 100) - 60);
  if (d < 3) ink.set([20, 30, 200, Math.round(255 * Math.min(1, 3 - d))], i);
  comp.set([bgL[i], bgL[i + 1], bgL[i + 2], 255], i);
}
const t0 = Date.now();
const chunks = PSD.encodePSD(w, h, [{ name: 'Paper', rgba: paper, hidden: true }, { name: 'Stacked result', rgba: bgL, opacity: 0.6 }, { name: 'Drawing · µm', rgba: ink }], comp);
const bytes = Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.length)));
console.log(`PSD ${w}×${h}, 3 layers: ${bytes.length} bytes (raw would be ${N * 4 * 3 + N * 3}) in ${Date.now() - t0} ms`);
const outPath = process.argv[2] || require('os').tmpdir() + '/focus_stacker_test.psd';
fs.writeFileSync(outPath, bytes);
fs.writeFileSync(outPath + '.json', JSON.stringify({ w, h }));
fs.writeFileSync(outPath + '.raw', Buffer.concat([bgL, ink].map(a => Buffer.from(a.buffer))));
console.log('wrote ' + outPath);
if (fails) process.exit(1);
