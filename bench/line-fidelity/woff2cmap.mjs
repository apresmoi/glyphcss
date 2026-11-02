// Minimal WOFF2 → cmap reader: which code points a face really carries.
// cmap is never transformed in WOFF2, so it can be read straight out of the
// brotli stream once the table directory gives its offset.
import fs from "node:fs";
import zlib from "node:zlib";

const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

function base128(buf, o) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[o.p++];
    v = (v << 7) | (b & 0x7f);
    if (!(b & 0x80)) return v >>> 0;
  }
  throw new Error("bad UIntBase128");
}

export function woff2Tables(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error(`${file}: not WOFF2`);
  const numTables = buf.readUInt16BE(12);
  const totalCompressed = buf.readUInt32BE(20);
  const o = { p: 48 };
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[o.p++];
    let tag;
    if ((flags & 63) === 63) { tag = buf.toString("latin1", o.p, o.p + 4); o.p += 4; } else tag = KNOWN_TAGS[flags & 63];
    const version = (flags >> 6) & 3;
    const origLength = base128(buf, o);
    const transformed = (tag === "glyf" || tag === "loca") ? version === 0 : version !== 0;
    const length = transformed ? base128(buf, o) : origLength;
    tables.push({ tag, length, transformed });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(o.p, o.p + totalCompressed));
  let off = 0;
  const out = {};
  for (const t of tables) { out[t.tag] = { ...t, data: data.subarray(off, off + t.length) }; off += t.length; }
  return out;
}

/** Set of code points mapped by the face's best Unicode cmap subtable. */
export function woff2CodePoints(file) {
  const cmap = woff2Tables(file).cmap.data;
  const dv = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
  const n = dv.getUint16(2);
  const subs = [];
  for (let i = 0; i < n; i++) subs.push({ pid: dv.getUint16(4 + i * 8), eid: dv.getUint16(6 + i * 8), off: dv.getUint32(8 + i * 8) });
  const set = new Set();
  for (const s of subs) {
    const fmt = dv.getUint16(s.off);
    if (fmt === 12) {
      const groups = dv.getUint32(s.off + 12);
      for (let g = 0; g < groups; g++) {
        const b = s.off + 16 + g * 12;
        const start = dv.getUint32(b), end = dv.getUint32(b + 4), gid = dv.getUint32(b + 8);
        for (let c = start; c <= end; c++) if (gid + c - start) set.add(c);
      }
    } else if (fmt === 4) {
      const segX2 = dv.getUint16(s.off + 6);
      const ends = s.off + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let i = 0; i < segX2 / 2; i++) {
        const end = dv.getUint16(ends + i * 2), start = dv.getUint16(starts + i * 2);
        const delta = dv.getInt16(deltas + i * 2), ro = dv.getUint16(ranges + i * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let gid;
          if (ro === 0) gid = (c + delta) & 0xffff;
          else {
            const gi = ranges + i * 2 + ro + (c - start) * 2;
            gid = dv.getUint16(gi);
            if (gid) gid = (gid + delta) & 0xffff;
          }
          if (gid) set.add(c);
        }
      }
    }
  }
  return set;
}
