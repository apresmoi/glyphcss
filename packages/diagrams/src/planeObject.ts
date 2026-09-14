/**
 * `glyphDiagramPlaneObject` — mirrors `@glyphcss/charts`' own
 * `glyphChartPlaneObject` (CHARTS-RESEARCH `PLAN-3d.md` §3.1/§7, packet
 * F4b): a rendered 2D diagram (`page.canvas`, Packet F1's `grid` -> `canvas`
 * rename) as a textured quad `GlyphSceneObject`, through the same per-cell
 * texture path every other textured mesh in the renderer already goes
 * through (AGENTS.md's "Per-cell textures") — no second render path, no
 * camera of its own.
 *
 * Orientation, UV convention, sizing rule and honest limitations are
 * IDENTICAL to `glyphChartPlaneObject`'s own top-of-file doc — read that
 * one; this file only differs in reading `page.canvas` instead of a chart
 * `build`'s (there is no `source: "canvas" | "colorCanvas"` choice here,
 * since a diagram paints only one canvas).
 */
import type { GlyphSceneObject, GlyphSceneObjectMesh, Polygon, Vec3 } from "glyphcss";
import { encodeGlyphSceneObjectSamplerKey, resolveGlyphCanvasTextureSamplerRect } from "glyphcss";
import type { GlyphDiagramPage } from "./renderTypes";
import { glyphDiagramTextureSampler, type GlyphDiagramTextureSamplerOptions } from "./bridge";

/** The object's one texture-sampler map key (namespaced under the object's own `id` at mount — see `encodeGlyphSceneObjectSamplerKey`). */
const PLANE_TEXTURE_NAME = "diagram";
/** The object's one mesh name — the effect-targeting handle key (`handle.meshes.get("surface")`). */
const PLANE_MESH_NAME = "surface";

export interface GlyphDiagramPlaneObjectOptions extends GlyphDiagramTextureSamplerOptions {
  /** Object id — also the mesh-name namespace for its texture-sampler key. Default `"diagram-plane"`. */
  readonly id?: string;
  /** Object-space width (world units, the plane's own X extent); height is derived from it and the sampled cell aspect — see `glyphChartPlaneObject`'s own top-of-file doc. Default `2`. */
  readonly width?: number;
  /** Forwarded to the plane's own mesh (`GlyphMeshTransform.castShadow`, AGENTS.md's "Shadows"). Default `false`. */
  readonly castShadow?: boolean;
  /** Forwarded to the plane's own mesh (`GlyphMeshTransform.receiveShadow`). Default `false`. */
  readonly receiveShadow?: boolean;
}

/**
 * `page` -> a textured-quad `GlyphSceneObject`. See `glyphChartPlaneObject`'s
 * own top-of-file doc for the orientation/UV convention and what is lost.
 */
export function glyphDiagramPlaneObject(
  page: GlyphDiagramPage,
  options: GlyphDiagramPlaneObjectOptions = {},
): GlyphSceneObject {
  const { id = "diagram-plane", width = 2, castShadow, receiveShadow, texelsPerCell, rect } = options;
  if (!(width > 0)) {
    throw new RangeError(`glyphDiagramPlaneObject() width must be a positive number, got ${width}.`);
  }
  const canvas = page.canvas;
  // Same normalized/clamped rect `glyphDiagramTextureSampler` (via
  // `glyphCanvasTextureSampler`) is about to sample — see
  // `glyphChartPlaneObject`'s own doc (packet F4b fix round 1).
  const normalizedRect = resolveGlyphCanvasTextureSamplerRect(canvas, rect);
  const cols = normalizedRect.x1 - normalizedRect.x0 + 1;
  const rows = normalizedRect.y1 - normalizedRect.y0 + 1;
  const height = (width * rows) / (cols * canvas.cellAspect);
  const hw = width / 2;
  const hh = height / 2;

  // Bottom-left, bottom-right, top-right, top-left — see
  // `glyphChartPlaneObject`'s own top-of-file doc for the +X/-X <-> v=0/v=1
  // convention this encodes.
  const vertices: Vec3[] = [
    [hh, -hw, 0],
    [hh, hw, 0],
    [-hh, hw, 0],
    [-hh, -hw, 0],
  ];
  const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

  const textureKey = encodeGlyphSceneObjectSamplerKey(id, PLANE_TEXTURE_NAME);
  const polygon: Polygon = {
    vertices,
    uvs,
    texture: textureKey,
    // White — see `glyphChartPlaneObject`'s own doc: the texel's own
    // colour passes through the per-cell multiply unmodulated.
    color: "#ffffff",
  };

  const mesh: GlyphSceneObjectMesh = {
    name: PLANE_MESH_NAME,
    polygons: [polygon],
    options: castShadow !== undefined || receiveShadow !== undefined ? { castShadow, receiveShadow } : undefined,
  };

  return {
    id,
    meshes: [mesh],
    textureSamplers: new Map([[PLANE_TEXTURE_NAME, glyphDiagramTextureSampler(page, { texelsPerCell, rect })]]),
    bounds: { min: [-hh, -hw, 0], max: [hh, hw, 0] },
  };
}
