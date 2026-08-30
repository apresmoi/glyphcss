/**
 * Tile-local integer quantization + delta encoding for the vector tile wire
 * format — the coordinator's scope addition: "quantize to tile-local
 * integers rather than storing float lon/lat... that is what MVT does and
 * it is a large size win." `extent` (default 4096, MVT's own convention) is
 * the number of quantization steps spanning the tile's own bounds on each
 * axis; the tile's `bounds` (already in the manifest/tile record) is what
 * lets a reader reconstruct lon/lat, so nothing outside this module needs
 * to know the tile is quantized at all — `vector/tile.ts`'s bake/decode
 * pair is the only caller.
 *
 * **Boundary exactness is load-bearing** (MAPS.md's cross-tile-seam gate,
 * same concern as `clip.ts`): a point exactly ON a tile edge quantizes to
 * EXACTLY `0` or EXACTLY `extent` on the perpendicular axis (no rounding
 * noise), because `(lon - bounds.west) / (bounds.east - bounds.west)` is
 * exactly `0` or `1` when `lon` equals `bounds.west`/`bounds.east` — and
 * two adjacent tiles share that exact boundary CONSTANT (§6, `clip.ts`'s
 * doc), so both sides quantize a shared boundary point identically.
 */
import type { GlyphMapBounds } from "../types";
import type { GlyphMapLonLat } from "./simplify";

export const GLYPH_MAP_VECTOR_TILE_EXTENT = 4096;

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

export function glyphMapQuantizePoint(
  lon: number,
  lat: number,
  bounds: GlyphMapBounds,
  extent: number = GLYPH_MAP_VECTOR_TILE_EXTENT,
): readonly [number, number] {
  const qx = clampInt(((lon - bounds.west) / (bounds.east - bounds.west)) * extent, 0, extent);
  const qy = clampInt(((bounds.north - lat) / (bounds.north - bounds.south)) * extent, 0, extent);
  return [qx, qy];
}

export function glyphMapDequantizePoint(
  qx: number,
  qy: number,
  bounds: GlyphMapBounds,
  extent: number = GLYPH_MAP_VECTOR_TILE_EXTENT,
): GlyphMapLonLat {
  const lon = bounds.west + (qx / extent) * (bounds.east - bounds.west);
  const lat = bounds.north - (qy / extent) * (bounds.north - bounds.south);
  return [lon, lat];
}

/**
 * The maximum positional error quantization alone can introduce — half a
 * quantization step, in degrees, on the wider of the two axes. Callers
 * (the bake script) compare this against the level's own simplification
 * epsilon (`vector/simplify.ts`'s `glyphMapCellEpsilonDeg`) to confirm
 * quantization noise stays well under what simplification already discards.
 */
export function glyphMapQuantizeErrorDeg(bounds: GlyphMapBounds, extent: number = GLYPH_MAP_VECTOR_TILE_EXTENT): number {
  const stepLon = (bounds.east - bounds.west) / extent;
  const stepLat = (bounds.north - bounds.south) / extent;
  return Math.max(stepLon, stepLat) / 2;
}

/** MVT-style delta encoding: first point absolute (in quantized tile-local units), every later point a delta from the previous. Flat `[x0,y0,dx1,dy1,dx2,dy2,...]`. */
export function glyphMapEncodeQuantizedLine(
  points: readonly GlyphMapLonLat[],
  bounds: GlyphMapBounds,
  extent: number = GLYPH_MAP_VECTOR_TILE_EXTENT,
): number[] {
  const out: number[] = [];
  let prevX = 0;
  let prevY = 0;
  points.forEach(([lon, lat], i) => {
    const [qx, qy] = glyphMapQuantizePoint(lon, lat, bounds, extent);
    if (i === 0) {
      out.push(qx, qy);
    } else {
      out.push(qx - prevX, qy - prevY);
    }
    prevX = qx;
    prevY = qy;
  });
  return out;
}

export function glyphMapDecodeQuantizedLine(
  deltas: readonly number[],
  bounds: GlyphMapBounds,
  extent: number = GLYPH_MAP_VECTOR_TILE_EXTENT,
): GlyphMapLonLat[] {
  const out: GlyphMapLonLat[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < deltas.length; i += 2) {
    if (i === 0) {
      x = deltas[0];
      y = deltas[1];
    } else {
      x += deltas[i];
      y += deltas[i + 1];
    }
    out.push(glyphMapDequantizePoint(x, y, bounds, extent));
  }
  return out;
}
