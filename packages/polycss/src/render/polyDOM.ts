/**
 * polyDOM — compatibility wrapper for rendering a single Polygon.
 *
 * The vanilla package renders every valid polygon as an <i>: full rectangular
 * solid polygons can use CSS background-color directly, while textured or
 * irregular polygons use the atlas path. This helper keeps the older
 * single-polygon render contract without carrying a separate SVG implementation.
 */
import type { Polygon } from "@polycss/core";
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
