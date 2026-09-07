import type { TextureSampler } from "glyphcss";
import type { GlyphMapVectorFeature } from "./vector/types";

/**
 * The texture key a `fill-extrusion` layer's facade is registered under. It is
 * not a URL and is never fetched: `createGlyphMap` hands the decoded pixels
 * straight to `scene.setTextureSamplers`, so the whole path runs with no image
 * load, no canvas, and therefore identically under a test DOM and under SSR.
 */
export const GLYPH_MAP_FACADE_TEXTURE = "glyph-map:facade";

/**
 * Real-world metres per window BAY and per FLOOR — the two numbers that turn a
 * wall's own measured length and height into a tile count. Ordinary European
 * street-block proportions; a caller who wants a different rhythm passes its own
 * on {@link GlyphMapFacadeOptions}.
 */
export const GLYPH_MAP_FACADE_BAY_METRES = 3.6;
export const GLYPH_MAP_FACADE_FLOOR_METRES = 3.2;

/** Pixels per bay and per floor in the generated tile. */
const PX = 12;

// Greyscale levels. A texel MODULATES both the cell colour and — this is the
// part that matters on a character grid — the cell INTENSITY, which is what
// picks the glyph. So a window row survives `useColors: false` as a change of
// CHARACTER, not merely of colour, and a facade reads in a monochrome render.
//
// They are a MODULATION, not a palette, and the three constraints that fix
// them were all measured at eye height against the real vendored Zürich tile
// (five standing points x four distances, 10-200 m; the original values were
// chosen against an ORBIT view, before walk mode existed):
//
//  - **The pier is the identity (255).** Anything lower darkens the whole
//    wall, so a facade would change a building's colour as well as its
//    texture; at 255 the untextured reading IS the layer's own colour and the
//    texture only ever takes light away.
//  - **The window must stay ABOVE the ink threshold.** At the original 58
//    (0.23 of the surface) a window's cells fell out of the render entirely —
//    1,519 blank cells across those twenty viewpoints, i.e. the facade was
//    punching holes in the building rather than texturing it. At 140 not one
//    cell is lost.
//  - **Contrast is what aliases.** A bay is 3.6 m, so beyond ~60 m it is under
//    one cell wide and the rasterizer point-samples it; the wider the gap
//    between pier and window, the more violently that alternates. 4.3:1 turned
//    a far wall into salt-and-pepper (mean glyph run 1.34 with no facade at
//    all, 1.28 with it — the facade was making the wall NOISIER); 1.8:1 puts
//    the window on its own ramp step, so it paints as a RUN of one glyph
//    against the pier's, and the same twenty viewpoints go to 2.06.
const V_PIER = 255;      // the wall between two windows — the identity
const V_SPANDREL = 215;  // the band under a window, and the floor line
const V_WINDOW = 140;    // glass

let cached: TextureSampler | null = null;

/**
 * ONE bay by ONE floor of a generic facade, tiled across a wall by
 * `Polygon.textureWrap: "repeat"`.
 *
 * A single tile rather than an image per `(bays, floors)` pair is the whole
 * reason the wrap mode had to be honoured in the rasterizer: with UVs clamped, a
 * wall can only ever show one copy of its texture, so covering 900 m of Zurich
 * needed 101 pre-tiled images and 1.8 MB. This is 12x12 greyscale, built once.
 *
 * Row 0 is the TOP of the wall (the sampler flips v), so the floor line sits on
 * the tile's top edge and a window's spandrel directly beneath it.
 */
export function glyphMapFacadeTexture(): TextureSampler {
  if (cached) return cached;
  const data = new Uint8ClampedArray(PX * PX * 4);
  const put = (x: number, y: number, v: number): void => {
    const o = (y * PX + x) * 4;
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
  };
  for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) put(x, y, V_PIER);
  // Window: inset from the pier on both sides, sitting above its spandrel.
  const x0 = Math.round(0.28 * PX), x1 = Math.round(0.74 * PX);
  const y0 = Math.round(0.26 * PX), y1 = Math.round(0.80 * PX);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, V_WINDOW);
  for (let x = x0; x < x1; x++) put(x, y1, V_SPANDREL);
  // Floor line along the tile's top edge — the horizontal band that makes a
  // storey readable. It tiles into a continuous line down the whole wall.
  for (let x = 0; x < PX; x++) put(x, 0, V_SPANDREL);
  cached = { width: PX, height: PX, data, lowDetail: false };
  return cached;
}

/** Facade texturing for a mesh's extrusion WALLS. */
export interface GlyphMapFacadeOptions {
  /**
   * The texture key the wall quads carry. Whatever supplies the scene's
   * samplers must have this key — {@link GLYPH_MAP_FACADE_TEXTURE} is the one
   * `createGlyphMap` registers for itself.
   */
  readonly texture: string;
  /** Metres per window bay across the wall. Default {@link GLYPH_MAP_FACADE_BAY_METRES}. */
  readonly bayMetres?: number;
  /** Metres per floor up the wall. Default {@link GLYPH_MAP_FACADE_FLOOR_METRES}. */
  readonly floorMetres?: number;
}

