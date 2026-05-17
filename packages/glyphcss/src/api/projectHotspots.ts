import type { Hotspot, HotspotCell } from "@glyphcss/core";
import type { GlyphcssCamera } from "./createGlyphcssCamera";

/**
 * Project a list of 3D hotspot anchors through the camera. Returns the
 * 2D cell position for each, plus camera-space depth and a visibility flag.
 *
 * Uses the same projection as the renderer (same `camera.project` call) —
 * the renderer and hit layer cannot drift out of sync as long as they
 * share a camera.
 */
export function projectHotspots(
  hotspots: readonly Hotspot[],
  camera: GlyphcssCamera,
  cols: number,
  rows: number,
  cellAspect: number,
): HotspotCell[] {
  return hotspots.map((h) => {
    const [col, row, depth] = camera.project(h.at, cols, rows, cellAspect);
    const visible =
      depth > -3 &&
      col >= 0 && col < cols &&
      row >= 0 && row < rows;
    return { id: h.id, col, row, depth, visible };
  });
}
