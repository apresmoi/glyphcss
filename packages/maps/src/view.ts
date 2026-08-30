import type { GlyphMapBounds, GlyphMapView } from "./types";

/**
 * Convenience constructor for a {@link GlyphMapView} from an explicit
 * geographic box, for the static-bake case (MAPS.md §3b). Unlike a plain
 * center+span view, the box is retained verbatim on `.bounds` rather than
 * re-derived from `span`+aspect-lock — a one-shot bake wants the EXACT window
 * it asked for, even when that window's aspect ratio doesn't match `cols/rows`
 * (the Tier 1 sketch's 2°×1.2° box over a 140×48 grid is not 2.9166:1).
 * `center`/`span` are still populated so the return value type-checks as a
 * plain `GlyphMapView` wherever one is expected (e.g. a future pan/zoom
 * handoff), but callers that care about the exact box should read `.bounds`.
 */
export function glyphMapBounds(box: GlyphMapBounds & { cols: number; rows: number }): GlyphMapView {
  const { west, east, south, north, cols, rows } = box;
  if (!(east > west)) throw new RangeError("glyphcss/maps: glyphMapBounds requires east > west.");
  if (!(north > south)) throw new RangeError("glyphcss/maps: glyphMapBounds requires north > south.");
  if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0) {
    throw new RangeError("glyphcss/maps: glyphMapBounds requires positive integer cols/rows.");
  }
  return {
    center: [(west + east) / 2, (south + north) / 2],
    span: east - west,
    cols,
    rows,
    bounds: { west, east, south, north },
  };
}

/**
 * Resolve a view's geographic bounds. A view built by {@link glyphMapBounds}
 * carries its exact box; a plain center+span view derives one via the aspect
 * lock — height = `span * (rows/cols)` — so panning/zooming a fixed-size grid
 * never shears terrain (MAPS.md §3b).
 */
export function viewBounds(view: GlyphMapView): GlyphMapBounds {
  if (view.bounds) return view.bounds;
  const [lon, lat] = view.center;
  const latSpan = (view.span * view.rows) / view.cols;
  return {
    west: lon - view.span / 2,
    east: lon + view.span / 2,
    south: lat - latSpan / 2,
    north: lat + latSpan / 2,
  };
}
