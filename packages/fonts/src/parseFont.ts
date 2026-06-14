/**
 * Minimal TrueType (`glyf`) font reader — bytes → glyph outlines + metrics.
 *
 * A font file is an sfnt container: a table directory pointing at named binary
 * tables. We read only what's needed to lay out and outline text:
 *
 *   head → unitsPerEm + loca format   maxp → glyph count
 *   hhea/hmtx → advance widths        cmap → codepoint → glyph index
 *   loca → glyph offsets into glyf    glyf → the outline vectors
 *
 * Scope is deliberately narrow — this is a small, dependency-free reader for
 * the common case, not a full font library:
 *   - TrueType outlines only (`glyf`). CFF/OpenType (".otf", magic "OTTO") is
 *     a different outline format (Type2 charstrings) and is rejected with a
 *     clear error. Google Fonts ship TrueType, so this covers most fonts.
 *   - Uncompressed sfnt only — woff/woff2 wrappers are not unpacked.
 *   - cmap formats 4 (BMP) and 12 (full Unicode). No shaping, kerning,
 *     ligatures, or variable-font axes: each character maps to one glyph plus
 *     its advance width.
 *
 * TrueType glyph space: font units, y-up, origin on the baseline.
 */
import type { Vec2 } from "@glyphcss/core";

export interface FontGlyph {
  /** Closed contours as flattened polylines, font units, y-up. */
  contours: Vec2[][];
  /** Advance width in font units. */
  advanceWidth: number;
}

export interface ParsedFont {
  /** Font design units per em (the scale denominator). */
  unitsPerEm: number;
  /** Typographic ascender in font units. */
  ascender: number;
  /** Typographic descender in font units (usually negative). */
  descender: number;
  /** Recommended extra line spacing in font units. */
  lineGap: number;
  /** Outline + advance for a Unicode codepoint. Empty contours for blanks. */
  glyph(codePoint: number, curveSteps?: number): FontGlyph;
}

const TAG_TRUETYPE = 0x00010000;
const TAG_TRUE = 0x74727565; // 'true'
const TAG_OTTO = 0x4f54544f; // 'OTTO' (CFF)

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

