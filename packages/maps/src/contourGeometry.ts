/**
 * Contour lines as GEOMETRY — marching squares over an elevation grid,
 * producing lon/lat segments that each carry the elevation they were cut at.
 *
 * **Why geometry and not a per-cell scan.** The per-cell contour
 * (`stroke.ts`'s {@link stampGlyphMapContour}, still the primitive for a
 * caller holding a screen-space scalar field) asks "what elevation is under
 * this output cell?" and inks where the answer crosses a level. Answering
 * that question needs `unproject`, and `unproject` inverts at ELEVATION ZERO
 * — a projection's `z` axis is one-way relief, never re-derived from world
 * space (`GlyphMapProjection.unproject`'s own contract). So under a tilt the
 * cell the reader is looking at is attributed the lon/lat of the SEA-LEVEL
 * point under the view ray rather than of the terrain point actually drawn
 * there, and the line lands where sea level would be: the mirror image of the
 * parallax the stroke drape closed for `line` layers (`781486f`), measured on
 * the same fixture at 16 rows per 10 m of ground at `/maps`' 24x
 * exaggeration, 2,000 rows over 400 m.
 *
 * Marching squares removes the question instead of correcting the answer. A
 * level's isoline is cut in the field's OWN (lon, lat) domain, so every vertex
 * it produces is at a KNOWN height — the level's own — and is projected
 * through `projection.project(lon, lat, level)` exactly as the terrain vertex
 * beside it is. There is no datum left to be wrong about, at any tilt, and the
 * line wraps the relief in three dimensions rather than lying flat under it.
 *
 * **Sampled at the grid's own vertices, never at a derived cell centre.** The
 * input is the same VERTEX-centered grid `glyphMapPolygons` builds the relief
 * from (a {@link GlyphMapGeoTile}'s `(cols+1) x (rows+1)` elevation array), so
 * a contour annotates the surface the terrain actually draws and adjacent
 * tiles — which SHARE their edge vertex row/column — cut identical crossings
 * on both sides of a boundary. That identity is what makes the mosaic
 * seamless by construction rather than by a tolerance; see
 * `widget.contourTileBoundary.test.ts` for the octagon that appeared when the
 * field was read through a cell-centered derivation instead.
 *
 * **Output is a canonically ORDERED segment list, not a chained polyline.** A
 * marching-squares segment's own two endpoints already give the exact local
 * tangent, which is all `stampGlyphMapPolyline` needs (it takes the tangent
 * from each segment's endpoints and has no start/end special case), so
 * chaining would buy nothing but topology bookkeeping. The canonical sort is
 * load-bearing though: the same terrain served as one tile and as sixty-four
 * yields the same segment SET in a different order, and a contested output
 * cell is won by whoever stamps last — so ordering the set by
 * `(level, lon, lat)` is what makes two tilings of one terrain render
 * identically rather than merely similarly.
 */
import type { GlyphMapBounds } from "./types";

/**
 * A rectangular lon/lat grid of scalar samples taken at its own VERTEX
 * positions — `cols`/`rows` count QUADS, so the sample array is
 * `(cols + 1) * (rows + 1)`, row-major, row 0 = `bounds.north`. Exactly a
 * {@link GlyphMapGeoTile}'s elevation grid; a cell-centered
 * {@link GlyphMapField} is expressed as one by taking its cell CENTRES as the
 * vertices (which insets the bounds by half a cell — the field has no data
 * outside its own sample points, and manufacturing some by clamping is what
 * put a step at every tile boundary).
 */
export interface GlyphMapContourSampleGrid {
  readonly bounds: GlyphMapBounds;
  readonly cols: number;
  readonly rows: number;
  /** Row-major, row 0 = north, length `(cols + 1) * (rows + 1)`. Non-finite marks a sample the source has no value for; a quad touching one is skipped whole. */
  readonly values: Float32Array | Float64Array;
}

/** One isoline segment in lon/lat, cut at `level` — the elevation both its endpoints stand at. */
export interface GlyphMapContourSegment {
  readonly level: number;
  readonly a: readonly [lon: number, lat: number];
  readonly b: readonly [lon: number, lat: number];
}