/**
 * Tile counts for a wall of `lengthM` x `heightM` real metres.
 *
 * Rounded to whole tiles, never below one, so a wall ends on a pier instead of
 * halfway through a window and two walls meeting at a building corner both
 * close on one. Rounding also bounds the count a degenerate height can ask for.
 */
export function glyphMapFacadeTiles(lengthM: number, heightM: number, options: GlyphMapFacadeOptions): { readonly bays: number; readonly floors: number } {
  const bayM = options.bayMetres ?? GLYPH_MAP_FACADE_BAY_METRES;
  const floorM = options.floorMetres ?? GLYPH_MAP_FACADE_FLOOR_METRES;
  const bays = Math.max(1, Math.round(lengthM / bayM));
  const floors = Math.max(1, Math.round(heightM / floorM));
  return {
    bays: Number.isFinite(bays) ? bays : 1,
    floors: Number.isFinite(floors) ? floors : 1,
  };
}

/** Metres between two lon/lat points, on the local equirectangular approximation. */
export function glyphMapMetresBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const M_PER_DEG = 111320;
  const midLat = (a[1] + b[1]) / 2;
  const dx = (b[0] - a[0]) * M_PER_DEG * Math.cos(midLat * Math.PI / 180);
  const dy = (b[1] - a[1]) * M_PER_DEG;
  return Math.hypot(dx, dy);
}

/** FNV-1a over a string — a stable, cheap per-feature seed. */
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/**
 * A feature's own identity as a hash seed: its `id` when the source carries one
 * (MVT does), and otherwise its first ring vertex — which is a property of the
 * GEOMETRY, so a feature keeps its colour across re-tiles, re-mounts and
 * projection changes exactly as an id would.
 *
 * `part` is one polygon GROUP's own anchor (its outer ring's first vertex),
 * and supplying it is what makes a per-feature colour usable on a real OSM
 * pyramid. A vector tile is free to emit every attribute-identical feature as
 * ONE multipolygon, and OpenMapTiles' `building` layer does exactly that:
 * measured on the vendored real OpenFreeMap tile `14/8579/5736`, 50 features
 * carry 1,991 separate building footprints, and on a live `14/8580/5737`
 * (Zürich old town) ONE feature carries 2,437 of them. Seeded per FEATURE, a
 * whole neighbourhood therefore takes a single tone and the variation does
 * nothing at all — the exact "they all look the same" it exists to fix. The
 * anchor is a property of the GEOMETRY, so a part keeps its colour across
 * re-tiles and re-mounts for the same reason the feature fallback does.
 *
 * Omitting `part` is the feature-level seed, unchanged.
 */
export function glyphMapFeatureSeed(feature: GlyphMapVectorFeature, part?: readonly [number, number]): string {
  const own = feature.id !== undefined ? feature.id : lonLatKey(feature.rings[0]?.[0]);
  return part ? `${own}#${lonLatKey(part)}` : own;
}

function lonLatKey(point: readonly [number, number] | undefined): string {
  return point ? `${point[0].toFixed(6)},${point[1].toFixed(6)}` : "";
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Maximum per-channel swing at `amount: 1`, as a fraction of the full range.
 * A CITY is not one colour, but neither is it a fruit bowl: the point of this
 * is that two adjacent buildings SEPARATE, which needs only enough tonal
 * spread for the depth-winning cell of one to differ from its neighbour's.
 */
const MAX_SWING = 0.28;

/**
 * `base` nudged deterministically by a feature's own seed — the cheapest
 * legibility win available on an extrusion layer, because it is a colour and
 * not a second rasterizer pass.
 *
 * Three independent channel offsets rather than one lightness ramp: a pure
 * lightness shift moves every building along the same axis, so two neighbours
 * that happen to land near each other on it stay indistinguishable, and a
 * shared ramp also fights the Lambert shading that is already encoding face
 * orientation. Offsetting the channels separately spreads the buildings across
 * the colour solid instead of along a line through it.
 */
export function glyphMapVaryColor(base: string, seed: string, amount: number): string {
  if (!(amount > 0)) return base;
  const rgb = hexToRgb(base);
  if (!rgb) return base;
  const h = hash32(seed);
  const swing = MAX_SWING * Math.min(1, amount) * 255;
  // Three byte-wide slices of one hash — independent enough for this, and one
  // multiply instead of three.
  const dr = ((h & 255) / 255 - 0.5) * 2 * swing;
  const dg = (((h >>> 8) & 255) / 255 - 0.5) * 2 * swing;
  const db = (((h >>> 16) & 255) / 255 - 0.5) * 2 * swing;
  return rgbToHex(rgb[0] + dr, rgb[1] + dg, rgb[2] + db);
}
