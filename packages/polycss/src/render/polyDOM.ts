/**
 * polyDOM — compatibility wrapper for rendering a single Polygon.
 *
 * The vanilla package renders every valid polygon through the same brush
 * dispatch used by mesh rendering: rects use <b>, solid triangles use <u>,
 * sprites use <s>, and other irregular solid polygons use <i> when available.
 */
import type { Polygon } from "@layoutit/polycss-core";
import {
  renderPolygonsWithTextureAtlas,
  type RenderedPoly,
  type RenderTextureAtlasOptions,
} from "./textureAtlas";

export interface RenderPolyOptions extends RenderTextureAtlasOptions {}

export type { RenderedPoly };

export function renderPoly(
  polygon: Polygon,
  options: RenderPolyOptions = {},
): RenderedPoly | null {
  const result = renderPolygonsWithTextureAtlas([polygon], options);
  const rendered = result.rendered[0];
  if (!rendered) {
    result.dispose();
    return null;
  }
  return {
    polygonIndex: 0,
    element: rendered.element,
    dispose() {
      try { rendered.dispose(); } finally { result.dispose(); }
    },
  };
}