/**
 * Marching-squares edge pairs per corner mask. Corners are indexed
 * `0 = NW, 1 = NE, 2 = SE, 3 = SW`; a bit is set when that corner's value is
 * at or above the level. Edges are indexed by the corner they START at going
 * clockwise — `0 = NW→NE` (top), `1 = NE→SE` (right), `2 = SW→SE` (bottom),
 * `3 = NW→SW` (left).
 *
 * The two SADDLES (5 and 10) are absent here and resolved against the quad's
 * own centre value below: they are the only masks where the mask alone does
 * not determine which pair of edges joins.
 */
const MARCHING_SQUARES_EDGES: readonly (readonly (readonly [number, number])[])[] = [
  [], // 0  ····
  [[3, 0]], // 1  NW
  [[0, 1]], // 2  NE
  [[3, 1]], // 3  NW NE
  [[1, 2]], // 4  SE
  [], // 5  NW SE — saddle
  [[0, 2]], // 6  NE SE
  [[3, 2]], // 7  NW NE SE
  [[2, 3]], // 8  SW
  [[2, 0]], // 9  NW SW
  [], // 10 NE SW — saddle
  [[2, 1]], // 11 NW NE SW
  [[1, 3]], // 12 SE SW
  [[1, 0]], // 13 NW SE SW
  [[0, 3]], // 14 NE SE SW
  [], // 15 ████
];

/**
 * Both saddle resolutions, named by which DIAGONAL pair of corners the two
 * segments separate from each other. Picked by the quad's own centre value:
 * whichever pair of opposite corners the centre agrees with is the connected
 * one, so the isoline encircles the other two individually.
 */
const SADDLE_SEPARATING_NE_SW: readonly (readonly [number, number])[] = [[0, 1], [2, 3]];
const SADDLE_SEPARATING_NW_SE: readonly (readonly [number, number])[] = [[3, 0], [1, 2]];

/**
 * Isoline segments for `levels` over one sample grid, in the grid's own
 * lon/lat domain.
 *
 * `levels` must be sorted ascending — the per-quad scan uses the quad's own
 * min/max to skip every level that cannot cross it, which is what keeps a
 * 180x90-quad tile against twenty levels cheap, and it relies on that order
 * to stop early.
 *
 * A quad with any non-finite corner is skipped whole rather than
 * interpolated across: a `noData` sample is an absence, and inventing a
 * crossing through it draws a line the source never claimed.
 */
export function glyphMapMarchContourGrid(
  grid: GlyphMapContourSampleGrid,
  levels: readonly number[],
  out: GlyphMapContourSegment[] = [],
): GlyphMapContourSegment[] {
  const { cols, rows, values, bounds } = grid;
  if (cols < 1 || rows < 1 || levels.length === 0) return out;
  const { west, east, south, north } = bounds;
  const lonSpan = east - west;
  const latSpan = north - south;
  const stride = cols + 1;
  const lonAt = (col: number): number => west + (lonSpan * col) / cols;
  const latAt = (row: number): number => north - (latSpan * row) / rows;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * stride + col;
      const nw = values[i];
      const ne = values[i + 1];
      const sw = values[i + stride];
      const se = values[i + stride + 1];
      if (!Number.isFinite(nw) || !Number.isFinite(ne) || !Number.isFinite(sw) || !Number.isFinite(se)) continue;
      const min = Math.min(nw, ne, sw, se);
      const max = Math.max(nw, ne, sw, se);
      if (min === max) continue; // a flat quad has no crossing, and a level exactly on it has no orientation

      const lonW = lonAt(col);
      const lonE = lonAt(col + 1);
      const latN = latAt(row);
      const latS = latAt(row + 1);

      for (let l = 0; l < levels.length; l++) {
        const level = levels[l];
        if (level < min) continue;
        if (level > max) break; // levels ascend, so nothing further can cross this quad
        const mask = (nw >= level ? 1 : 0) | (ne >= level ? 2 : 0) | (se >= level ? 4 : 0) | (sw >= level ? 8 : 0);
        let pairs = MARCHING_SQUARES_EDGES[mask];
        if (mask === 5 || mask === 10) {
          const centreInside = (nw + ne + se + sw) / 4 >= level;
          // Mask 5's inside corners are NW/SE: an inside centre joins those
          // two, leaving NE and SW as separate outside islands for the isoline
          // to encircle one at a time. Mask 10 is the same statement about the
          // other diagonal, so its two resolutions are the mirror of these.
          pairs = (mask === 5) === centreInside ? SADDLE_SEPARATING_NE_SW : SADDLE_SEPARATING_NW_SE;
        }
        if (pairs.length === 0) continue;

        // Crossing position along one quad edge. A zero denominator only
        // happens where both ends sit exactly on the level, and then either
        // end is the same point.
        const along = (a: number, b: number): number => (a === b ? 0 : (level - a) / (b - a));
        const edgePoint = (edge: number): readonly [number, number] => {
          switch (edge) {
            case 0: return [lonW + (lonE - lonW) * along(nw, ne), latN];
            case 1: return [lonE, latN + (latS - latN) * along(ne, se)];
            case 2: return [lonW + (lonE - lonW) * along(sw, se), latS];
            default: return [lonW, latN + (latS - latN) * along(nw, sw)];
          }
        };

        for (const [from, to] of pairs) out.push({ level, a: edgePoint(from), b: edgePoint(to) });
      }
    }
  }
  return out;
}

