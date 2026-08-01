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
 *   - cmap formats 4 (BMP) and 12 (full Unicode). No shaping, ligatures, or
 *     variable-font axes: each character maps to one glyph plus its advance
 *     width. Pair kerning is read from `GPOS` (lookup type 2, `kern`
 *     feature) when present — see `kerning()` below. The legacy `kern` table
 *     is not read: modern TrueType families (e.g. Google Fonts) ship GPOS
 *     pair kerning instead, so supporting that one format covers the common
 *     case without doubling the kerning code path.
 *
 * TrueType glyph space: font units, y-up, origin on the baseline. Descenders
 * (g, y, p, q, j…) are simply glyph contours whose y drops below 0 — callers
 * that place glyphs at `y * scale + baselineY` get correct descender droop
 * for free, with no separate "is this glyph a descender" step.
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
  /**
   * GPOS pair-kerning adjustment (font units) to apply to the advance
   * between `leftCodePoint` and the codepoint that immediately follows it.
   * Negative tightens the pair (e.g. "AV"), positive loosens it. `0` when
   * the font has no `GPOS` table, no `kern` feature, or no rule for the pair.
   */
  kerning(leftCodePoint: number, rightCodePoint: number): number;
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

  const gpos = tables.get("GPOS");
  const kernPairs = gpos ? buildKernLookup(view, gpos.offset) : null;
  const kerning = (leftCodePoint: number, rightCodePoint: number): number => {
    if (!kernPairs) return 0;
    return kernPairs(lookup(leftCodePoint), lookup(rightCodePoint));
  };

  return { unitsPerEm, ascender, descender, lineGap, glyph, kerning };
}

/**
 * Read the `GPOS` table's `kern` feature (lookup type 2, pair adjustment)
 * into a `(leftGid, rightGid) => xAdvance` function, font units. Only the
 * horizontal advance of value record 1 is read — placement/vertical-advance
 * fields and mark-to-base lookups are irrelevant to glyph-run kerning.
 * Extension positioning (lookup type 9) is unwrapped transparently. Returns
 * `null` when the table has no `kern` feature or no pair-adjustment lookup.
 */
function buildKernLookup(view: DataView, gposOffset: number): ((leftGid: number, rightGid: number) => number) | null {
  const featureListOffset = view.getUint16(gposOffset + 6);
  const lookupListOffset = view.getUint16(gposOffset + 8);
  const featureListBase = gposOffset + featureListOffset;
  const featureCount = view.getUint16(featureListBase);

  const lookupIndices = new Set<number>();
  for (let i = 0; i < featureCount; i++) {
    const rec = featureListBase + 2 + i * 6;
    if (tag(view, rec) !== "kern") continue;
    const featureBase = featureListBase + view.getUint16(rec + 4);
    const lookupIndexCount = view.getUint16(featureBase + 2);
    for (let j = 0; j < lookupIndexCount; j++) lookupIndices.add(view.getUint16(featureBase + 4 + j * 2));
  }
  if (lookupIndices.size === 0) return null;

  const lookupListBase = gposOffset + lookupListOffset;
  const lookupCount = view.getUint16(lookupListBase);
  const matchers: PairMatcher[] = [];
  for (const li of lookupIndices) {
    if (li >= lookupCount) continue;
    const lookupBase = lookupListBase + view.getUint16(lookupListBase + 2 + li * 2);
    const lookupType = view.getUint16(lookupBase);
    const subtableCount = view.getUint16(lookupBase + 4);
    for (let s = 0; s < subtableCount; s++) {
      let subBase = lookupBase + view.getUint16(lookupBase + 6 + s * 2);
      let type = lookupType;
      if (type === 9) {
        // Extension positioning: unwrap to the real subtable + lookup type.
        type = view.getUint16(subBase + 2);
        subBase = subBase + view.getUint32(subBase + 4);
      }
      if (type !== 2) continue; // only pair adjustment carries kerning
      const format = view.getUint16(subBase);
      if (format === 1) matchers.push(parsePairPosFormat1(view, subBase));
      else if (format === 2) matchers.push(parsePairPosFormat2(view, subBase));
    }
  }
  if (matchers.length === 0) return null;

  return (leftGid: number, rightGid: number): number => {
    for (const m of matchers) {
      const v = m(leftGid, rightGid);
      if (v !== null) return v;
    }
    return 0;
  };
}

/**
 * `null` = this subtable doesn't apply to the pair — either its Coverage
 * doesn't include `leftGid`, or (format 1 only) `leftGid` is covered but has
 * no explicit rule for `rightGid` — so the caller should try the next
 * subtable in the lookup.
 */
type PairMatcher = (leftGid: number, rightGid: number) => number | null;

/** Number of ValueRecord fields present in a GPOS `valueFormat` bitmask (each field is 2 bytes). */
function valueRecordSize(format: number): number {
  let bits = 0;
  for (let f = format; f; f &= f - 1) bits++;
  return bits * 2;
}

