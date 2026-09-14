/**
 * `glyphChartPlaneObject` — a rendered 2D chart as a textured quad
 * `GlyphSceneObject` (CHARTS-RESEARCH `PLAN-3d.md` §3.1/§7, packet F4b —
 * `docs/design/charts3d.md`'s own "deliberately NOT in this packet" note
 * for F4 names this as the follow-up). Mounts through `scene.addObject()`
 * into any `createGlyphScene`: the chart reads as texture on ordinary 3D
 * geometry, through the exact per-cell texture path every other textured
 * mesh in the renderer already goes through (AGENTS.md's "Per-cell
 * textures") — no second render path, no decal machinery, no camera of
 * its own.
 *
 * The quad lies in the object's own XY plane (Z = 0), sized so its WORLD
 * aspect ratio (`cols * canvas.cellAspect : rows`, never the bare cell-
 * count ratio) matches the chart's own — `cellAspect` is the quantity that
 * makes a chart CELL square on screen (AGENTS.md's "Charts" "Arc shape and
 * callouts" derives the same ratio for a pie's own radius). `width` (the
 * plane's object-space X extent) picks the scale; height follows from it.
 *
 * UVs follow the OBJ convention every glyphcss polygon already uses (`v=0`
 * bottom, `v=1` top, matching `@glyphcss/maps`' facade-wall vertex/UV
 * order — AGENTS.md's "Layers" `facade` clause): the plane's own +X edge
 * carries `v=0` (the canvas's bottom row) and -X carries `v=1` (canvas row
 * 0, the top); +Y increasing runs the canvas left (`u=0`) to right (`u=1`).
 * Under glyphcss's DEFAULT, untransformed orthographic camera (`rotX=0,
 * rotY=0`, which projects world X to screen ROW and world Y to screen
 * COLUMN) this reproduces the chart right-side up and left-to-right with
 * no `rotation` needed — a caller standing the plane up as a wall, floor,
 * or anything else supplies its own `transform` to `scene.addObject`.
 *
 * **What is lost, honestly** (PLAN-3d.md §7): labels become texels, not
 * glyphs — legibility survives only where one chart cell covers at least
 * `texelsPerCell` (default `[2, 4]`) output cells; below that, text
 * degrades to a density blob, never a decoded shape. `glyphGridDecalEffect`
 * (a later `@glyphcss/effects` packet) is the exact-glyph alternative this
 * plane object does not attempt.
 */
import type { GlyphSceneObject, GlyphSceneObjectMesh, Polygon, Vec3 } from "glyphcss";
import { encodeGlyphSceneObjectSamplerKey, resolveGlyphCanvasTextureSamplerRect } from "glyphcss";
import type { GlyphChartBuild } from "./types";
import { glyphChartTextureSampler, type GlyphChartTextureSamplerOptions } from "./bridge";

/** The object's one texture-sampler map key (namespaced under the object's own `id` at mount — see `encodeGlyphSceneObjectSamplerKey`). */
const PLANE_TEXTURE_NAME = "chart";
/** The object's one mesh name — the effect-targeting handle key (`handle.meshes.get("surface")`). */
const PLANE_MESH_NAME = "surface";

export interface GlyphChartPlaneObjectOptions extends GlyphChartTextureSamplerOptions {
  /** Object id — also the mesh-name namespace for its texture-sampler key. Default `"chart-plane"`. */
  readonly id?: string;
  /** Object-space width (world units, the plane's own X extent); height is derived from it and the sampled cell aspect — see this file's own top-of-file doc. Default `2`. */
  readonly width?: number;
  /** Forwarded to the plane's own mesh (`GlyphMeshTransform.castShadow`, AGENTS.md's "Shadows"). Default `false`. */
  readonly castShadow?: boolean;
  /** Forwarded to the plane's own mesh (`GlyphMeshTransform.receiveShadow`). Default `false`. */
  readonly receiveShadow?: boolean;
}

/**
 * `build` → a textured-quad `GlyphSceneObject`. See this file's own top-of-
 * file doc for the orientation/UV convention and what is lost.
 */
export function glyphChartPlaneObject(
  build: GlyphChartBuild,
  options: GlyphChartPlaneObjectOptions = {},
): GlyphSceneObject {
  const { id = "chart-plane", width = 2, castShadow, receiveShadow, source, texelsPerCell, rect } = options;
  if (!(width > 0)) {
    throw new RangeError(`glyphChartPlaneObject() width must be a positive number, got ${width}.`);
  }
  const canvas = source === "colorCanvas" ? build.colorCanvas : build.canvas;
  // Same normalized/clamped rect `glyphChartTextureSampler` (via
  // `glyphCanvasTextureSampler`) is about to sample — sizing from the RAW
  // `rect` instead let an out-of-bounds rect give the sampler one aspect
  // and the quad another, and a reversed rect could size a negative
  // height (packet F4b fix round 1).
  const normalizedRect = resolveGlyphCanvasTextureSamplerRect(canvas, rect);
  const cols = normalizedRect.x1 - normalizedRect.x0 + 1;
  const rows = normalizedRect.y1 - normalizedRect.y0 + 1;
  const height = (width * rows) / (cols * canvas.cellAspect);
  const hw = width / 2;
  const hh = height / 2;

  // Bottom-left, bottom-right, top-right, top-left — the same vertex/UV
  // ordering `@glyphcss/maps`' facade walls use. See this file's own
  // top-of-file doc for the +X/-X <-> v=0/v=1 convention this encodes.
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
    // White: the texel's own colour passes through the per-cell multiply
    // unmodulated (AGENTS.md's "Per-cell textures" — `sourceRgb = texel *
    // base / 255`), so the chart's fg/bg reproduce exactly instead of
    // being tinted by this mesh's own base colour.
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
    textureSamplers: new Map([[PLANE_TEXTURE_NAME, glyphChartTextureSampler(build, { source, texelsPerCell, rect })]]),
    bounds: { min: [-hh, -hw, 0], max: [hh, hw, 0] },
  };
}