/**
 * Every isoline segment across a MOSAIC of sample grids, canonically ordered.
 *
 * The order is `(level ascending, then first endpoint lon, then lat)`, and it
 * is a correctness property rather than tidiness: the segment SET a terrain
 * produces is a function of its vertex grid alone, but the ORDER a mosaic
 * yields it in follows the tiling, and the last stamp into a contested output
 * cell wins the glyph. Sorting makes one terrain render identically however it
 * is tiled (`widget.contourTileBoundary.test.ts`), and makes the paint order
 * across levels deterministic — the highest level wins a shared cell, always.
 */
export function glyphMapMarchContourMosaic(
  grids: readonly GlyphMapContourSampleGrid[],
  levels: readonly number[],
): readonly GlyphMapContourSegment[] {
  if (grids.length === 0 || levels.length === 0) return [];
  const sorted = [...levels].sort((a, b) => a - b);
  const out: GlyphMapContourSegment[] = [];
  for (const grid of grids) glyphMapMarchContourGrid(grid, sorted, out);
  out.sort((p, q) => p.level - q.level || p.a[0] - q.a[0] || p.a[1] - q.a[1] || p.b[0] - q.b[0] || p.b[1] - q.b[1]);
  return out;
}

/** What {@link glyphMapGeneralizeContourMosaic} reads from a mounted piece: its native grid (for the extent) and a point sampler. */
export interface GlyphMapContourGeneralizeSource {
  readonly grid: GlyphMapContourSampleGrid;
  valueAt(lon: number, lat: number): number;
}

/** Above this many lattice vertices the lattice coarsens rather than stall a frame. */
const GENERALIZE_MAX_VERTICES = 1 << 20;

/**
 * The mosaic resampled onto ONE lattice and Gaussian-smoothed at `radiusDeg`,
 * for contours a reader can follow rather than a trace of every bump.
 *
 * A contour cut from the native grid follows relief finer than one output
 * cell can draw, so on rough ground it reads as a staircase, scatters tiny
 * rings and fuses neighbouring levels. Smoothing the FIELD (not the lines) is
 * the cartographic generalisation: every level is cut from the same smoothed
 * surface, so lines still never cross and still sit at their own elevation.
 *
 * The lattice is aligned to multiples of its own step in lon/lat, not to any
 * tile, and samples the whole mosaic through each piece's own `valueAt` — so
 * there is no tile edge for a kernel to be truncated at, and the seam
 * identity the native path gets from shared edge vertices holds here by
 * construction. A sample no piece answers is NaN, and the blur normalises by
 * the weight it actually found, so a hole stays a hole instead of pulling the
 * surface toward zero.
 */