export function parseFont(data: ArrayBuffer | Uint8Array, defaultCurveSteps = 8): ParsedFont {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const sfnt = view.getUint32(0);
  if (sfnt === TAG_OTTO) {
    throw new Error("parseFont: CFF/OpenType (.otf) outlines are not supported — use a TrueType (.ttf) font");
  }
  if (sfnt !== TAG_TRUETYPE && sfnt !== TAG_TRUE) {
    throw new Error(`parseFont: not a TrueType font (sfnt 0x${sfnt.toString(16)})`);
  }

  const numTables = view.getUint16(4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables.set(tag(view, rec), { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) });
  }

  const need = (name: string): number => {
    const t = tables.get(name);
    if (!t) throw new Error(`parseFont: missing required '${name}' table`);
    return t.offset;
  };

  const head = need("head");
  const unitsPerEm = view.getUint16(head + 18);
  const indexToLocFormat = view.getInt16(head + 50);

  const numGlyphs = view.getUint16(need("maxp") + 4);

  const hhea = need("hhea");
  const ascender = view.getInt16(hhea + 4);
  const descender = view.getInt16(hhea + 6);
  const lineGap = view.getInt16(hhea + 8);
  const numberOfHMetrics = view.getUint16(hhea + 34);
  const hmtx = need("hmtx");

  const advanceWidth = (glyphIndex: number): number => {
    const i = glyphIndex < numberOfHMetrics ? glyphIndex : numberOfHMetrics - 1;
    return view.getUint16(hmtx + i * 4);
  };

  // loca: glyph offsets into glyf. Short format stores halved u16 offsets.
  const loca = need("loca");
  const glyfBase = need("glyf");
  const glyphRange = (gi: number): [number, number] => {
    if (indexToLocFormat === 0) {
      return [glyfBase + view.getUint16(loca + gi * 2) * 2, glyfBase + view.getUint16(loca + (gi + 1) * 2) * 2];
    }
    return [glyfBase + view.getUint32(loca + gi * 4), glyfBase + view.getUint32(loca + (gi + 1) * 4)];
  };

  const lookup = buildCmap(view, need("cmap"));

  // Decode one glyph into raw contours (points + on-curve flags), resolving
  // composite glyphs recursively with their 2×2 + translate transforms.
  type RawContour = { pts: Vec2[]; on: boolean[] };
  const rawGlyph = (gi: number, depth = 0): RawContour[] => {
    if (gi < 0 || gi >= numGlyphs || depth > 8) return [];
    const [start, end] = glyphRange(gi);
    if (start >= end) return []; // empty glyph (e.g. space)

    let p = start;
    const numberOfContours = view.getInt16(p);
    p += 2 + 8; // skip numberOfContours field + xMin/yMin/xMax/yMax

    if (numberOfContours >= 0) {
      const endPts: number[] = [];
      for (let c = 0; c < numberOfContours; c++) {
        endPts.push(view.getUint16(p));
        p += 2;
      }
      const numPoints = endPts.length ? endPts[endPts.length - 1] + 1 : 0;
      const instrLen = view.getUint16(p);
      p += 2 + instrLen; // skip hinting instructions

      const flags = new Uint8Array(numPoints);
      for (let i = 0; i < numPoints;) {
        const f = view.getUint8(p++);
        flags[i++] = f;
        if (f & 0x08) {
          let repeat = view.getUint8(p++);
          while (repeat-- > 0 && i < numPoints) flags[i++] = f;
        }
      }

      const readCoords = (shortBit: number, sameBit: number): number[] => {
        const out = new Array<number>(numPoints);
        let v = 0;
        for (let i = 0; i < numPoints; i++) {
          const f = flags[i];
          if (f & shortBit) {
            const d = view.getUint8(p++);
            v += f & sameBit ? d : -d;
          } else if (!(f & sameBit)) {
            v += view.getInt16(p);
            p += 2;
          }
          out[i] = v;
        }
        return out;
      };
      const xs = readCoords(0x02, 0x10);
      const ys = readCoords(0x04, 0x20);

      const contours: RawContour[] = [];
      let s = 0;
      for (const e of endPts) {
        const pts: Vec2[] = [];
        const on: boolean[] = [];
        for (let i = s; i <= e; i++) {
          pts.push([xs[i], ys[i]]);
          on.push((flags[i] & 0x01) !== 0);
        }
        if (pts.length) contours.push({ pts, on });
        s = e + 1;
      }
      return contours;
    }

    // Composite glyph: assemble from component glyphs.
    const contours: RawContour[] = [];
    let more = true;
    while (more) {
      const flags = view.getUint16(p);
      const compGi = view.getUint16(p + 2);
      p += 4;
      let dx = 0;
      let dy = 0;
      if (flags & 0x0001) {
        // ARG_1_AND_2_ARE_WORDS
        dx = view.getInt16(p);
        dy = view.getInt16(p + 2);
        p += 4;
      } else {
        dx = view.getInt8(p);
        dy = view.getInt8(p + 1);
        p += 2;
      }
      const f2 = (off: number) => view.getInt16(off) / 16384;
      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      if (flags & 0x0008) {
        a = d = f2(p);
        p += 2;
      } else if (flags & 0x0040) {
        a = f2(p);
        d = f2(p + 2);
        p += 4;
      } else if (flags & 0x0080) {
        a = f2(p);
        b = f2(p + 2);
        c = f2(p + 4);
        d = f2(p + 6);
        p += 8;
      }
      // Only ARGS_ARE_XY_VALUES placement is handled; point-matching is rare.
      const useXY = (flags & 0x0002) !== 0;
      for (const ct of rawGlyph(compGi, depth + 1)) {
        contours.push({
          on: ct.on,
          pts: ct.pts.map(([px, py]): Vec2 => [
            a * px + c * py + (useXY ? dx : 0),
            b * px + d * py + (useXY ? dy : 0),
          ]),
        });
      }
      more = (flags & 0x0020) !== 0; // MORE_COMPONENTS
    }
    return contours;
  };

  const glyph = (codePoint: number, curveSteps = defaultCurveSteps): FontGlyph => {
    const gi = lookup(codePoint);
    const steps = Math.max(1, Math.round(curveSteps));
    const contours = rawGlyph(gi)
      .map((c) => flattenContour(c.pts, c.on, steps))
      .filter((c) => c.length >= 2);
    return { contours, advanceWidth: advanceWidth(gi) };
  };

  return { unitsPerEm, ascender, descender, lineGap, glyph };
}

