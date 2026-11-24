/* Minimal layered Photoshop (PSD, version 1) writer: 8-bit RGB, PackBits (RLE) compressed.
 * Enough for Adobe Fresco, Photoshop (desktop and iPad), Affinity, Procreate, Krita and GIMP
 * to open the stack and the drawing as separate layers. No DOM; runs under Node for the tests.
 *
 * encodePSD(width, height, layers, composite) -> array of Uint8Array chunks (pass to new Blob()).
 *   layers:    bottom first; each { name, rgba (Uint8ClampedArray w*h*4, straight alpha),
 *              opacity (0..1, default 1), hidden (bool) }
 *   composite: flattened image as RGBA (alpha ignored), what a viewer without layer support shows. */
'use strict';
const PSD = (() => {
  // PackBits one row of `n` bytes taken from src with a stride (to read one channel out of RGBA).
  function packRow(src, off, stride, n, out) {
    let o = 0, i = 0;
    const at = k => src[off + k * stride];
    while (i < n) {
      let r = 1; // run length of equal bytes starting at i
      while (i + r < n && r < 128 && at(i + r) === at(i)) r++;
      if (r >= 2) { out[o++] = 257 - r; out[o++] = at(i); i += r; continue; }
      // literal run: stop before the next run of 2+ equal bytes (a run of 2 inside literals is not worth breaking for, 3+ is)
      let L = 1;
      while (i + L < n && L < 128) {
        if (i + L + 2 < n && at(i + L) === at(i + L + 1) && at(i + L) === at(i + L + 2)) break;
        L++;
      }
      out[o++] = L - 1;
      for (let k = 0; k < L; k++) out[o++] = at(i + k);
      i += L;
    }
    return o;
  }
  // One channel (stride-4 view of an RGBA buffer) as RLE: { counts: u16 per row, parts, total bytes }
  function rleChannel(rgba, c, w, h) {
    const tmp = new Uint8Array(w + Math.ceil(w / 128) + 2), counts = new Uint16Array(h), parts = [];
    let total = 0;
    for (let y = 0; y < h; y++) {
      const n = packRow(rgba, y * w * 4 + c, 4, w, tmp);
      counts[y] = n; parts.push(tmp.slice(0, n)); total += n;
    }
    return { counts, parts, total };
  }
  class Writer {
    constructor() { this.chunks = []; this.buf = new DataView(new ArrayBuffer(1 << 16)); this.n = 0; this.size = 0; }
    flush() { if (this.n) { this.chunks.push(new Uint8Array(this.buf.buffer.slice(0, this.n))); this.size += this.n; this.n = 0; } }
    room(k) { if (this.n + k > this.buf.byteLength) this.flush(); }
    u8(v) { this.room(1); this.buf.setUint8(this.n, v); this.n += 1; }
    u16(v) { this.room(2); this.buf.setUint16(this.n, v); this.n += 2; }
    i16(v) { this.room(2); this.buf.setInt16(this.n, v); this.n += 2; }
    u32(v) { this.room(4); this.buf.setUint32(this.n, v); this.n += 4; }
    i32(v) { this.room(4); this.buf.setInt32(this.n, v); this.n += 4; }
    ascii(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i) & 0x7f); }
    bytes(a) { this.flush(); this.chunks.push(a); this.size += a.length; }
    get pos() { return this.size + this.n; }
    done() { this.flush(); return this.chunks; }
  }
  // ASCII Pascal-string name (Photoshop pads it to a multiple of 4) plus the Unicode 'luni' block for the real name.
  function nameBlocks(name) {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').slice(0, 255);
    const pas = 1 + ascii.length, padPas = (4 - pas % 4) % 4;
    const raw = 4 + 2 * name.length, padUni = (4 - raw % 4) % 4; // 'luni' data padded to 4
    return { ascii, padPas, uniLen: raw + padUni, padUni, bytes: pas + padPas + 12 + raw + padUni };
  }

  function encodePSD(w, h, layers, composite) {
    if (!(w > 0 && h > 0 && w <= 30000 && h <= 30000)) throw new Error('PSD size must be 1–30000 px per side');
    const W = new Writer();
    // header
    W.ascii('8BPS'); W.u16(1); for (let i = 0; i < 6; i++) W.u8(0);
    W.u16(3); W.u32(h); W.u32(w); W.u16(8); W.u16(3); // 3 channels, 8 bit, RGB
    W.u32(0); // colour mode data
    W.u32(0); // image resources
    // channel data first, so record lengths are known
    const enc = layers.map(L => {
      const ch = [-1, 0, 1, 2].map(id => ({ id, r: rleChannel(L.rgba, id < 0 ? 3 : id, w, h) }));
      return { L, ch, nm: nameBlocks(L.name || 'Layer') };
    });
    let recBytes = 0, dataBytes = 0;
    for (const e of enc) {
      recBytes += 16 + 2 + e.ch.length * 6 + 12 + 4 + (8 + e.nm.bytes);
      for (const c of e.ch) dataBytes += 2 + 2 * h + c.r.total;
    }
    let liLen = 2 + recBytes + dataBytes; const liPad = liLen % 2; liLen += liPad;
    W.u32(4 + liLen + 4); // layer and mask information section
    W.u32(liLen);
    W.i16(enc.length);
    for (const e of enc) {
      W.i32(0); W.i32(0); W.i32(h); W.i32(w); // top, left, bottom, right
      W.u16(e.ch.length);
      for (const c of e.ch) { W.i16(c.id); W.u32(2 + 2 * h + c.r.total); }
      W.ascii('8BIM'); W.ascii('norm');
      W.u8(Math.round(255 * Math.min(1, Math.max(0, e.L.opacity == null ? 1 : e.L.opacity))));
      W.u8(0); W.u8(e.L.hidden ? 2 : 0); W.u8(0); // clipping, flags (bit 1 = hidden), filler
      W.u32(4 + 4 + e.nm.bytes); // extra data
      W.u32(0); W.u32(0); // no layer mask, no blending ranges
      W.u8(e.nm.ascii.length); W.ascii(e.nm.ascii); for (let i = 0; i < e.nm.padPas; i++) W.u8(0);
      W.ascii('8BIM'); W.ascii('luni'); W.u32(e.nm.uniLen);
      const nmU = e.L.name || 'Layer'; W.u32(nmU.length); for (let i = 0; i < nmU.length; i++) W.u16(nmU.charCodeAt(i));
      for (let i = 0; i < e.nm.padUni; i++) W.u8(0);
    }
    for (const e of enc) for (const c of e.ch) {
      W.u16(1); for (let y = 0; y < h; y++) W.u16(c.r.counts[y]);
      for (const p of c.r.parts) W.bytes(p);
    }
    if (liPad) W.u8(0);
    W.u32(0); // global layer mask info
    // merged composite, RLE
    const cc = [0, 1, 2].map(c => rleChannel(composite, c, w, h));
    W.u16(1);
    for (const r of cc) for (let y = 0; y < h; y++) W.u16(r.counts[y]);
    for (const r of cc) for (const p of r.parts) W.bytes(p);
    return W.done();
  }
  return { encodePSD, packRow };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PSD;