/** Read just the XAdvance field (format bit `0x0004`) of a ValueRecord at `pos`. */
function readXAdvance(view: DataView, pos: number, format: number): number {
  if (!(format & 0x0004)) return 0;
  let offset = 0;
  if (format & 0x0001) offset += 2; // XPlacement
  if (format & 0x0002) offset += 2; // YPlacement
  return view.getInt16(pos + offset);
}

/** Coverage table (format 1: glyph list, format 2: glyph ranges) → glyph's coverage index, or -1. */
function parseCoverage(view: DataView, offset: number): (gid: number) => number {
  const format = view.getUint16(offset);
  if (format === 1) {
    const count = view.getUint16(offset + 2);
    const index = new Map<number, number>();
    for (let i = 0; i < count; i++) index.set(view.getUint16(offset + 4 + i * 2), i);
    return (gid) => index.get(gid) ?? -1;
  }
  if (format === 2) {
    const count = view.getUint16(offset + 2);
    const ranges: { start: number; end: number; startIndex: number }[] = [];
    for (let i = 0; i < count; i++) {
      const rec = offset + 4 + i * 6;
      ranges.push({ start: view.getUint16(rec), end: view.getUint16(rec + 2), startIndex: view.getUint16(rec + 4) });
    }
    return (gid) => {
      for (const r of ranges) if (gid >= r.start && gid <= r.end) return r.startIndex + (gid - r.start);
      return -1;
    };
  }
  return () => -1;
}

/** ClassDef table (format 1: contiguous range, format 2: ranges) → glyph's class, default 0. */
function parseClassDef(view: DataView, offset: number): (gid: number) => number {
  const format = view.getUint16(offset);
  if (format === 1) {
    const startGlyph = view.getUint16(offset + 2);
    const count = view.getUint16(offset + 4);
    const classes: number[] = [];
    for (let i = 0; i < count; i++) classes.push(view.getUint16(offset + 6 + i * 2));
    return (gid) => {
      const i = gid - startGlyph;
      return i >= 0 && i < classes.length ? classes[i] : 0;
    };
  }
  if (format === 2) {
    const count = view.getUint16(offset + 2);
    const ranges: { start: number; end: number; class: number }[] = [];
    for (let i = 0; i < count; i++) {
      const rec = offset + 4 + i * 6;
      ranges.push({ start: view.getUint16(rec), end: view.getUint16(rec + 2), class: view.getUint16(rec + 4) });
    }
    return (gid) => {
      for (const r of ranges) if (gid >= r.start && gid <= r.end) return r.class;
      return 0;
    };
  }
  return () => 0;
}

/** PairPosFormat1: explicit (firstGlyph → [secondGlyph → ValueRecord]) pair list. */
function parsePairPosFormat1(view: DataView, base: number): PairMatcher {
  const coverage = parseCoverage(view, base + view.getUint16(base + 2));
  const valueFormat1 = view.getUint16(base + 4);
  const valueFormat2 = view.getUint16(base + 6);
  const pairSetCount = view.getUint16(base + 8);
  const pairSetOffsets: number[] = [];
  for (let i = 0; i < pairSetCount; i++) pairSetOffsets.push(view.getUint16(base + 10 + i * 2));
  const recordSize = 2 + valueRecordSize(valueFormat1) + valueRecordSize(valueFormat2);

  return (leftGid, rightGid) => {
    const idx = coverage(leftGid);
    if (idx < 0 || idx >= pairSetOffsets.length) return null;
    const setBase = base + pairSetOffsets[idx];
    const count = view.getUint16(setBase);
    let p = setBase + 2;
    for (let i = 0; i < count; i++) {
      if (view.getUint16(p) === rightGid) return readXAdvance(view, p + 2, valueFormat1);
      p += recordSize;
    }
    // Covered, but this exact pair isn't listed — this format-1 exception
    // table doesn't apply to it; fall through to the next subtable (e.g. a
    // format-2 class-based lookup covering the general case).
    return null;
  };
}

/** PairPosFormat2: class-based (class(firstGlyph), class(secondGlyph)) → ValueRecord grid. */
function parsePairPosFormat2(view: DataView, base: number): PairMatcher {
  const coverage = parseCoverage(view, base + view.getUint16(base + 2));
  const valueFormat1 = view.getUint16(base + 4);
  const valueFormat2 = view.getUint16(base + 6);
  const classOf1 = parseClassDef(view, base + view.getUint16(base + 8));
  const classOf2 = parseClassDef(view, base + view.getUint16(base + 10));
  const class1Count = view.getUint16(base + 12);
  const class2Count = view.getUint16(base + 14);
  const class2RecordSize = valueRecordSize(valueFormat1) + valueRecordSize(valueFormat2);
  const recordsBase = base + 16;

  return (leftGid, rightGid) => {
    if (coverage(leftGid) < 0) return null;
    const c1 = classOf1(leftGid);
    const c2 = classOf2(rightGid);
    if (c1 >= class1Count || c2 >= class2Count) return 0;
    return readXAdvance(view, recordsBase + c1 * class2Count * class2RecordSize + c2 * class2RecordSize, valueFormat1);
  };
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