/** Build a codepoint → glyph-index lookup from the best available cmap subtable. */
function buildCmap(view: DataView, cmap: number): (cp: number) => number {
  const numSub = view.getUint16(cmap + 2);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < numSub; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = view.getUint16(rec);
    const encoding = view.getUint16(rec + 2);
    const offset = view.getUint32(rec + 4);
    const format = view.getUint16(cmap + offset);
    // Prefer full-Unicode (12) over BMP (4); prefer Unicode/Windows platforms.
    let score = 0;
    if (format === 12) score += 4;
    else if (format === 4) score += 2;
    else continue;
    if (platform === 3 && (encoding === 1 || encoding === 10)) score += 1;
    if (platform === 0) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = cmap + offset;
    }
  }
  if (best < 0) throw new Error("parseFont: no supported cmap subtable (need format 4 or 12)");

  const format = view.getUint16(best);
  if (format === 12) return cmapFormat12(view, best);
  return cmapFormat4(view, best);
}

function cmapFormat4(view: DataView, sub: number): (cp: number) => number {
  const segX2 = view.getUint16(sub + 6);
  const segCount = segX2 / 2;
  const endCodes = sub + 14;
  const startCodes = endCodes + segX2 + 2;
  const idDeltas = startCodes + segX2;
  const idRangeOffsets = idDeltas + segX2;
  return (cp: number): number => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < segCount; i++) {
      if (view.getUint16(endCodes + i * 2) < cp) continue;
      if (view.getUint16(startCodes + i * 2) > cp) return 0;
      const delta = view.getInt16(idDeltas + i * 2);
      const rangeOffset = view.getUint16(idRangeOffsets + i * 2);
      if (rangeOffset === 0) return (cp + delta) & 0xffff;
      const start = view.getUint16(startCodes + i * 2);
      const addr = idRangeOffsets + i * 2 + rangeOffset + (cp - start) * 2;
      const gid = view.getUint16(addr);
      return gid === 0 ? 0 : (gid + delta) & 0xffff;
    }
    return 0;
  };
}

function cmapFormat12(view: DataView, sub: number): (cp: number) => number {
  const nGroups = view.getUint32(sub + 12);
  const groups = sub + 16;
  return (cp: number): number => {
    for (let i = 0; i < nGroups; i++) {
      const g = groups + i * 12;
      const start = view.getUint32(g);
      const endCode = view.getUint32(g + 4);
      if (cp < start) return 0;
      if (cp <= endCode) return view.getUint32(g + 8) + (cp - start);
    }
    return 0;
  };
}

/**
 * Flatten a TrueType quadratic contour into a polyline. Off-curve points are
 * quadratic control points; two consecutive off-curve points imply an on-curve
 * midpoint between them, so we expand those first, then walk on→(quad)→on.
 */
function flattenContour(pts: Vec2[], on: boolean[], steps: number): Vec2[] {
  const n = pts.length;
  if (n < 2) return pts.slice();

  const ep: Vec2[] = [];
  const eon: boolean[] = [];
  for (let i = 0; i < n; i++) {
    ep.push(pts[i]);
    eon.push(on[i]);
    const j = (i + 1) % n;
    if (!on[i] && !on[j]) {
      ep.push([(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2]);
      eon.push(true);
    }
  }

  let s = eon.indexOf(true);
  if (s < 0) {
    // All points off-curve: synthesize an on-curve start at a midpoint.
    const m = ep.length;
    ep.unshift([(ep[m - 1][0] + ep[0][0]) / 2, (ep[m - 1][1] + ep[0][1]) / 2]);
    eon.unshift(true);
    s = 0;
  }

  const m = ep.length;
  const out: Vec2[] = [ep[s]];
  let cur = ep[s];
  let i = 1;
  while (i <= m) {
    const idx = (s + i) % m;
    if (eon[idx]) {
      out.push(ep[idx]);
      cur = ep[idx];
      i += 1;
    } else {
      const ctrl = ep[idx];
      const end = ep[(s + i + 1) % m];
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const mt = 1 - t;
        out.push([
          mt * mt * cur[0] + 2 * mt * t * ctrl[0] + t * t * end[0],
          mt * mt * cur[1] + 2 * mt * t * ctrl[1] + t * t * end[1],
        ]);
      }
      cur = end;
      i += 2;
    }
  }

  // Drop the closing point that lands back on the start.
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) out.pop();
  }
  return out;
}