export function glyphMapGeneralizeContourMosaic(
  pieces: readonly GlyphMapContourGeneralizeSource[],
  radiusDeg: number,
): GlyphMapContourSampleGrid | null {
  if (pieces.length === 0 || !(radiusDeg > 0)) return null;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const { grid: { bounds } } of pieces) {
    west = Math.min(west, bounds.west);
    east = Math.max(east, bounds.east);
    south = Math.min(south, bounds.south);
    north = Math.max(north, bounds.north);
  }
  south = Math.max(-90, south);
  north = Math.min(90, north);
  let step = radiusDeg / 2;
  while (((east - west) / step + 2) * ((north - south) / step + 2) > GENERALIZE_MAX_VERTICES) step *= 2;
  const c0 = Math.ceil(west / step), c1 = Math.floor(east / step);
  const r0 = Math.ceil(-north / step), r1 = Math.floor(-south / step);
  const cols = c1 - c0, rows = r1 - r0;
  if (cols < 1 || rows < 1) return null;
  const stride = cols + 1;
  const raw = new Float64Array(stride * (rows + 1));
  for (let r = 0; r <= rows; r++) {
    const lat = -(r0 + r) * step;
    for (let c = 0; c <= cols; c++) {
      const lon = (c0 + c) * step;
      let v = NaN;
      for (const piece of pieces) {
        v = piece.valueAt(lon, lat);
        if (Number.isFinite(v)) break;
      }
      raw[r * stride + c] = v;
    }
  }
  // Separable Gaussian, sigma one lattice step (half the radius), cut at 3 sigma.
  const kernel = [0.004431848, 0.053990967, 0.241970725, 0.39894228, 0.241970725, 0.053990967, 0.004431848];
  const reach = 3;
  const blur = (src: Float64Array, horizontal: boolean): Float64Array => {
    const out = new Float64Array(src.length);
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const i = r * stride + c;
        if (!Number.isFinite(src[i])) { out[i] = NaN; continue; }
        let sum = 0, weight = 0;
        for (let k = -reach; k <= reach; k++) {
          const cc = horizontal ? c + k : c, rr = horizontal ? r : r + k;
          if (cc < 0 || cc > cols || rr < 0 || rr > rows) continue;
          const v = src[rr * stride + cc];
          if (!Number.isFinite(v)) continue;
          const w = kernel[k + reach];
          sum += v * w;
          weight += w;
        }
        out[i] = sum / weight;
      }
    }
    return out;
  };
  return {
    bounds: { west: c0 * step, east: c1 * step, north: -r0 * step, south: -r1 * step },
    cols,
    rows,
    values: blur(blur(raw, true), false),
  };
}

/**
 * Drops every CLOSED isoline whose lon/lat extent is under `minExtentDeg` —
 * the specks a knoll or a pit leaves, which on a character grid read as noise
 * rather than as a hill. Open lines (ending at the data's edge or a hole) are
 * kept whatever their size: they are pieces of something larger.
 *
 * Chaining is exact: within one marched grid, two quads sharing an edge
 * compute that edge's crossing from the same corner values and the same
 * coordinates, so the endpoints are equal numbers, not merely close ones.
 */
export function glyphMapDropSmallContourRings(
  segments: readonly GlyphMapContourSegment[],
  minExtentDeg: number,
): readonly GlyphMapContourSegment[] {
  if (!(minExtentDeg > 0) || segments.length === 0) return segments;
  const key = (level: number, p: readonly [number, number]) => `${level}|${p[0]}|${p[1]}`;
  const at = new Map<string, number[]>();
  segments.forEach((s, i) => {
    for (const p of [s.a, s.b]) {
      const k = key(s.level, p);
      const list = at.get(k);
      if (list) list.push(i); else at.set(k, [i]);
    }
  });
  const seen = new Uint8Array(segments.length);
  const drop = new Uint8Array(segments.length);
  for (let start = 0; start < segments.length; start++) {
    if (seen[start]) continue;
    // Flood the connected component; it is a ring when every endpoint is shared by exactly two segments.
    const component: number[] = [];
    const queue = [start];
    seen[start] = 1;
    let closed = true;
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    while (queue.length) {
      const i = queue.pop()!;
      component.push(i);
      const s = segments[i];
      for (const p of [s.a, s.b]) {
        west = Math.min(west, p[0]); east = Math.max(east, p[0]);
        south = Math.min(south, p[1]); north = Math.max(north, p[1]);
        const list = at.get(key(s.level, p))!;
        if (list.length !== 2) closed = false;
        for (const j of list) if (!seen[j]) { seen[j] = 1; queue.push(j); }
      }
    }
    if (closed && Math.max(east - west, north - south) < minExtentDeg) for (const i of component) drop[i] = 1;
  }
  return segments.filter((_, i) => !drop[i]);
}
