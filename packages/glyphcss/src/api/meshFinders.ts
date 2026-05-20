/**
 * Mesh lookup helpers — mirrors voxcss's `findPolyMeshHandle`,
 * `findMeshUnderPoint`, and `pointInMeshElement`.
 *
 * `findGlyphMeshHandle(host, id)` performs an O(n) walk of mesh elements
 * under the given host, matching on the `data-glyph-mesh-id` attribute.
 *
 * `findMeshUnderPoint` and `pointInMeshElement` use bounding-box checks.
 * TODO(hit-layer): replace the bbox check with proper polygon raycasting once
 * the rasterizer hit-map is wired to the hit layer.
 */

import type { GlyphSceneHandle } from "./createGlyphScene";

/**
 * Given a host element and a string mesh id, return the mesh's HTMLElement
 * (the `.glyph-mesh` wrapper div) if found, or `null`.
 */
export function findGlyphMeshHandle(
  host: HTMLElement,
  id: string,
): HTMLElement | null {
  const el = host.querySelector(`[data-glyph-mesh-id="${CSS.escape(id)}"]`);
  return el instanceof HTMLElement ? el : null;
}

/**
 * Bbox check — returns true when (x, y) in client coordinates falls inside
 * the bounding rect of `el`.
 *
 * TODO(hit-layer): replace with polygon-level raycasting once available.
 */
export function pointInMeshElement(
  el: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

/**
 * Returns the `.glyph-mesh` element whose bounding box contains the
 * given client coordinates, or `null`.
 *
 * The `host` parameter scopes the search; pass the scene host element to
 * avoid matching meshes from other scenes on the page.
 *
 * TODO(hit-layer): wire to rasterizer hit-map raycasting once available.
 * Until then this returns a bbox-level approximation (not pixel-accurate).
 */
export function findMeshUnderPoint(
  host: HTMLElement | Document,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const root = host instanceof Document ? host : host;
  const meshEls = Array.from(
    root.querySelectorAll(".glyph-mesh"),
  ) as HTMLElement[];
  for (const meshEl of meshEls) {
    if (pointInMeshElement(meshEl, clientX, clientY)) return meshEl;
  }
  // TODO(hit-layer): log debug warning when raycasting is unavailable
  return null;
}

export type { GlyphSceneHandle };
